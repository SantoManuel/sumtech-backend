/** Canonical unicast EUI-48; never guess missing octets or nearby addresses. */
export function normalizeDeviceMac(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!/^(?:[\da-f]{12}|(?:[\da-f]{2}:){5}[\da-f]{2}|(?:[\da-f]{2}-){5}[\da-f]{2}|(?:[\da-f]{4}\.){2}[\da-f]{4})$/i.test(text)) return undefined;
  const mac = text.replace(/[:.\-]/g, '').toUpperCase();
  if (mac === '000000000000' || (parseInt(mac.slice(0, 2), 16) & 1) !== 0) return undefined;
  return mac;
}
