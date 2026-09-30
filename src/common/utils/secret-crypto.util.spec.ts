import { encryptSecret, decryptSecretSafe } from './secret-crypto.util';

describe('secret-crypto.util', () => {
  const ORIGINAL_ENV = process.env.COMPANY_SECRETS_ENCRYPTION_KEY;

  beforeEach(() => {
    // 32 bytes en base64 — misma forma que `openssl rand -base64 32`.
    process.env.COMPANY_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    process.env.COMPANY_SECRETS_ENCRYPTION_KEY = ORIGINAL_ENV;
  });

  it('cifra y desencripta un secreto de ida y vuelta', () => {
    const plain = 'contraseña-del-.p12-123!';
    const encrypted = encryptSecret(plain);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(plain);
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptSecretSafe(encrypted)).toBe(plain);
  });

  it('genera un IV distinto en cada llamada (mismo texto, cifrados distintos)', () => {
    const a = encryptSecret('mismo-secreto');
    const b = encryptSecret('mismo-secreto');
    expect(a).not.toBe(b);
    expect(decryptSecretSafe(a)).toBe('mismo-secreto');
    expect(decryptSecretSafe(b)).toBe('mismo-secreto');
  });

  it('trata un valor legacy sin el prefijo enc:v1: como texto plano', () => {
    expect(decryptSecretSafe('password-viejo-sin-cifrar')).toBe('password-viejo-sin-cifrar');
  });

  it('devuelve null/undefined/"" tal cual sin intentar cifrar/desencriptar', () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeUndefined();
    expect(encryptSecret('')).toBe('');
    expect(decryptSecretSafe(null)).toBeNull();
    expect(decryptSecretSafe(undefined)).toBeUndefined();
    expect(decryptSecretSafe('')).toBe('');
  });

  it('lanza al cifrar si la clave de entorno no está configurada', () => {
    delete process.env.COMPANY_SECRETS_ENCRYPTION_KEY;
    expect(() => encryptSecret('algo')).toThrow(/COMPANY_SECRETS_ENCRYPTION_KEY/);
  });

  it('devuelve undefined (no lanza) si el ciphertext está corrupto o la clave cambió', () => {
    const encrypted = encryptSecret('secreto')!;
    process.env.COMPANY_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(decryptSecretSafe(encrypted)).toBeUndefined();
  });
});
