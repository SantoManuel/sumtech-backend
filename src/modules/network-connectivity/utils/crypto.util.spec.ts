import { encryptCredential, decryptCredential } from './crypto.util';

describe('crypto.util', () => {
  it('debe cifrar y descifrar correctamente una contraseña compleja', () => {
    const original = 'P@$$w0rd!#_Con_Caracteres_Raros_12345';
    const encrypted = encryptCredential(original);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toEqual(original);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptCredential(encrypted);
    expect(decrypted).toEqual(original);
  });

  it('debe generar diferentes ciphertexts para el mismo texto debido a IV aleatorio', () => {
    const plain = 'M1krotik_Secret_Key';
    const enc1 = encryptCredential(plain);
    const enc2 = encryptCredential(plain);

    expect(enc1).not.toEqual(enc2);
    expect(decryptCredential(enc1)).toEqual(plain);
    expect(decryptCredential(enc2)).toEqual(plain);
  });

  it('debe manejar cadenas vacías devolviendo string vacío', () => {
    expect(encryptCredential('')).toEqual('');
    expect(decryptCredential('')).toEqual('');
  });

  it('debe devolver el texto original si no tiene formato AES-GCM (fallback legado)', () => {
    const legacyPlain = 'old_unencrypted_password';
    expect(decryptCredential(legacyPlain)).toEqual(legacyPlain);
  });
});
