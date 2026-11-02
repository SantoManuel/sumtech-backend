/** Sanitize echoed CLI before logging or returning errors. */
export function redactOltCli(value: string): string {
  return value.replace(/\b(password|passwd|secret)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi, '$1 ***');
}
