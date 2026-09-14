import { Test, TestingModule } from '@nestjs/testing';
import { MinioStorageService } from './minio-storage.service';

const bucketExistsMock = jest.fn();
const makeBucketMock = jest.fn();
const putObjectMock = jest.fn();
const presignedGetObjectMock = jest.fn();

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bucketExists: bucketExistsMock,
    makeBucket: makeBucketMock,
    putObject: putObjectMock,
    presignedGetObject: presignedGetObjectMock,
  })),
}));

describe('MinioStorageService', () => {
  let service: MinioStorageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.MINIO_BUCKET = 'sumtech-daily-closures';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MinioStorageService],
    }).compile();

    service = module.get<MinioStorageService>(MinioStorageService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('crea el bucket si no existe', async () => {
      bucketExistsMock.mockResolvedValue(false);

      await service.onModuleInit();

      expect(makeBucketMock).toHaveBeenCalledWith('sumtech-daily-closures');
    });

    it('no vuelve a crear el bucket si ya existe', async () => {
      bucketExistsMock.mockResolvedValue(true);

      await service.onModuleInit();

      expect(makeBucketMock).not.toHaveBeenCalled();
    });

    it('no lanza si falla la verificación del bucket (solo registra el error)', async () => {
      bucketExistsMock.mockRejectedValue(new Error('conexión rechazada'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('uploadBuffer', () => {
    it('sube el buffer y retorna un object key con el prefijo dado', async () => {
      putObjectMock.mockResolvedValue({ etag: 'abc' });

      const key = await service.uploadBuffer(Buffer.from('foto'), 'recibo #1.jpg', 'daily-closures/2026-09-07');

      expect(key).toMatch(/^daily-closures\/2026-09-07\//);
      expect(key).toContain('recibo__1.jpg');
      expect(putObjectMock).toHaveBeenCalledWith('sumtech-daily-closures', key, expect.any(Buffer), 4, undefined);
    });

    it('guarda el Content-Type como metadata cuando se provee, para que el navegador lo muestre inline en vez de forzar la descarga', async () => {
      putObjectMock.mockResolvedValue({ etag: 'abc' });

      const key = await service.uploadBuffer(Buffer.from('foto'), 'recibo.jpg', 'deposit-proofs/client-1', 'image/jpeg');

      expect(putObjectMock).toHaveBeenCalledWith(
        'sumtech-daily-closures',
        key,
        expect.any(Buffer),
        4,
        { 'Content-Type': 'image/jpeg' },
      );
    });
  });

  describe('getPresignedUrl', () => {
    it('genera una URL firmada con la expiración indicada', async () => {
      presignedGetObjectMock.mockResolvedValue('https://minio.local/presigned-url');

      const url = await service.getPresignedUrl('daily-closures/2026-09-07/foo.jpg', 900);

      expect(url).toBe('https://minio.local/presigned-url');
      expect(presignedGetObjectMock).toHaveBeenCalledWith('sumtech-daily-closures', 'daily-closures/2026-09-07/foo.jpg', 900);
    });
  });
});
