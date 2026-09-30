/**
 * ARCHIVO: src/modules/portal/utils/template-interpolator.util.ts
 * CAPA: Utilidades de Notificaciones (Backend)
 *
 * RESPONSABILIDAD:
 * - Sustituye placeholders con formato {{nombreVariable}} por sus valores reales.
 * - Tolera espacios dentro de las llaves (ej: {{ monto }} o {{monto}}).
 * - Si una variable no existe o es undefined/null, mantiene la etiqueta o la reemplaza limpiamente.
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number | undefined | null>,
): string {
  if (!template) return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const val = variables[key];
    return val !== undefined && val !== null ? String(val) : match;
  });
}
