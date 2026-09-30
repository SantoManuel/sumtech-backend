import * as crypto from 'crypto';

/**
 * Cifrado en reposo para secretos de tenant (ej. `dgiiCertPassword`) guardados
 * en columnas de la DB. AES-256-GCM con IV aleatorio por valor — el formato de
 * almacenamiento es auto-descriptivo (`enc:v1:...`) para que un transformer de
 * columna pueda distinguir un valor ya cifrado de un valor legacy en texto
 * plano sin necesitar un backfill síncrono (ver `decryptSecretSafe`).
 *
 * No usa `ConfigService` a propósito: los transformers de columna de TypeORM
 * son funciones puras sin acceso al contenedor de DI de Nest, así que la
 * clave se lee directamente de `process.env` (igual que hace `.env` para
 * cualquier proceso Node normal, a diferencia de los scripts standalone de
 * `ts-node` de este repo, que sí necesitan las vars pasadas inline).
 */

const ALGORITHM = 'aes-256-gcm';
const ENC_PREFIX = 'enc:v1:';
const IV_LENGTH_BYTES = 12;

function getEncryptionKey(): Buffer {
  const keyB64 = process.env.COMPANY_SECRETS_ENCRYPTION_KEY;
  if (!keyB64 || !keyB64.trim()) {
    throw new Error(
      'COMPANY_SECRETS_ENCRYPTION_KEY no está configurada. Genera una con ' +
        '`openssl rand -base64 32` y agrégala al .env antes de guardar secretos de tenant.',
    );
  }
  const key = Buffer.from(keyB64.trim(), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `COMPANY_SECRETS_ENCRYPTION_KEY debe decodificar a 32 bytes (AES-256), se recibieron ${key.length}.`,
    );
  }
  return key;
}

/** Cifra un secreto en texto plano. Devuelve el valor tal cual si es vacío/null (nada que cifrar). */
export function encryptSecret(plainText?: string | null): string | null | undefined {
  if (plainText === null || plainText === undefined || plainText === '') {
    return plainText;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Desencripta un valor cifrado con `encryptSecret`. Si el valor no tiene el
 * prefijo `enc:v1:` se asume un dato legacy en texto plano (guardado antes de
 * introducir el cifrado) y se devuelve tal cual — el próximo `save()` de esa
 * fila lo re-cifra automáticamente porque `encryptSecret` siempre cifra al
 * escribir. Esto evita un backfill síncrono bloqueante en la migración.
 */
export function decryptSecretSafe(storedValue?: string | null): string | null | undefined {
  if (storedValue === null || storedValue === undefined || storedValue === '') {
    return storedValue;
  }
  if (!storedValue.startsWith(ENC_PREFIX)) {
    return storedValue;
  }

  try {
    const [ivB64, authTagB64, cipherB64] = storedValue.slice(ENC_PREFIX.length).split(':');
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(cipherB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plainText = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plainText.toString('utf8');
  } catch {
    // Un valor corrupto o cifrado con otra clave no debe tumbar el arranque
    // de la app ni la carga del perfil — se trata como "no disponible" en vez
    // de propagar la excepción (el llamador ya maneja certPassword ausente).
    return undefined;
  }
}
