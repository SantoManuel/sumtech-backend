import { resolveRouterOsCredentials } from './routeros-credentials';

describe('resolveRouterOsCredentials', () => {
  it('devuelve las credenciales del nodo cuando están configuradas', () => {
    const env = { ROUTEROS_CREDENTIALS: JSON.stringify({ 'RB Las Yayas': { username: 'api', password: 'secret' } }) } as any;

    const credentials = resolveRouterOsCredentials('RB Las Yayas', env);

    expect(credentials).toEqual({ username: 'api', password: 'secret' });
  });

  it('lanza un error claro si la variable de entorno no está configurada', () => {
    expect(() => resolveRouterOsCredentials('RB Las Yayas', {} as any)).toThrow('ROUTEROS_CREDENTIALS no está configurado');
  });

  it('lanza un error claro si la variable de entorno no es JSON válido', () => {
    const env = { ROUTEROS_CREDENTIALS: '{invalido' } as any;
    expect(() => resolveRouterOsCredentials('RB Las Yayas', env)).toThrow('no contiene un JSON válido');
  });

  it('lanza un error claro si el nodo no tiene credenciales configuradas', () => {
    const env = { ROUTEROS_CREDENTIALS: JSON.stringify({ 'Otro Nodo': { username: 'api', password: 'secret' } }) } as any;
    expect(() => resolveRouterOsCredentials('RB Las Yayas', env)).toThrow('No hay credenciales configuradas para el nodo "RB Las Yayas"');
  });

  it('lanza un error claro si al nodo le falta username o password', () => {
    const env = { ROUTEROS_CREDENTIALS: JSON.stringify({ 'RB Las Yayas': { username: 'api' } }) } as any;
    expect(() => resolveRouterOsCredentials('RB Las Yayas', env)).toThrow('No hay credenciales configuradas');
  });
});
