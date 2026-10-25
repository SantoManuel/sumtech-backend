import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsFirmwareService } from './genieacs-firmware.service';

describe('GenieAcsFirmwareService', () => {
  let mockClient: { getDeviceStatus: jest.Mock; getParameterValues: jest.Mock; downloadFile: jest.Mock };
  let mockWriteService: { auditAction: jest.Mock };
  let mockStorage: { uploadBuffer: jest.Mock; getPresignedUrl: jest.Mock };
  let mockRepository: any;

  beforeEach(() => {
    mockClient = { getDeviceStatus: jest.fn(), getParameterValues: jest.fn(), downloadFile: jest.fn() };
    mockWriteService = { auditAction: jest.fn().mockResolvedValue(undefined) };
    mockStorage = {
      uploadBuffer: jest.fn().mockResolvedValue('cpe-firmware/abc_firmware.bin'),
      getPresignedUrl: jest.fn().mockResolvedValue('https://minio.sumtech.local/firmware/abc.bin?sig=xyz'),
    };
    mockRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'fw-1', ...data })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };
  });

  const makeService = () =>
    new GenieAcsFirmwareService(mockClient as any, mockWriteService as any, mockStorage as any, mockRepository);

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsFirmwareService(null, mockWriteService as any, mockStorage as any, mockRepository);

    await expect(service.pushFirmware('DEV-01', 'fw-1', 'V1', 'admin')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('uploadFirmware', () => {
    it('calcula el checksum SHA-256 real del archivo y lo guarda junto al objectKey de MinIO', async () => {
      const buffer = Buffer.from('contenido-del-firmware');

      const result = await makeService().uploadFirmware(
        buffer,
        'firmware.bin',
        { vendor: 'ZTE', version: 'V8.0.10P2' },
        'admin@sumtech.com',
      );

      expect(mockStorage.uploadBuffer).toHaveBeenCalledWith(buffer, 'firmware.bin', 'cpe-firmware', 'application/octet-stream');
      expect(mockRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          vendor: 'ZTE',
          version: 'V8.0.10P2',
          objectKey: 'cpe-firmware/abc_firmware.bin',
          checksumSha256: require('crypto').createHash('sha256').update(buffer).digest('hex'),
          fileSizeBytes: buffer.length,
          uploadedBy: 'admin@sumtech.com',
        }),
      );
      expect(result.id).toBe('fw-1');
    });
  });

  describe('pushFirmware', () => {
    it('rechaza con NotFoundException si el firmware no existe en el catálogo', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(makeService().pushFirmware('DEV-01', 'fw-inexistente', 'V1', 'admin')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockClient.downloadFile).not.toHaveBeenCalled();
    });

    it('rechaza con BadRequestException si la versión de confirmación no coincide exactamente', async () => {
      mockRepository.findOne.mockResolvedValue({ id: 'fw-1', version: 'V8.0.10P2', objectKey: 'x', fileSizeBytes: 100 });

      await expect(makeService().pushFirmware('DEV-01', 'fw-1', 'V8.0.10P1', 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockClient.downloadFile).not.toHaveBeenCalled();
    });

    it('con la confirmación correcta, dispara la descarga con una URL prefirmada y audita antes/después', async () => {
      mockRepository.findOne.mockResolvedValue({
        id: 'fw-1',
        version: 'V8.0.10P2',
        objectKey: 'cpe-firmware/abc.bin',
        fileSizeBytes: 5000,
      });
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.DeviceInfo.SoftwareVersion': 'V8.0.10P1' });
      mockClient.downloadFile.mockResolvedValue(undefined);

      const result = await makeService().pushFirmware('DEV-01', 'fw-1', 'V8.0.10P2', 'admin@sumtech.com');

      expect(mockClient.downloadFile).toHaveBeenCalledWith('DEV-01', {
        fileType: '1 Firmware Upgrade Image',
        url: 'https://minio.sumtech.local/firmware/abc.bin?sig=xyz',
        fileSize: 5000,
        targetFileName: 'V8.0.10P2',
      });
      expect(result).toEqual({ softwareVersionBefore: 'V8.0.10P1', targetVersion: 'V8.0.10P2' });
      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin@sumtech.com', action: 'FIRMWARE_PUSH' },
        { parameterPath: 'Device.DeviceInfo.SoftwareVersion', oldValue: 'V8.0.10P1', newValue: 'V8.0.10P2' },
        'OK',
      );
    });

    it('si el equipo rechaza la descarga, audita ERROR y re-lanza', async () => {
      mockRepository.findOne.mockResolvedValue({ id: 'fw-1', version: 'V2', objectKey: 'x', fileSizeBytes: 100 });
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({});
      mockClient.downloadFile.mockRejectedValue(new Error('Download rejected'));

      await expect(makeService().pushFirmware('DEV-01', 'fw-1', 'V2', 'admin')).rejects.toThrow('Download rejected');

      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin', action: 'FIRMWARE_PUSH' },
        expect.objectContaining({ newValue: 'V2' }),
        'ERROR',
        'Download rejected',
      );
    });
  });

  describe('administración del catálogo', () => {
    it('deleteFirmware delega al repositorio', async () => {
      await makeService().deleteFirmware('fw-1');

      expect(mockRepository.delete).toHaveBeenCalledWith('fw-1');
    });
  });
});
