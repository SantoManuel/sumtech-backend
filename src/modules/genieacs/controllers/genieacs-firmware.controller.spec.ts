import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GenieAcsFirmwareController } from './genieacs-firmware.controller';
import { GenieAcsFirmwareService } from '../services/genieacs-firmware.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

describe('GenieAcsFirmwareController', () => {
  let controller: GenieAcsFirmwareController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      listFirmware: jest.fn().mockResolvedValue([{ id: 'fw-1', vendor: 'ZTE' }]),
      uploadFirmware: jest.fn().mockResolvedValue({ id: 'fw-2' }),
      deleteFirmware: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GenieAcsFirmwareController],
      providers: [
        { provide: GenieAcsFirmwareService, useValue: mockService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: TenantContextService,
          useValue: { hasContext: jest.fn().mockReturnValue(true), getTenantId: jest.fn(), getSlug: jest.fn().mockReturnValue('sumtech') },
        },
      ],
    }).compile();

    controller = module.get<GenieAcsFirmwareController>(GenieAcsFirmwareController);
  });

  it('list delega el filtro de vendor', async () => {
    const result = await controller.list('ZTE');

    expect(mockService.listFirmware).toHaveBeenCalledWith('ZTE');
    expect(result).toEqual([{ id: 'fw-1', vendor: 'ZTE' }]);
  });

  it('upload rechaza sin archivo adjunto', async () => {
    await expect(
      controller.upload(undefined as any, { vendor: 'ZTE', version: 'V1' } as any, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(mockService.uploadFirmware).not.toHaveBeenCalled();
  });

  it('upload delega con el buffer, nombre original y actor', async () => {
    const file = { buffer: Buffer.from('fw-bytes'), originalname: 'firmware.bin' } as Express.Multer.File;
    const dto = { vendor: 'ZTE', version: 'V8.0.10P2' } as any;

    const result = await controller.upload(file, dto, 'user-1');

    expect(mockService.uploadFirmware).toHaveBeenCalledWith(file.buffer, 'firmware.bin', dto, 'user-1');
    expect(result).toEqual({ id: 'fw-2' });
  });

  it('remove delega al servicio', async () => {
    const result = await controller.remove('fw-1');

    expect(mockService.deleteFirmware).toHaveBeenCalledWith('fw-1');
    expect(result).toEqual({ success: true });
  });
});
