import { numericTransformer } from './numeric.transformer';

describe('numericTransformer', () => {
  it('convierte el string devuelto por pg para columnas numeric/decimal a number real', () => {
    expect(numericTransformer.from('-18.50')).toBe(-18.5);
    expect(typeof numericTransformer.from('-18.50')).toBe('number');
  });

  it('preserva null/undefined sin intentar parsearlos (evita NaN silencioso)', () => {
    expect(numericTransformer.from(null as any)).toBeNull();
    expect(numericTransformer.from(undefined as any)).toBeUndefined();
  });

  it('to() no transforma el valor de escritura — TypeORM ya lo serializa bien hacia Postgres', () => {
    expect(numericTransformer.to(-18.5)).toBe(-18.5);
    expect(numericTransformer.to(null as any)).toBeNull();
  });
});
