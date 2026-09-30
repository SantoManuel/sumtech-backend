import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Obtiene la clave de cifrado simétrica derivada de NET_CREDENTIALS_SECRET o JWT_SECRET.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.NET_CREDENTIALS_SECRET ||
    process.env.JWT_SECRET ||
    'sumtech-default-secure-network-key-32b!';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Cifra un texto en claro usando AES-256-GCM.
 * Devuelve formato codificado en base64: iv:authTag:ciphertext
 */
export function encryptCredential(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Descifra una credencial cifrada con AES-256-GCM.
 */
export function decryptCredential(encryptedText: string): string {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    // Si no está en formato AES-GCM (p.ej. texto legado), devolver tal cual
    return encryptedText;
  }

  const [ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
