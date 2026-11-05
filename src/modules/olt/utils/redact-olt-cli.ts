/** Sanitize echoed CLI before logging or returning errors. */
export function redactOltCli(value: string, secrets: Array<string | undefined> = []): string {
  let safe = String(value)
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1***@')
    .replace(/([?&](?:password|passwd|secret|token|key|username)=)[^&#\s]*/gi, '$1***')
    .replace(/\b(password|passwd|secret|username)\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi, '$1 ***');
  for (const secret of secrets.filter((s): s is string => !!s).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join('***').split(encodeURIComponent(secret)).join('***');
  }
  return safe;
}
