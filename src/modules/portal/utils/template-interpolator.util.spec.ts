import { interpolateTemplate } from './template-interpolator.util';

describe('interpolateTemplate Utility', () => {
  it('sustituye correctamente las variables simples en el texto', () => {
    const template = 'Hola {{cliente}}, tu saldo es de {{moneda}} {{monto}}.';
    const variables = { cliente: 'Juan Pérez', moneda: 'RD$', monto: '1,500.00' };

    const result = interpolateTemplate(template, variables);
    expect(result).toBe('Hola Juan Pérez, tu saldo es de RD$ 1,500.00.');
  });

  it('tolera espacios adicionales dentro de las llaves {{ variable }}', () => {
    const template = 'Factura: {{ facturaId }} - Vencimiento: {{   fechaVencimiento   }}';
    const variables = { facturaId: 'INV-1001', fechaVencimiento: '2026-10-01' };

    const result = interpolateTemplate(template, variables);
    expect(result).toBe('Factura: INV-1001 - Vencimiento: 2026-10-01');
  });

  it('mantiene el tag original si la variable no está en el mapa', () => {
    const template = 'Hola {{cliente}}, tu código de descuento es {{cupon}}.';
    const variables = { cliente: 'Ana' };

    const result = interpolateTemplate(template, variables);
    expect(result).toBe('Hola Ana, tu código de descuento es {{cupon}}.');
  });

  it('maneja templates vacíos o indefinidos limpiamente', () => {
    expect(interpolateTemplate('', { test: '1' })).toBe('');
    expect(interpolateTemplate(null as any, {})).toBe('');
  });

  it('soporta números como valores de variables', () => {
    const template = 'Tienes {{dias}} días restantes.';
    const variables = { dias: 5 };

    const result = interpolateTemplate(template, variables);
    expect(result).toBe('Tienes 5 días restantes.');
  });
});
