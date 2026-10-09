import { ValueTransformer } from 'typeorm';

/**
 * El driver `pg` devuelve columnas Postgres `numeric`/`decimal` como STRING
 * (ej. "-18.50"), no como number, para no perder precisión en valores muy
 * grandes — TypeORM no las convierte automáticamente aunque la entidad
 * declare `rxPowerDbm?: number`. Sin este transformer, el valor serializado
 * a JSON para el frontend es un string, y cualquier `.toFixed()`/operación
 * aritmética ahí revienta en runtime (TypeError: x.toFixed is not a
 * function) sin que `tsc` lo detecte, porque confía en el tipo declarado.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : parseFloat(value)),
};
