import * as fs from 'fs';
import * as path from 'path';

function decodeHexPdf(content: string): string[] {
  const lines: string[] = [];
  // Match arrays like [<hex> 10 <hex> ...] TJ
  const tjRegex = /\[(.*?)\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(content)) !== null) {
    const rawInner = match[1];
    const hexBlocks = rawInner.match(/<([0-9a-fA-F]+)>/g) || [];
    let text = '';
    for (const h of hexBlocks) {
      const hex = h.slice(1, -1);
      const buf = Buffer.from(hex, 'hex');
      text += buf.toString('latin1');
    }
    if (text.trim()) {
      lines.push(text.trim());
    }
  }
  return lines;
}

const outDir = path.resolve(__dirname, 'output');
const simPath = path.join(outDir, 'simulacion_E32_certificacion.pdf');
const factPath = path.join(outDir, 'factura_E32_dashboard.pdf');

const simContent = fs.readFileSync(simPath, 'utf8');
const factContent = fs.readFileSync(factPath, 'utf8');

const simLines = decodeHexPdf(simContent);
const factLines = decodeHexPdf(factContent);

console.log('=====================================================');
console.log('=== LÍNEAS DE TEXTO: SIMULACIÓN E32 (CERTIFICACIÓN) ===');
console.log('=====================================================');
simLines.forEach((l, i) => console.log(`${String(i + 1).padStart(2, '0')}: ${l}`));

console.log('\n=====================================================');
console.log('=== LÍNEAS DE TEXTO: FACTURA E32 (DASHBOARD FACTURAS) ===');
console.log('=====================================================');
factLines.forEach((l, i) => console.log(`${String(i + 1).padStart(2, '0')}: ${l}`));

// Extraer QR URLs del objeto de imagen o XObject o metadata
console.log('\n=====================================================');
console.log('=== COMPARACIÓN ESTRUCTURAL DIRECTA ===');
console.log('=====================================================');
console.log('Líneas en Simulación:', simLines.length);
console.log('Líneas en Factura:', factLines.length);
