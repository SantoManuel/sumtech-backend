import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltEntity } from '../entities/olt.entity';
import { ListOltsDto } from '../dto/list-olts.dto';
import { OltRolePermissionEntity } from '../entities/olt-role-permission.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuEntity } from '../entities/onu.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';
import { encryptCredential, decryptCredential } from '../../network-connectivity/utils/crypto.util';
import {
  IOltDriver,
  OltDriverCapabilities,
  NO_DRIVER_CAPABILITIES,
  DriverNotImplementedError,
  UnknownOltVendorError,
} from '../ports/olt-driver.port';

@Injectable()
export class OltManagementService {
  private readonly logger = new Logger(OltManagementService.name);

  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(OltRolePermissionEntity)
    private readonly permRepository: Repository<OltRolePermissionEntity>,
    @InjectRepository(OltInterfaceEntity)
    private readonly ifaceRepository: Repository<OltInterfaceEntity>,
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly connectionResolver: OltConnectionResolverService,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  async findAll(dto?: ListOltsDto) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    // Paginación en dos pasos: `interfaces`/`rolePermissions` son relaciones
    // OneToMany, así que un skip/take directo sobre una query con
    // leftJoinAndSelect sobre ellas pagina FILAS del join (multiplicadas por
    // cada interfaz/permiso), no OLTs -- una OLT con 5 interfaces consumiría
    // 5 cupos del LIMIT real. Primero se resuelven los IDs de la página
    // (sin esas relaciones multiplicadoras) y luego se cargan completos.
    const idQuery = this.oltRepository
      .createQueryBuilder('olt')
      .select('olt.id')
      .skip(skip)
      .take(limit);

    if (dto?.activeOnly) {
      idQuery.andWhere('olt.isActive = :active', { active: true });
    }
    if (dto?.vendor) {
      idQuery.andWhere('olt.vendor = :vendor', { vendor: dto.vendor });
    }
    if (dto?.connectionStatus) {
      idQuery.andWhere('olt.connectionStatus = :connectionStatus', { connectionStatus: dto.connectionStatus });
    }
    if (dto?.search) {
      idQuery.andWhere('(olt.name ILIKE :search OR olt.host ILIKE :search OR olt.model ILIKE :search)', {
        search: `%${dto.search}%`,
      });
    }

    const [idRows, total] = await idQuery.orderBy('olt.name', 'ASC').getManyAndCount();
    const ids = idRows.map((row) => row.id);

    if (ids.length === 0) {
      return { data: [], total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const olts = await this.oltRepository
      .createQueryBuilder('olt')
      .leftJoinAndSelect('olt.viaNode', 'viaNode')
      .leftJoinAndSelect('olt.zone', 'zone')
      .leftJoinAndSelect('olt.rolePermissions', 'rolePermissions')
      .leftJoinAndSelect('olt.interfaces', 'interfaces')
      .where('olt.id IN (:...ids)', { ids })
      .orderBy('olt.name', 'ASC')
      .getMany();

    await this.attachRegisteredOnus(olts);

    return {
      data: olts.map((olt) => this.attachCapabilities(olt)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const olt = await this.oltRepository.findOne({
      where: { id },
      relations: ['viaNode', 'zone', 'rolePermissions', 'interfaces', 'interfaces.vlans', 'interfaces.vlans.vlan'],
    });
    if (!olt) {
      throw new NotFoundException(`OLT no encontrada: ${id}`);
    }
    await this.attachRegisteredOnus([olt]);
    return this.attachCapabilities(olt);
  }

  /**
   * Cuenta ONUs activas por interfaz PON desde net.onus (fuente de verdad propia,
   * independiente de lo que cada driver de fabricante reporte por CLI) y lo
   * adjunta a cada OltInterfaceEntity en memoria como `registeredOnus`.
   */
  private async attachRegisteredOnus(olts: OltEntity[]): Promise<void> {
    const ifaceIds = olts.flatMap((olt) => (olt.interfaces || []).map((iface) => iface.id));
    if (ifaceIds.length === 0) {
      return;
    }

    const counts = await this.onuRepository
      .createQueryBuilder('onu')
      .select('onu.ponInterfaceId', 'ponInterfaceId')
      .addSelect('COUNT(*)', 'count')
      .where('onu.ponInterfaceId IN (:...ifaceIds)', { ifaceIds })
      .andWhere('onu.status = :status', { status: 'ACTIVE' })
      .groupBy('onu.ponInterfaceId')
      .getRawMany();

    const countByIfaceId = new Map(counts.map((row) => [row.ponInterfaceId, parseInt(row.count, 10)]));

    for (const olt of olts) {
      for (const iface of olt.interfaces || []) {
        iface.registeredOnus = countByIfaceId.get(iface.id) || 0;
      }
    }
  }

  /**
   * Resuelve el driver real del fabricante (RF-RED, regla de enrutamiento):
   * nunca cae silenciosamente en ZteC320Driver para un vendor desconocido.
   */
  private resolveDriver(olt: OltEntity): IOltDriver {
    try {
      return this.driverRegistry.resolve(olt.vendor);
    } catch (err) {
      if (err instanceof UnknownOltVendorError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Traduce DriverNotImplementedError a un 501 explícito en vez de un 500 genérico. */
  private async callDriver<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err: any) {
      if (err instanceof DriverNotImplementedError) {
        throw new HttpException({ code: err.code, message: err.message }, HttpStatus.NOT_IMPLEMENTED);
      }
      throw err;
    }
  }

  private attachCapabilities<T extends OltEntity>(
    olt: T,
  ): T & { capabilities: OltDriverCapabilities; capabilityNotes: Partial<Record<keyof OltDriverCapabilities, string>> } {
    let capabilities: OltDriverCapabilities;
    let capabilityNotes: Partial<Record<keyof OltDriverCapabilities, string>>;
    try {
      const driver = this.driverRegistry.resolve(olt.vendor);
      capabilities = driver.getCapabilities();
      capabilityNotes = driver.getCapabilityNotes();
    } catch {
      capabilities = { ...NO_DRIVER_CAPABILITIES };
      capabilityNotes = {};
    }
    return Object.assign(olt, { capabilities, capabilityNotes });
  }

  async create(dto: any, actorUserId?: string) {
    const passwordEnc = encryptCredential(dto.password || 'smartoltuser');
    const enablePasswordEnc = dto.enablePassword ? encryptCredential(dto.enablePassword) : undefined;

    const olt = this.oltRepository.create({
      name: dto.name,
      vendor: dto.vendor || 'ZTE',
      model: dto.model || 'C320',
      host: dto.host,
      port: dto.port || 23,
      apiProtocol: dto.apiProtocol || 'TELNET',
      username: dto.username || 'smartoltuser',
      passwordEnc,
      enablePasswordEnc,
      connectionMethod: dto.connectionMethod || 'VIA_MIKROTIK',
      viaNodeId: dto.viaNodeId || null,
      natPort: dto.natPort || 2323,
      zoneId: dto.zoneId || null,
      mgmtVlanId: dto.mgmtVlanId || null,
      notes: dto.notes,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });

    const saved = await this.oltRepository.save(olt);

    // Seeding de permisos iniciales por rol (§1.6)
    const defaultPerms = [
      { role: 'ADMIN', canView: true, canOperate: true, canConfigure: true },
      { role: 'GERENTE', canView: true, canOperate: true, canConfigure: true },
      { role: 'TECNICO', canView: true, canOperate: true, canConfigure: false },
      { role: 'AGENTE_CRM', canView: true, canOperate: false, canConfigure: false },
      { role: 'CAJERO', canView: false, canOperate: false, canConfigure: false },
    ];

    for (const p of defaultPerms) {
      await this.permRepository.save(
        this.permRepository.create({
          oltId: saved.id,
          role: p.role,
          canView: p.canView,
          canOperate: p.canOperate,
          canConfigure: p.canConfigure,
        }),
      );
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: saved.viaNodeId || saved.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `OLT creada: "${saved.name}" (${saved.vendor} ${saved.model} en ${saved.host})`,
      actorUserId,
      rawDetails: { oltId: saved.id },
    });

    return this.findById(saved.id);
  }

  async update(id: string, dto: any, actorUserId?: string) {
    const olt = await this.findById(id);

    if (dto.password) {
      olt.passwordEnc = encryptCredential(dto.password);
    }
    if (dto.enablePassword !== undefined) {
      olt.enablePasswordEnc = dto.enablePassword ? encryptCredential(dto.enablePassword) : undefined;
    }

    if (dto.name !== undefined) olt.name = dto.name;
    if (dto.vendor !== undefined) olt.vendor = dto.vendor;
    if (dto.model !== undefined) olt.model = dto.model;
    if (dto.host !== undefined) olt.host = dto.host;
    if (dto.port !== undefined) olt.port = dto.port;
    if (dto.apiProtocol !== undefined) olt.apiProtocol = dto.apiProtocol;
    if (dto.username !== undefined) olt.username = dto.username;
    if (dto.connectionMethod !== undefined) olt.connectionMethod = dto.connectionMethod;
    if (dto.viaNodeId !== undefined) olt.viaNodeId = dto.viaNodeId;
    if (dto.natPort !== undefined) olt.natPort = dto.natPort;
    if (dto.zoneId !== undefined) olt.zoneId = dto.zoneId;
    if (dto.mgmtVlanId !== undefined) olt.mgmtVlanId = dto.mgmtVlanId;
    if (dto.notes !== undefined) olt.notes = dto.notes;
    if (dto.isActive !== undefined) olt.isActive = dto.isActive;

    await this.oltRepository.save(olt);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `OLT modificada: "${olt.name}"`,
      actorUserId,
    });

    return this.findById(id);
  }

  async testConnection(id: string, actorUserId?: string) {
    const olt = await this.findById(id);
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const start = Date.now();
    const test = await driver.testConnection(connParams);
    olt.lastCheckedAt = new Date();

    if (test.ok) {
      olt.connectionStatus = 'CONECTADO';
      olt.lastSuccessfulConnectionAt = new Date();

      // Intentar refrescar versión y uptime
      try {
        const sysInfo = await driver.getSystemInfo(connParams);
        olt.firmwareVersion = sysInfo.firmwareVersion;
      } catch {
        // Ignorar fallo secundario de system-info (incluye DriverNotImplementedError)
      }
    } else {
      olt.connectionStatus = test.error?.includes('Login fallido') ? 'ERROR_AUTH' : 'INALCANZABLE';
    }

    await this.oltRepository.save(olt);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: test.ok ? 'SUCCESS' : 'FAILURE',
      message: `[${olt.vendor}] testConnection en OLT "${olt.name}": ${test.ok ? 'conectado' : test.error}.`,
      actorUserId,
      rawDetails: {
        oltId: olt.id,
        vendor: olt.vendor,
        model: olt.model,
        driverName: driver.constructor.name,
        operation: 'testConnection',
        durationMs: Date.now() - start,
      },
    });

    return {
      ok: test.ok,
      status: olt.connectionStatus,
      latencyMs: test.latencyMs,
      error: test.error,
      firmwareVersion: olt.firmwareVersion,
    };
  }

  /**
   * Ejecuta el escaneo de interfaces físicas/PON (RF-OLT-012) y persiste en net.olt_interfaces.
   */
  async discoverInterfaces(id: string, actorUserId?: string) {
    const olt = await this.findById(id);
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const start = Date.now();
    const discovered = await this.callDriver(() => driver.discoverInterfaces(connParams));

    for (const iface of discovered) {
      let existing = await this.ifaceRepository.findOneBy({
        oltId: olt.id,
        name: iface.name,
      });

      if (!existing) {
        existing = this.ifaceRepository.create({
          oltId: olt.id,
          name: iface.name,
          type: iface.type,
          slot: iface.slot,
          port: iface.port,
        });
      }

      existing.adminState = iface.adminState;
      existing.operState = iface.operState;
      await this.ifaceRepository.save(existing);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Descubrimiento de interfaces completado para OLT "${olt.name}": ${discovered.length} interfaces detectadas.`,
      actorUserId,
      rawDetails: {
        oltId: olt.id,
        vendor: olt.vendor,
        model: olt.model,
        driverName: driver.constructor.name,
        operation: 'discoverInterfaces',
        durationMs: Date.now() - start,
      },
    });

    return this.ifaceRepository.find({ where: { oltId: olt.id }, order: { name: 'ASC' } });
  }

  /**
   * Consola OLT (solo ADMIN): ejecuta un comando Telnet arbitrario tal cual
   * el operador lo escriba -- sin validación ni allowlist por diseño, mismo
   * concepto que RouterConsoleService para MikroTik. Serializado con
   * withOltTelnetLock para no competir por el único canal Telnet del equipo
   * contra el cron de monitoreo/discovery (ver olt-telnet-mutex.ts).
   */
  async runRawCommand(id: string, command: string, actorUserId?: string): Promise<{ output: string }> {
    const trimmed = (command || '').trim();
    if (!trimmed) {
      throw new BadRequestException('El comando no puede estar vacío.');
    }

    const olt = await this.findById(id);
    const driver = this.resolveDriver(olt);

    if (typeof driver.runRawCommand !== 'function') {
      throw new HttpException(
        {
          code: 'DRIVER_NOT_IMPLEMENTED',
          message: `[${olt.vendor}] la Consola OLT todavía no está implementada para este fabricante.`,
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    const connParams = await this.connectionResolver.resolve(olt);
    const start = Date.now();

    try {
      const output = await withOltTelnetLock(olt.id, () => driver.runRawCommand!(connParams, trimmed));

      await this.deviceOperationLogger.logEvent({
        nodeId: olt.viaNodeId || olt.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `[${olt.vendor}] Comando de consola ejecutado en OLT "${olt.name}": ${trimmed}`,
        actorUserId,
        rawDetails: {
          oltId: olt.id,
          vendor: olt.vendor,
          model: olt.model,
          driverName: driver.constructor.name,
          operation: 'runRawCommand',
          command: trimmed,
          output: output.slice(0, 5000),
          durationMs: Date.now() - start,
        },
      });

      return { output };
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: olt.viaNodeId || olt.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        message: `[${olt.vendor}] Comando de consola falló en OLT "${olt.name}": ${trimmed} -- ${err?.message}`,
        actorUserId,
        rawDetails: {
          oltId: olt.id,
          vendor: olt.vendor,
          model: olt.model,
          operation: 'runRawCommand',
          command: trimmed,
          durationMs: Date.now() - start,
        },
      });
      throw new BadRequestException(err?.message || 'Error al ejecutar el comando en la OLT.');
    }
  }

  async generateBackup(
    id: string,
    actorUserId?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const olt = await this.findById(id);
    const interfaces = await this.ifaceRepository.find({ where: { oltId: id }, order: { name: 'ASC' } });
    const onus = await this.onuRepository.find({ where: { oltId: id }, order: { ponInterface: 'ASC', onuIndex: 'ASC' } });

    let runningConfig = '';
    try {
      const driver = this.resolveDriver(olt);
      if (typeof driver.getRunningConfig === 'function') {
        const connParams = await this.connectionResolver.resolve(olt);
        runningConfig = await driver.getRunningConfig(connParams);
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo obtener running-config CLI de la OLT ${olt.name}: ${err?.message}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeOltName = (olt.name || 'olt').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `sumtech_olt_${safeOltName}_${timestamp}.txt`;

    const sections: string[] = [];
    sections.push('================================================================================');
    sections.push(` SUMTECH OLT CONFIGURATION BACKUP`);
    sections.push(` OLT: ${olt.name} (${olt.vendor} ${olt.model || ''})`);
    sections.push(` IP/Host: ${olt.host}:${olt.port} (Protocolo: ${olt.apiProtocol})`);
    sections.push(` Firmware Version: ${olt.firmwareVersion || 'N/A'}`);
    sections.push(` Timestamp: ${new Date().toISOString()}`);
    sections.push('================================================================================\n');

    sections.push('--- INTERFACES FÍSICAS & PUERTOS PON ---');
    if (interfaces.length === 0) {
      sections.push('Ninguna interfaz descubierta.');
    } else {
      for (const iface of interfaces) {
        sections.push(`- ${iface.name} [Tipo: ${iface.type}, Slot: ${iface.slot}, Port: ${iface.port}, Admin: ${iface.adminState}, Oper: ${iface.operState}]`);
      }
    }
    sections.push('');

    sections.push('--- ONUs / ONTs REGISTRADAS ---');
    if (onus.length === 0) {
      sections.push('Ninguna ONU registrada en esta OLT.');
    } else {
      for (const onu of onus) {
        sections.push(
          `- SN: ${onu.serialNumber} | Índice: ${onu.onuIndex || 'N/A'} | Modelo: ${onu.model || 'N/A'} | Estado: ${onu.status}`,
        );
      }
    }
    sections.push('');

    if (runningConfig.trim().length > 0) {
      sections.push('--- CLI RUNNING CONFIGURATION DUMP ---');
      sections.push(runningConfig);
      sections.push('');
    }

    const content = sections.join('\n');
    const buffer = Buffer.from(content, 'utf-8');

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Respaldo de configuración generado y descargado para OLT "${olt.name}".`,
      actorUserId,
      rawDetails: {
        oltId: olt.id,
        filename,
        hasRunningConfig: runningConfig.trim().length > 0,
        interfacesCount: interfaces.length,
        onusCount: onus.length,
      },
    });

    return {
      buffer,
      filename,
      contentType: 'text/plain; charset=utf-8',
    };
  }
}
