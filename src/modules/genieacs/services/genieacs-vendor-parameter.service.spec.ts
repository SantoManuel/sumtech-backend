import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsVendorParameterService } from './genieacs-vendor-parameter.service';

describe('GenieAcsVendorParameterService', () => {
  let mockClient: { getDeviceStatus: jest.Mock; getParameterValues: jest.Mock };
  let mockWriteService: { applyParameterChanges: jest.Mock };
  let mockQueryBuilder: any;
  let mockRepository: any;

  beforeEach(() => {
    mockClient = { getDeviceStatus: jest.fn(), getParameterValues: jest.fn() };
    mockWriteService = { applyParameterChanges: jest.fn().mockResolvedValue(undefined) };
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getOne: jest.fn().mockResolvedValue(null),
    };
    mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'new-id', ...data })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
  });

  const makeService = () => new GenieAcsVendorParameterService(mockClient as any, mockWriteService as any, mockRepository);

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsVendorParameterService(null, mockWriteService as any, mockRepository);

    await expect(service.getTogglesForDevice('DEV-01', 'SECURITY')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('getTogglesForDevice', () => {
    it('sin fabricante conocido, devuelve arreglo vacío sin tocar el catálogo', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: undefined, isTR181: true });

      const toggles = await makeService().getTogglesForDevice('DEV-01', 'SECURITY');

      expect(toggles).toEqual([]);
      expect(mockRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('sin ninguna fila en el catálogo para este vendor, devuelve arreglo vacío (sección honesta, no inventa)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: 'Huawei', isTR181: false });
      mockClient.getParameterValues.mockResolvedValue({});
      mockQueryBuilder.getMany.mockResolvedValue([]);

      const toggles = await makeService().getTogglesForDevice('00259E-ONT-16', 'SECURITY');

      expect(toggles).toEqual([]);
    });

    it('con una fila verificada que matchea vendor y modelo, lee su valor real', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: 'ZTE', isTR181: false });
      mockClient.getParameterValues
        .mockResolvedValueOnce({
          'InternetGatewayDevice.DeviceInfo.ModelName': 'F660',
          'InternetGatewayDevice.DeviceInfo.ProductClass': 'F660V8',
        })
        .mockResolvedValueOnce({ 'InternetGatewayDevice.X_ZTE-COM_Security.FtpEnable': 'true' });
      mockQueryBuilder.getMany.mockResolvedValue([
        {
          parameterKey: 'wanFtpEnable',
          label: 'Acceso FTP remoto',
          category: 'SECURITY',
          vendor: 'ZTE',
          modelPattern: 'F660',
          oidPath: 'InternetGatewayDevice.X_ZTE-COM_Security.FtpEnable',
          dataType: 'xsd:boolean',
        },
      ]);

      const toggles = await makeService().getTogglesForDevice('00259E-ONT-16', 'SECURITY');

      expect(toggles).toEqual([
        { parameterKey: 'wanFtpEnable', label: 'Acceso FTP remoto', category: 'SECURITY', value: true },
      ]);
    });

    it('una fila cuyo modelPattern NO matchea el modelo real queda excluida', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: 'ZTE', isTR181: false });
      mockClient.getParameterValues.mockResolvedValueOnce({
        'InternetGatewayDevice.DeviceInfo.ModelName': 'F670',
        'InternetGatewayDevice.DeviceInfo.ProductClass': 'F670V9',
      });
      mockQueryBuilder.getMany.mockResolvedValue([
        {
          parameterKey: 'wanFtpEnable',
          label: 'Acceso FTP remoto',
          category: 'SECURITY',
          vendor: 'ZTE',
          modelPattern: 'F660',
          oidPath: 'x',
          dataType: 'xsd:boolean',
        },
      ]);

      const toggles = await makeService().getTogglesForDevice('00259E-ONT-16', 'SECURITY');

      expect(toggles).toEqual([]);
    });
  });

  describe('setToggle', () => {
    it('rechaza con BadRequestException si no hay un parámetro verificado para este vendor', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: 'Huawei', isTR181: false });
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(makeService().setToggle('DEV-01', 'wanFtpEnable', true, 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockWriteService.applyParameterChanges).not.toHaveBeenCalled();
    });

    it('con un parámetro verificado, aplica el cambio vía GenieAcsParameterWriteService', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ manufacturer: 'ZTE', isTR181: false });
      mockQueryBuilder.getOne.mockResolvedValue({
        parameterKey: 'wanFtpEnable',
        oidPath: 'InternetGatewayDevice.X_ZTE-COM_Security.FtpEnable',
        dataType: 'xsd:boolean',
      });

      await makeService().setToggle('00259E-ONT-16', 'wanFtpEnable', false, 'admin@sumtech.com');

      expect(mockWriteService.applyParameterChanges).toHaveBeenCalledWith(
        '00259E-ONT-16',
        [{ path: 'InternetGatewayDevice.X_ZTE-COM_Security.FtpEnable', value: 'false', type: 'xsd:boolean' }],
        { actor: 'admin@sumtech.com', action: 'TR069_PARAMETER_CHANGE' },
      );
    });
  });

  describe('administración del catálogo', () => {
    it('createCatalogEntry guarda con el actor como createdBy', async () => {
      const dto = {
        vendor: 'ZTE',
        category: 'SECURITY' as const,
        parameterKey: 'wanFtpEnable',
        label: 'FTP',
        oidPath: 'x',
      };

      const result = await makeService().createCatalogEntry(dto, 'admin@sumtech.com');

      expect(mockRepository.save).toHaveBeenCalledWith(expect.objectContaining({ ...dto, createdBy: 'admin@sumtech.com' }));
      expect(result.id).toBe('new-id');
    });

    it('deleteCatalogEntry delega al repositorio', async () => {
      await makeService().deleteCatalogEntry('param-1');

      expect(mockRepository.delete).toHaveBeenCalledWith('param-1');
    });
  });
});
