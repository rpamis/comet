const AUTHORIZATION_PATTERN = /\b(Bearer|Basic)\s+[^\s"']+/giu;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gu;
const URI_CREDENTIAL_PATTERN = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu;
const KNOWN_TOKEN_PATTERN =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,})\b/gu;
const JSON_CREDENTIAL_PATTERN =
  /("(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie)"\s*:\s*)"(?:\\[\s\S]|[^"\\\r\n])*"/giu;
const QUOTED_CREDENTIAL_PATTERN =
  /(["'])((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\1(\s*:\s*)(["'])[^\r\n]*?\4/giu;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b((?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret(?:[_-]?access)?[_-]?key|private[_-]?key|token|password|passwd|secret|authorization|cookie|set[_-]?cookie))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;"']+)/giu;

export function redactNativeCredentialText(value: string): string {
  return value
    .replace(AUTHORIZATION_PATTERN, '$1 [REDACTED]')
    .replace(PRIVATE_KEY_PATTERN, '[REDACTED PRIVATE KEY]')
    .replace(URI_CREDENTIAL_PATTERN, '$1[REDACTED]@')
    .replace(KNOWN_TOKEN_PATTERN, '[REDACTED TOKEN]')
    .replace(JSON_CREDENTIAL_PATTERN, '$1"[REDACTED]"')
    .replace(QUOTED_CREDENTIAL_PATTERN, '$1$2$1$3$4[REDACTED]$4')
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, '$1$2[REDACTED]');
}
