import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ContractSignaturesService, SignatureActor } from './contract-signatures.service';
import { ContractSignatureEntity } from './entities/contract-signature.entity';
import { ContractEntity } from '../clients/entities/contract.entity';
import { TicketEntity } from '../tickets/entities/ticket.entity';
import { MinioStorageService } from '../storage/minio-storage.service';
import { CreateContractSignatureDto } from './dto/create-contract-signature.dto';
import { Role } from '../../common/enums/role.enum';

// PNG transparente de 1x1 válido en base64 — el mismo fixture usado en
// pdf-generator.service.spec.ts para no depender de un archivo externo.
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('ContractSignaturesService', () => {
  let service: ContractSignaturesService;
  let signatureRepo: any;
  let contractRepo: any;
  let ticketRepo: any;
  let storage: any;

  const staffActor: SignatureActor = { userId: 'user-staff-1', roles: [Role.CAJERO], ipAddress: '10.0.0.5' };
  const technicianActor: SignatureActor = {
    userId: 'user-tech-1',
    employeeId: 'employee-tech-1',
    roles: [Role.TECNICO],
    ipAddress: '10.0.0.9',
  };

  const baseDto: CreateContractSignatureDto = {
    party: 'CLIENT',
    signatureImageBase64: VALID_PNG_BASE64,
    signedByName: 'Carlos Mendoza',
    method: 'DRAW',
  };

  beforeEach(async () => {
    signatureRepo = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'sig-1', signedAt: new Date('2026-03-01T12:00:00Z'), ...data })),
      findOne: jest.fn().mockResolvedValue(null),
    };
    contractRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'contract-1', clientId: 'client-1' }),
    };
    ticketRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    storage = {
      uploadBuffer: jest.fn().mockResolvedValue('contracts/signatures/contract-1/firma.png'),
      getPresignedUrl: jest.fn().mockResolvedValue('https://minio.local/presigned-preview'),
      getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('imagen-firma')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractSignaturesService,
        { provide: getRepositoryToken(ContractSignatureEntity), useValue: signatureRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(TicketEntity), useValue: ticketRepo },
        { provide: MinioStorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<ContractSignaturesService>(ContractSignaturesService);
  });

  describe('create — casos exitosos', () => {
    it('guarda la firma del cliente capturada por staff en oficina', async () => {
      const result = await service.create('client-1', 'contract-1', baseDto, staffActor);

      expect(storage.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'firma.png',
        'contracts/signatures/contract-1',
        'image/png',
      );
      expect(signatureRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-1',
          party: 'CLIENT',
          signedByName: 'Carlos Mendoza',
          capturedByUserId: 'user-staff-1',
          capturedByRole: 'STAFF',
          ipAddress: '10.0.0.5',
          gpsLatitude: undefined,
          gpsLongitude: undefined,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ id: 'sig-1', party: 'CLIENT', signedByName: 'Carlos Mendoza', previewUrl: 'https://minio.local/presigned-preview' }),
      );
    });

    it('acepta un data URL completo ("data:image/png;base64,...") y lo decodifica igual', async () => {
      await service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: `data:image/png;base64,${VALID_PNG_BASE64}` }, staffActor);

      expect(storage.uploadBuffer).toHaveBeenCalled();
    });

    it('permite firma de "COMPANY" capturada por staff', async () => {
      await service.create('client-1', 'contract-1', { ...baseDto, party: 'COMPANY', signedByName: 'Maria Representante' }, staffActor);

      expect(signatureRepo.save).toHaveBeenCalledWith(expect.objectContaining({ party: 'COMPANY', signedByName: 'Maria Representante' }));
    });

    it('permite al técnico firmar cuando tiene un ticket de INSTALLATION asignado para ese contrato, y guarda el GPS', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 'ticket-1', contractId: 'contract-1', type: 'INSTALLATION', assignedEmployeeId: 'employee-tech-1' });

      await service.create(
        'client-1',
        'contract-1',
        { ...baseDto, latitude: 18.4861, longitude: -69.9312 },
        technicianActor,
      );

      expect(ticketRepo.findOne).toHaveBeenCalledWith({
        where: { contractId: 'contract-1', type: 'INSTALLATION', assignedEmployeeId: 'employee-tech-1' },
      });
      expect(signatureRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ capturedByRole: 'TECNICO', gpsLatitude: 18.4861, gpsLongitude: -69.9312 }),
      );
    });
  });

  describe('create — validación de la imagen', () => {
    it('rechaza un base64 vacío', async () => {
      await expect(service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: '' }, staffActor)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza una cadena que no es base64 válido', async () => {
      await expect(
        service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: 'esto-no-es-base64-!!!' }, staffActor),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una imagen que no es un PNG real (magic bytes incorrectos)', async () => {
      const fakeImage = Buffer.from('esto no es un png').toString('base64');
      await expect(service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: fakeImage }, staffActor)).rejects.toThrow(
        'La imagen de la firma debe ser un PNG válido.',
      );
    });

    it('rechaza una imagen que excede el tamaño máximo permitido (3MB)', async () => {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const oversized = Buffer.concat([pngMagic, Buffer.alloc(3 * 1024 * 1024 + 1, 0)]).toString('base64');
      await expect(service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: oversized }, staffActor)).rejects.toThrow(
        'excede el tamaño máximo',
      );
    });

    it('no llega a llamar a MinIO si la imagen es inválida', async () => {
      await expect(
        service.create('client-1', 'contract-1', { ...baseDto, signatureImageBase64: 'no-valido-!!' }, staffActor),
      ).rejects.toThrow(BadRequestException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  describe('create — reglas de propiedad y GPS del técnico', () => {
    it('rechaza al técnico si no tiene ningún ticket de INSTALLATION asignado para ese contrato', async () => {
      ticketRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create('client-1', 'contract-1', { ...baseDto, latitude: 18.48, longitude: -69.93 }, technicianActor),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza al técnico sin employeeId identificable (token corrupto/incompleto)', async () => {
      await expect(
        service.create(
          'client-1',
          'contract-1',
          { ...baseDto, latitude: 18.48, longitude: -69.93 },
          { userId: 'user-x', roles: [Role.TECNICO] },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('exige GPS cuando firma un técnico, aunque tenga el ticket asignado', async () => {
      ticketRepo.findOne.mockResolvedValue({ id: 'ticket-1', assignedEmployeeId: 'employee-tech-1' });

      await expect(service.create('client-1', 'contract-1', baseDto, technicianActor)).rejects.toThrow(BadRequestException);
    });

    it('un usuario con rol TECNICO + ADMIN (ej. doble rol) se trata como staff — no exige ticket ni GPS', async () => {
      const mixedActor: SignatureActor = { userId: 'user-mix', employeeId: 'employee-mix', roles: [Role.TECNICO, Role.ADMIN] };

      await service.create('client-1', 'contract-1', baseDto, mixedActor);

      expect(ticketRepo.findOne).not.toHaveBeenCalled();
      expect(signatureRepo.save).toHaveBeenCalledWith(expect.objectContaining({ capturedByRole: 'STAFF' }));
    });
  });

  describe('create — contrato inexistente o de otro cliente', () => {
    it('lanza NotFoundException si el contrato no existe o no pertenece al cliente', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.create('client-1', 'contract-inexistente', baseDto, staffActor)).rejects.toThrow(NotFoundException);
      expect(storage.uploadBuffer).not.toHaveBeenCalled();
    });
  });

  describe('create — fallos de MinIO', () => {
    it('traduce un fallo de subida a MinIO en un ServiceUnavailableException, sin insertar la fila', async () => {
      storage.uploadBuffer.mockRejectedValue(new Error('conexión rechazada'));

      await expect(service.create('client-1', 'contract-1', baseDto, staffActor)).rejects.toThrow(ServiceUnavailableException);
      expect(signatureRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('devuelve null en ambas partes si el contrato no tiene ninguna firma todavía', async () => {
      const result = await service.getStatus('client-1', 'contract-1');

      expect(result).toEqual({ client: null, company: null });
    });

    it('devuelve la firma vigente (más reciente) de cada parte con su previewUrl', async () => {
      signatureRepo.findOne
        .mockResolvedValueOnce({ id: 'sig-client', party: 'CLIENT', signatureFileKey: 'k1', signedByName: 'Carlos', method: 'DRAW', signedAt: new Date('2026-03-01') })
        .mockResolvedValueOnce({ id: 'sig-company', party: 'COMPANY', signatureFileKey: 'k2', signedByName: 'Maria', method: 'TYPE', signedAt: new Date('2026-03-02') });

      const result = await service.getStatus('client-1', 'contract-1');

      expect(result.client).toEqual(expect.objectContaining({ id: 'sig-client', signedByName: 'Carlos', previewUrl: 'https://minio.local/presigned-preview' }));
      expect(result.company).toEqual(expect.objectContaining({ id: 'sig-company', signedByName: 'Maria' }));
    });

    it('consulta la fila más reciente por signedAt (una por CLIENT, una por COMPANY)', async () => {
      await service.getStatus('client-1', 'contract-1');

      expect(signatureRepo.findOne).toHaveBeenCalledWith({ where: { contractId: 'contract-1', party: 'CLIENT' }, order: { signedAt: 'DESC' } });
      expect(signatureRepo.findOne).toHaveBeenCalledWith({ where: { contractId: 'contract-1', party: 'COMPANY' }, order: { signedAt: 'DESC' } });
    });

    it('lanza NotFoundException si el contrato no pertenece al cliente', async () => {
      contractRepo.findOne.mockResolvedValue(null);

      await expect(service.getStatus('client-1', 'contract-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLatestBufferForPdf', () => {
    it('devuelve null si no hay ninguna firma para esa party', async () => {
      const result = await service.getLatestBufferForPdf('contract-1', 'CLIENT');

      expect(result).toBeNull();
    });

    it('descarga y devuelve el buffer de la firma vigente', async () => {
      signatureRepo.findOne.mockResolvedValue({
        signatureFileKey: 'contracts/signatures/contract-1/firma.png',
        signedByName: 'Carlos Mendoza',
        signedAt: new Date('2026-03-01T12:00:00Z'),
      });

      const result = await service.getLatestBufferForPdf('contract-1', 'CLIENT');

      expect(storage.getObjectBuffer).toHaveBeenCalledWith('contracts/signatures/contract-1/firma.png');
      expect(result).toEqual({ buffer: Buffer.from('imagen-firma'), signedByName: 'Carlos Mendoza', signedAt: new Date('2026-03-01T12:00:00Z') });
    });

    it('devuelve null (no lanza) si MinIO falla al descargar la imagen — el PDF debe poder seguir generándose', async () => {
      signatureRepo.findOne.mockResolvedValue({ signatureFileKey: 'k1', signedByName: 'Carlos', signedAt: new Date() });
      storage.getObjectBuffer.mockRejectedValue(new Error('objeto no encontrado'));

      const result = await service.getLatestBufferForPdf('contract-1', 'CLIENT');

      expect(result).toBeNull();
    });
  });
});
