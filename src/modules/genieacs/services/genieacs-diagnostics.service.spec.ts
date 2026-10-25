import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsDiagnosticsService } from './genieacs-diagnostics.service';

describe('GenieAcsDiagnosticsService', () => {
  let mockClient: { getDeviceStatus: jest.Mock; getParameterValues: jest.Mock; setParameterValues: jest.Mock };
  let mockWriteService: { auditAction: jest.Mock };

  beforeEach(() => {
    mockClient = { getDeviceStatus: jest.fn(), getParameterValues: jest.fn(), setParameterValues: jest.fn() };
    mockWriteService = { auditAction: jest.fn().mockResolvedValue(undefined) };
  });

  const makeService = () => new GenieAcsDiagnosticsService(mockClient as any, mockWriteService as any);

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsDiagnosticsService(null, mockWriteService as any);

    await expect(service.triggerDiagnostic('DEV-01', 'PING', {}, 'admin')).rejects.toThrow(ServiceUnavailableException);
  });

  describe('triggerDiagnostic', () => {
    it('PING: exige host y manda NumberOfRepetitions con default 4', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });

      await expect(makeService().triggerDiagnostic('DEV-01', 'PING', {}, 'admin')).rejects.toThrow(BadRequestException);

      await makeService().triggerDiagnostic('DEV-01', 'PING', { host: '8.8.8.8' }, 'admin');

      expect(mockClient.setParameterValues).toHaveBeenCalledWith('DEV-01', [
        ['Device.IPPingDiagnostics.Host', '8.8.8.8', 'xsd:string'],
        ['Device.IPPingDiagnostics.NumberOfRepetitions', '4', 'xsd:unsignedInt'],
        ['Device.IPPingDiagnostics.DiagnosticsState', 'Requested', 'xsd:string'],
      ]);
      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin', action: 'DIAGNOSTIC_RUN' },
        { parameterPath: 'Device.IPPingDiagnostics.DiagnosticsState', newValue: 'PING' },
        'OK',
      );
    });

    it('SITE_SURVEY en TR-098 lanza BadRequestException (no estandarizado)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });

      await expect(makeService().triggerDiagnostic('00259E-ONT-16', 'SITE_SURVEY', {}, 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockClient.setParameterValues).not.toHaveBeenCalled();
    });

    it('SITE_SURVEY en TR-181 no requiere parámetros', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });

      await makeService().triggerDiagnostic('DEV-01', 'SITE_SURVEY', {}, 'admin');

      expect(mockClient.setParameterValues).toHaveBeenCalledWith('DEV-01', [
        ['Device.WiFi.NeighboringWiFiDiagnostic.DiagnosticsState', 'Requested', 'xsd:string'],
      ]);
    });

    it('UPLOAD exige uploadUrl y testFileLength juntos', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });

      await expect(
        makeService().triggerDiagnostic('DEV-01', 'UPLOAD', { uploadUrl: 'http://x/f' }, 'admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('si el CPE rechaza el disparo, audita ERROR y re-lanza', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.setParameterValues.mockRejectedValue(new Error('Invalid parameter value'));

      await expect(makeService().triggerDiagnostic('DEV-01', 'PING', { host: '8.8.8.8' }, 'admin')).rejects.toThrow(
        'Invalid parameter value',
      );
      expect(mockWriteService.auditAction).toHaveBeenCalledWith(
        'DEV-01',
        { actor: 'admin', action: 'DIAGNOSTIC_RUN' },
        { parameterPath: 'Device.IPPingDiagnostics.DiagnosticsState', newValue: 'PING' },
        'ERROR',
        'Invalid parameter value',
      );
    });
  });

  describe('getDiagnosticStatus', () => {
    it('NOT_SUPPORTED si el equipo no reporta el parámetro DiagnosticsState', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: false });
      mockClient.getParameterValues.mockResolvedValue({});

      const result = await makeService().getDiagnosticStatus('00259E-ONT-16', 'SITE_SURVEY');

      expect(result).toEqual({ status: 'NOT_SUPPORTED' });
    });

    it('NOT_STARTED si el estado es "None"', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.IPPingDiagnostics.DiagnosticsState': 'None' });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'PING');

      expect(result).toEqual({ status: 'NOT_STARTED' });
    });

    it('RUNNING mientras el estado no sea Complete ni Error', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({ 'Device.IPPingDiagnostics.DiagnosticsState': 'Requested' });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'PING');

      expect(result).toEqual({ status: 'RUNNING' });
    });

    it('ERROR cuando el estado empieza con "Error" -- expone el estado real como mensaje', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({
        'Device.IPPingDiagnostics.DiagnosticsState': 'Error_CannotResolveHostName',
      });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'PING');

      expect(result).toEqual({ status: 'ERROR', errorMessage: 'Error_CannotResolveHostName' });
    });

    it('COMPLETE: parsea los campos numéricos del resultado', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockResolvedValue({
        'Device.IPPingDiagnostics.DiagnosticsState': 'Complete',
        'Device.IPPingDiagnostics.SuccessCount': '4',
        'Device.IPPingDiagnostics.FailureCount': '0',
        'Device.IPPingDiagnostics.AverageResponseTime': '23',
        'Device.IPPingDiagnostics.MinimumResponseTime': '20',
        'Device.IPPingDiagnostics.MaximumResponseTime': '30',
      });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'PING');

      expect(result).toEqual({
        status: 'COMPLETE',
        result: { successCount: 4, failureCount: 0, averageResponseTime: 23, minimumResponseTime: 20, maximumResponseTime: 30 },
      });
    });

    it('TRACEROUTE completo trae los saltos de ruta (routeHops)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockImplementation((_id: string, paths: string[]) => {
        const master: Record<string, string> = {
          'Device.TraceRouteDiagnostics.DiagnosticsState': 'Complete',
          'Device.TraceRouteDiagnostics.ResponseTime': '15',
          'Device.TraceRouteDiagnostics.RouteHopsNumberOfEntries': '2',
          'Device.TraceRouteDiagnostics.RouteHops.1.Host': 'hop1.isp.net',
          'Device.TraceRouteDiagnostics.RouteHops.1.HostAddress': '10.0.0.1',
          'Device.TraceRouteDiagnostics.RouteHops.2.Host': 'hop2.isp.net',
          'Device.TraceRouteDiagnostics.RouteHops.2.HostAddress': '10.0.0.2',
        };
        const result: Record<string, string | undefined> = {};
        for (const p of paths) result[p] = master[p];
        return Promise.resolve(result);
      });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'TRACEROUTE');

      expect(result.status).toBe('COMPLETE');
      expect(result.routeHops).toEqual([
        { host: 'hop1.isp.net', hostAddress: '10.0.0.1' },
        { host: 'hop2.isp.net', hostAddress: '10.0.0.2' },
      ]);
    });

    it('SITE_SURVEY completo trae los vecinos WiFi (neighbors)', async () => {
      mockClient.getDeviceStatus.mockResolvedValue({ isTR181: true });
      mockClient.getParameterValues.mockImplementation((_id: string, paths: string[]) => {
        const master: Record<string, string> = {
          'Device.WiFi.NeighboringWiFiDiagnostic.DiagnosticsState': 'Complete',
          'Device.WiFi.NeighboringWiFiDiagnostic.ResultNumberOfEntries': '1',
          'Device.WiFi.NeighboringWiFiDiagnostic.Result.1.SSID': 'VecinoWifi',
          'Device.WiFi.NeighboringWiFiDiagnostic.Result.1.Channel': '11',
          'Device.WiFi.NeighboringWiFiDiagnostic.Result.1.SignalStrength': '-70',
          'Device.WiFi.NeighboringWiFiDiagnostic.Result.1.BSSID': 'AA:BB:CC:DD:EE:FF',
        };
        const result: Record<string, string | undefined> = {};
        for (const p of paths) result[p] = master[p];
        return Promise.resolve(result);
      });

      const result = await makeService().getDiagnosticStatus('DEV-01', 'SITE_SURVEY');

      expect(result.neighbors).toEqual([
        { ssid: 'VecinoWifi', channel: 11, signalStrength: -70, bssid: 'AA:BB:CC:DD:EE:FF' },
      ]);
    });
  });
});
