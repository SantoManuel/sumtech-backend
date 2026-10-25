import { ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsParameterWriteService } from './genieacs-parameter-write.service';

describe('GenieAcsParameterWriteService', () => {
  let mockClient: { getParameterValues: jest.Mock; setParameterValues: jest.Mock };
  let mockAuditRepository: { create: jest.Mock; save: jest.Mock };

  beforeEach(() => {
    mockClient = { getParameterValues: jest.fn(), setParameterValues: jest.fn() };
    mockAuditRepository = {
      create: jest.fn((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsParameterWriteService(null, mockAuditRepository as any);

    await expect(
      service.applyParameterChanges('DEV-01', [{ path: 'Device.PPP.Interface.1.Username', value: 'juan', type: 'xsd:string' }], {
        actor: 'admin@sumtech.com',
        action: 'TR069_PARAMETER_CHANGE',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('no hace ninguna llamada si la lista de cambios está vacía', async () => {
    const service = new GenieAcsParameterWriteService(mockClient as any, mockAuditRepository as any);

    await service.applyParameterChanges('DEV-01', [], { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' });

    expect(mockClient.getParameterValues).not.toHaveBeenCalled();
    expect(mockClient.setParameterValues).not.toHaveBeenCalled();
  });

  it('aplica el cambio y audita el valor viejo/nuevo cuando tiene éxito', async () => {
    mockClient.getParameterValues.mockResolvedValue({ 'Device.PPP.Interface.1.Username': 'juan-viejo' });
    mockClient.setParameterValues.mockResolvedValue(undefined);

    const service = new GenieAcsParameterWriteService(mockClient as any, mockAuditRepository as any);
    await service.applyParameterChanges(
      'DEV-01',
      [{ path: 'Device.PPP.Interface.1.Username', value: 'juan-nuevo', type: 'xsd:string' }],
      { actor: 'admin@sumtech.com', action: 'TR069_PARAMETER_CHANGE', contractId: 'contract-1' },
    );

    expect(mockClient.setParameterValues).toHaveBeenCalledWith('DEV-01', [
      ['Device.PPP.Interface.1.Username', 'juan-nuevo', 'xsd:string'],
    ]);
    expect(mockAuditRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        contractId: 'contract-1',
        genieacsDeviceId: 'DEV-01',
        action: 'TR069_PARAMETER_CHANGE',
        actor: 'admin@sumtech.com',
        result: 'OK',
        parameterPath: 'Device.PPP.Interface.1.Username',
        oldValue: 'juan-viejo',
        newValue: 'juan-nuevo',
      }),
    ]);
  });

  it('redacta contraseñas/PSK en la auditoría -- nunca guarda el secreto en texto plano', async () => {
    mockClient.getParameterValues.mockResolvedValue({ 'Device.PPP.Interface.1.Password': 'clave-vieja' });
    mockClient.setParameterValues.mockResolvedValue(undefined);

    const service = new GenieAcsParameterWriteService(mockClient as any, mockAuditRepository as any);
    await service.applyParameterChanges(
      'DEV-01',
      [{ path: 'Device.PPP.Interface.1.Password', value: 'clave-nueva', type: 'xsd:string' }],
      { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
    );

    expect(mockAuditRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ oldValue: '***', newValue: '***' }),
    ]);
  });

  it('si el equipo rechaza el cambio, audita con result ERROR y re-lanza el error original', async () => {
    mockClient.getParameterValues.mockResolvedValue({});
    mockClient.setParameterValues.mockRejectedValue(new Error('El equipo rechazó el cambio (Invalid parameter value).'));

    const service = new GenieAcsParameterWriteService(mockClient as any, mockAuditRepository as any);

    await expect(
      service.applyParameterChanges(
        'DEV-01',
        [{ path: 'Device.PPP.Interface.1.Username', value: 'juan', type: 'xsd:string' }],
        { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
      ),
    ).rejects.toThrow(/El equipo rechazó el cambio/);

    expect(mockAuditRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({ result: 'ERROR', errorMessage: 'El equipo rechazó el cambio (Invalid parameter value).' }),
    ]);
  });

  it('un lote con 2 parámetros audita 2 filas, cada una con su propio path/valor', async () => {
    mockClient.getParameterValues.mockResolvedValue({
      'Device.PPP.Interface.1.Username': 'u-viejo',
      'Device.PPP.Interface.1.ServiceName': 's-viejo',
    });
    mockClient.setParameterValues.mockResolvedValue(undefined);

    const service = new GenieAcsParameterWriteService(mockClient as any, mockAuditRepository as any);
    await service.applyParameterChanges(
      'DEV-01',
      [
        { path: 'Device.PPP.Interface.1.Username', value: 'u-nuevo', type: 'xsd:string' },
        { path: 'Device.PPP.Interface.1.ServiceName', value: 's-nuevo', type: 'xsd:string' },
      ],
      { actor: 'admin', action: 'TR069_PARAMETER_CHANGE' },
    );

    const savedRows = mockAuditRepository.save.mock.calls[0][0];
    expect(savedRows).toHaveLength(2);
    expect(savedRows[0].parameterPath).toBe('Device.PPP.Interface.1.Username');
    expect(savedRows[1].parameterPath).toBe('Device.PPP.Interface.1.ServiceName');
  });
});
