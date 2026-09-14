import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { DailyClosureEntity } from './entities/daily-closure.entity';
import { DailyClosureExpenseEntity } from './entities/daily-closure-expense.entity';
import { MinioStorageService } from '../storage/minio-storage.service';
import { CreateDailyClosureDto, DailyClosureExpenseInput } from './dto/create-daily-closure.dto';
import { StartJornadaDto } from './dto/start-jornada.dto';
import { FindDailyClosuresDto } from './dto/find-daily-closures.dto';

function todayDateString(): string {
  // Fecha YYYY-MM-DD en zona horaria de República Dominicana (UTC-4)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
}

@Injectable()
export class DailyClosuresService {
  constructor(
    @InjectRepository(DailyClosureEntity)
    private readonly closureRepository: Repository<DailyClosureEntity>,
    @InjectRepository(DailyClosureExpenseEntity)
    private readonly expenseRepository: Repository<DailyClosureExpenseEntity>,
    private readonly storageService: MinioStorageService,
  ) {}

  /**
   * Apertura de jornada — exige que el técnico no tenga una jornada en curso
   * sin cerrar (closedAt IS NULL). Permite múltiples jornadas/turnos en el mismo día.
   */
  async startJornada(employeeId: string, dto: StartJornadaDto): Promise<DailyClosureEntity> {
    if (!employeeId) {
      throw new BadRequestException('No se pudo determinar el técnico autenticado');
    }

    const activeJornada = await this.closureRepository.findOne({
      where: { employeeId, closedAt: IsNull() },
    });
    if (activeJornada) {
      throw new ConflictException('Ya tienes una jornada en curso. Debes cerrarla antes de iniciar una nueva.');
    }

    const closureDate = todayDateString();

    return this.closureRepository.save(
      this.closureRepository.create({
        employeeId,
        closureDate,
        startedAt: new Date(),
        startLatitude: dto.latitude,
        startLongitude: dto.longitude,
        fuelAmount: 0,
        totalExpensesAmount: 0,
      }),
    );
  }

  /**
   * Estado de la jornada del técnico autenticado:
   * 1. IN_PROGRESS si tiene una jornada abierta actualmente.
   * 2. CLOSED si cerró al menos una jornada hoy (permitiendo abrir una nueva).
   * 3. NOT_STARTED si no ha abierto ninguna jornada hoy.
   */
  async getTodayStatus(employeeId: string) {
    if (!employeeId) {
      return { status: 'NOT_STARTED' as const };
    }

    // 1. ¿Hay una jornada activa en curso sin cerrar?
    const activeJornada = await this.closureRepository.findOne({
      where: { employeeId, closedAt: IsNull() },
    });
    if (activeJornada) {
      return {
        status: 'IN_PROGRESS' as const,
        id: activeJornada.id,
        startedAt: activeJornada.startedAt,
      };
    }

    // 2. Si no hay activa, verificar si hubo al menos una jornada cerrada hoy
    const closureDate = todayDateString();
    const lastClosedToday = await this.closureRepository.findOne({
      where: { employeeId, closureDate, closedAt: Not(IsNull()) },
      order: { closedAt: 'DESC' },
    });

    if (lastClosedToday) {
      return {
        status: 'CLOSED' as const,
        id: lastClosedToday.id,
        startedAt: lastClosedToday.startedAt,
        closedAt: lastClosedToday.closedAt!,
        fuelAmount: Number(lastClosedToday.fuelAmount),
        totalExpensesAmount: Number(lastClosedToday.totalExpensesAmount),
        canStartNew: true as const,
      };
    }

    return { status: 'NOT_STARTED' as const };
  }

  /**
   * Valida el JSON de líneas de gasto enviado como campo de texto en el
   * multipart/form-data (class-validator no valida JSON anidado dentro de un
   * campo de texto plano sin un paso de parseo previo).
   */
  private parseExpenses(raw: string | undefined, filesCount: number): DailyClosureExpenseInput[] {
    if (!raw) {
      throw new BadRequestException('Debe incluir al menos un gasto del día (con su foto de factura)');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('El campo "expenses" no es un JSON válido');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new BadRequestException('Debe incluir al menos un gasto del día');
    }
    if (parsed.length !== filesCount) {
      throw new BadRequestException(
        `Se recibieron ${filesCount} foto(s) pero ${parsed.length} línea(s) de gasto — deben coincidir en cantidad y orden`,
      );
    }
    return parsed.map((item: any, index: number) => {
      if (typeof item?.concept !== 'string' || !item.concept.trim()) {
        throw new BadRequestException(`El gasto #${index + 1} no tiene un concepto válido`);
      }
      const amount = Number(item?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException(`El gasto #${index + 1} no tiene un monto válido`);
      }
      return { concept: item.concept.trim(), amount };
    });
  }

  /**
   * Cierre de caja chica diario: cierra la jornada activa actualmente abierta
   * del técnico y asocia los gastos y fotos subidos.
   */
  async close(
    employeeId: string,
    dto: CreateDailyClosureDto,
    expensesRaw: string | undefined,
    files: Express.Multer.File[],
    fuelReceiptFile: Express.Multer.File | undefined,
  ): Promise<DailyClosureEntity> {
    if (!employeeId) {
      throw new BadRequestException('No se pudo determinar el técnico autenticado');
    }
    if (!fuelReceiptFile) {
      throw new BadRequestException('Debe adjuntar la foto de la factura de combustible');
    }

    const jornada = await this.closureRepository.findOne({
      where: { employeeId, closedAt: IsNull() },
    });
    if (!jornada) {
      throw new BadRequestException('No tienes ninguna jornada abierta para cerrar. Debes iniciar una jornada primero.');
    }

    const expensesInput = this.parseExpenses(expensesRaw, files?.length || 0);
    const totalExpensesAmount = expensesInput.reduce((sum, e) => sum + e.amount, 0);

    const closureDate = jornada.closureDate || todayDateString();
    jornada.fuelReceiptPhotoKey = await this.storageService.uploadBuffer(
      fuelReceiptFile.buffer,
      fuelReceiptFile.originalname,
      `daily-closures/${closureDate}`,
    );
    jornada.fuelAmount = dto.fuelAmount;
    jornada.notes = dto.notes;
    jornada.totalExpensesAmount = totalExpensesAmount;
    jornada.closedAt = new Date();
    await this.closureRepository.save(jornada);

    for (let i = 0; i < expensesInput.length; i++) {
      const file = files[i];
      const receiptPhotoKey = await this.storageService.uploadBuffer(
        file.buffer,
        file.originalname,
        `daily-closures/${closureDate}`,
      );
      await this.expenseRepository.save(
        this.expenseRepository.create({
          dailyClosureId: jornada.id,
          concept: expensesInput[i].concept,
          amount: expensesInput[i].amount,
          receiptPhotoKey,
        }),
      );
    }

    return this.findById(jornada.id);
  }

  async findById(id: string): Promise<DailyClosureEntity> {
    const closure = await this.closureRepository.findOne({
      where: { id },
      relations: ['employee', 'employee.user', 'expenses'],
    });
    if (!closure) {
      throw new NotFoundException(`Cierre de jornada con ID ${id} no encontrado`);
    }
    return closure;
  }

  /**
   * Detalle con URLs firmadas (nunca rutas públicas) para cada foto de gasto.
   */
  async getDetailWithSignedUrls(id: string) {
    const closure = await this.findById(id);
    const expensesWithUrls = await Promise.all(
      (closure.expenses || []).map(async (expense) => ({
        id: expense.id,
        concept: expense.concept,
        amount: Number(expense.amount),
        photoUrl: await this.storageService.getPresignedUrl(expense.receiptPhotoKey),
      })),
    );

    return {
      id: closure.id,
      employeeId: closure.employeeId,
      employeeName: closure.employee?.user?.username,
      closureDate: closure.closureDate,
      startedAt: closure.startedAt,
      closedAt: closure.closedAt,
      fuelAmount: Number(closure.fuelAmount),
      fuelReceiptPhotoUrl: closure.fuelReceiptPhotoKey
        ? await this.storageService.getPresignedUrl(closure.fuelReceiptPhotoKey)
        : null,
      notes: closure.notes,
      totalExpensesAmount: Number(closure.totalExpensesAmount),
      totalDayAmount: Number(closure.fuelAmount) + Number(closure.totalExpensesAmount),
      createdAt: closure.createdAt,
      expenses: expensesWithUrls,
    };
  }

  async findAll(dto: FindDailyClosuresDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 15;
    const skip = (page - 1) * limit;

    const query = this.closureRepository
      .createQueryBuilder('closure')
      .leftJoinAndSelect('closure.employee', 'employee')
      .leftJoinAndSelect('employee.user', 'user')
      .orderBy('closure.closureDate', 'DESC')
      .addOrderBy('closure.startedAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (dto.employeeId) {
      query.andWhere('closure.employeeId = :employeeId', { employeeId: dto.employeeId });
    }
    if (dto.dateFrom) {
      query.andWhere('closure.closureDate >= :dateFrom', { dateFrom: dto.dateFrom });
    }
    if (dto.dateTo) {
      query.andWhere('closure.closureDate <= :dateTo', { dateTo: dto.dateTo });
    }

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
