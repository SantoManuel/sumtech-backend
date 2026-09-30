import { classifyDeviceError } from './device-error-classifier.util';
import { NetErrorCode } from '../enums/net-error-code.enum';

describe('device-error-classifier.util', () => {
  it('clasifica ECONNABORTED y ETIMEDOUT como NET_TIMEOUT', () => {
    const err1 = { code: 'ECONNABORTED', message: 'timeout of 5000ms exceeded' };
    const err2 = { code: 'ETIMEDOUT', message: 'connect ETIMEDOUT 10.10.0.1:443' };
    const err3 = new Error('Tiempo de espera agotado contactando al nodo.');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_TIMEOUT);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_TIMEOUT);
    expect(classifyDeviceError(err3).code).toBe(NetErrorCode.NET_TIMEOUT);
  });

  it('clasifica ECONNREFUSED como NET_CONNECTION_REFUSED', () => {
    const err = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 192.168.100.100:23' };
    expect(classifyDeviceError(err).code).toBe(NetErrorCode.NET_CONNECTION_REFUSED);
  });

  it('clasifica ENOTFOUND como NET_DNS_RESOLUTION', () => {
    const err = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND router1.midominio.com' };
    expect(classifyDeviceError(err).code).toBe(NetErrorCode.NET_DNS_RESOLUTION);
  });

  it('clasifica EHOSTUNREACH y ENETUNREACH como NET_NO_ROUTE', () => {
    const err1 = { code: 'EHOSTUNREACH', message: 'connect EHOSTUNREACH 10.250.1.5:8728' };
    const err2 = { code: 'ENETUNREACH', message: 'connect ENETUNREACH 10.250.1.5:8728' };

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_NO_ROUTE);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_NO_ROUTE);
  });

  it('clasifica HTTP 401 y textos de auth como NET_AUTH_INVALID', () => {
    const err1 = { response: { status: 401, data: 'Unauthorized' }, message: 'Request failed with status code 401' };
    const err2 = new Error('Authentication failed: bad username or password');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_AUTH_INVALID);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_AUTH_INVALID);
  });

  it('clasifica HTTP 403 y permission denied como NET_PERMISSION_DENIED', () => {
    const err1 = { response: { status: 403, data: 'Forbidden' }, message: 'Request failed with status code 403' };
    const err2 = new Error('not enough permissions to write to /ppp/secret');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_PERMISSION_DENIED);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_PERMISSION_DENIED);
  });

  it('clasifica errores de certificados TLS/SSL como NET_TLS_ERROR', () => {
    const err1 = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: 'self-signed certificate' };
    const err2 = { code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' };

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_TLS_ERROR);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_TLS_ERROR);
  });

  it('clasifica problemas de WireGuard y VPN', () => {
    const err1 = new Error('WireGuard peer handshake stale (last handshake > 180s)');
    const err2 = new Error('Conexión VPN caída o túnel desconectado');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_WG_HANDSHAKE_STALE);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_VPN_DOWN);
  });

  it('clasifica HTTP 404 o no such item como NET_TARGET_NOT_FOUND', () => {
    const err1 = { response: { status: 404 }, message: 'Not Found' };
    const err2 = new Error('no such item (*A)');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_TARGET_NOT_FOUND);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_TARGET_NOT_FOUND);
  });

  it('clasifica traps de RouterOS y errores CLI ZTE como NET_COMMAND_ERROR', () => {
    const err1 = new Error('RouterOS API error: !trap=syntax error in command');
    const err2 = new Error('%Error: Incomplete command in line 1');
    const err3 = new Error('% Unrecognized command found at marker');

    expect(classifyDeviceError(err1).code).toBe(NetErrorCode.NET_COMMAND_ERROR);
    expect(classifyDeviceError(err2).code).toBe(NetErrorCode.NET_COMMAND_ERROR);
    expect(classifyDeviceError(err3).code).toBe(NetErrorCode.NET_COMMAND_ERROR);
  });

  it('clasifica equipos desconectados explícitos como NET_DEVICE_OFFLINE', () => {
    const err = new Error('El equipo se encuentra offline o no responde a pings');
    expect(classifyDeviceError(err).code).toBe(NetErrorCode.NET_DEVICE_OFFLINE);
  });

  it('devuelve NET_UNKNOWN para errores no identificados o nulos', () => {
    expect(classifyDeviceError(null).code).toBe(NetErrorCode.NET_UNKNOWN);
    expect(classifyDeviceError(undefined).code).toBe(NetErrorCode.NET_UNKNOWN);
    expect(classifyDeviceError({ message: 'Algo completamente inesperado' }).code).toBe(NetErrorCode.NET_UNKNOWN);
  });
});
