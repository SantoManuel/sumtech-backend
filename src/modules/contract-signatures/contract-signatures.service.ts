import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractSignatureEntity, SignatureParty } from './entities/contract-signature.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { MinioStorageService } from '../storage/minio-storage.service';
import { CreateContractSignatureDto } from './dto/create-contract-signature.dto';
import { Role } from '../../common/enums/role.enum';

/** 3 MB decodificados — suficiente para un trazo de firma en PNG, sin permitir abuso. */
const MAX_SIGNATURE_IMAGE_BYTES = 3 * 1024 * 1024;
const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_PREFIX_PATTERN = /^data:image\/[a-zA-Z+.-]+;base64,/;
const BASE64_CONTENT_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const PREVIEW_URL_EXPIRY_SECONDS = 300;

const OFFICE_ROLES: string[] = [Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM];

export interface SignatureActor {
  userId: string;
  employeeId?: string;
  roles: string[];
  ipAddress?: string;
}

export interface SignatureResponse {
  id: string;
  party: SignatureParty;
  method: string;
  signedByName: string;
  signedAt: Date;
  previewUrl: string;
}

export interface ContractSignatureStatus {
  client: SignatureResponse | null;
  company: SignatureResponse | null;
}

export interface SignatureBufferForPdf {
  buffer: Buffer;
  signedByName: string;
  signedAt: Date;
}

/**
 * Firma electrónica de contratos (cliente y representante de Sumtech) — en
 * oficina (staff) o en calle (técnico, durante la instalación). Cada captura
 * es una fila INMUTABLE (nunca se actualiza ni se borra desde acá): si hace
 * falta corregir una firma, se inserta una nueva y la vigente pasa a ser la
 * de `signedAt` más reciente para esa (contractId, party) — preserva la
 * evidencia original, relevante para la validez bajo la Ley 126-02 RD.
 */
@Injectable()
export class ContractSignaturesService {
  private readonly logger = new Logger(ContractSignaturesService.name);

  constructor(
    @InjectRepository(ContractSignatureEntity)
    private readonly signatureRepository: Repository<ContractSignatureEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    private readonly storage: MinioStorageService,
  ) {}

  async create(
    clientId: string,
    contractId: string,
    dto: CreateContractSignatureDto,
    actor: SignatureActor,
  ): Promise<SignatureResponse> {
    await this.assertContractBelongsToClient(clientId, contractId);

    const isTechnicianActor = this.isTechnicianActor(actor.roles);
    if (isTechnicianActor) {
      await this.assertTechnicianOwnsInstallation(contractId, actor.employeeId);
      if (dto.latitude === undefined || dto.longitude === undefined) {
        throw new BadRequestException(
          'Se requiere la ubicación GPS del cliente para firmar un contrato como técnico en el sitio.',
        );
      }
    }

    const imageBuffer = this.decodeAndValidateSignatureImage(dto.signatureImageBase64);

    let signatureFileKey: string;
    try {
      signatureFileKey = await this.storage.uploadBuffer(
        imageBuffer,
        'firma.png',
        `contracts/signatures/${contractId}`,
        'image/png',
      );
    } catch (error) {
      this.logger.error(
        `No se pudo subir la firma del contrato ${contractId} a MinIO: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new ServiceUnavailableException('No se pudo guardar la firma en este momento. Intenta de nuevo.');
    }

    const saved = await this.signatureRepository.save(
      this.signatureRepository.create({
        contractId,
        party: dto.party,
        signatureFileKey,
        signedByName: dto.signedByName.trim(),
        method: dto.method,
        ipAddress: actor.ipAddress,
        capturedByUserId: actor.userId,
        capturedByRole: isTechnicianActor ? 'TECNICO' : 'STAFF',
        gpsLatitude: isTechnicianActor ? dto.latitude : undefined,
        gpsLongitude: isTechnicianActor ? dto.longitude : undefined,
      }),
    );

    return this.toResponse(saved);
  }

  async getStatus(clientId: string, contractId: string): Promise<ContractSignatureStatus> {
    await this.assertContractBelongsToClient(clientId, contractId);

    const [client, company] = await Promise.all([
      this.getLatestRow(contractId, 'CLIENT'),
      this.getLatestRow(contractId, 'COMPANY'),
    ]);

    return {
      client: client ? await this.toResponse(client) : null,
      company: company ? await this.toResponse(company) : null,
    };
  }

  /**
   * Para PdfGeneratorService: intenta traer la imagen ya decodificada de la
   * firma vigente. Nunca lanza — si MinIO no responde o el objeto ya no
   * existe, el PDF debe seguir generándose (con la línea en blanco de
   * siempre), no fallar por completo.
   */
  async getLatestBufferForPdf(contractId: string, party: SignatureParty): Promise<SignatureBufferForPdf | null> {
    const row = await this.getLatestRow(contractId, party);
    if (!row) {
      return null;
    }

    try {
      const buffer = await this.storage.getObjectBuffer(row.signatureFileKey);
      return { buffer, signedByName: row.signedByName, signedAt: row.signedAt };
    } catch (error) {
      this.logger.warn(
        `No se pudo descargar la firma (${party}) del contrato ${contractId} para el PDF: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async getLatestRow(contractId: string, party: SignatureParty): Promise<ContractSignatureEntity | null> {
    return this.signatureRepository.findOne({
      where: { contractId, party },
      order: { signedAt: 'DESC' },
    });
  }

  private async assertContractBelongsToClient(clientId: string, contractId: string): Promise<void> {
    const contract = await this.contractRepository.findOne({ where: { id: contractId, clientId } });
    if (!contract) {
      throw new NotFoundException(`Contrato ${contractId} no encontrado para el cliente ${clientId}`);
    }
  }

  private isTechnicianActor(roles: string[]): boolean {
    return roles.includes(Role.TECNICO) && !roles.some((role) => OFFICE_ROLES.includes(role));
  }

  private async assertTechnicianOwnsInstallation(contractId: string, employeeId?: string): Promise<void> {
    if (!employeeId) {
      throw new ForbiddenException('No se pudo identificar tu ficha de empleado para firmar este contrato.');
    }

    const ticket = await this.ticketRepository.findOne({
      where: { contractId, type: 'INSTALLATION', assignedEmployeeId: employeeId },
    });

    if (!ticket) {
      throw new ForbiddenException('Solo puedes firmar contratos de instalaciones que tengas asignadas.');
    }
  }

  private decodeAndValidateSignatureImage(rawInput: string): Buffer {
    const base64Payload = rawInput.replace(DATA_URL_PREFIX_PATTERN, '');

    if (!base64Payload || !BASE64_CONTENT_PATTERN.test(base64Payload)) {
      throw new BadRequestException('La imagen de la firma no es un base64 válido.');
    }

    const buffer = Buffer.from(base64Payload, 'base64');
    if (buffer.length === 0) {
      throw new BadRequestException('La imagen de la firma está vacía.');
    }
    if (buffer.length > MAX_SIGNATURE_IMAGE_BYTES) {
      throw new BadRequestException('La imagen de la firma excede el tamaño máximo permitido (3MB).');
    }
    if (!buffer.subarray(0, PNG_MAGIC_BYTES.length).equals(PNG_MAGIC_BYTES)) {
      throw new BadRequestException('La imagen de la firma debe ser un PNG válido.');
    }

    return buffer;
  }

  private async toResponse(entity: ContractSignatureEntity): Promise<SignatureResponse> {
    const previewUrl = await this.storage.getPresignedUrl(entity.signatureFileKey, PREVIEW_URL_EXPIRY_SECONDS);
    return {
      id: entity.id,
      party: entity.party,
      method: entity.method,
      signedByName: entity.signedByName,
      signedAt: entity.signedAt,
      previewUrl,
    };
  }
}
