/**
 * Removes a leading UTF-8 BOM (U+FEFF) from decoded text.
 *
 * Windows tools (PowerShell 5.1 `>` / `Out-File` / `Set-Content`, older Notepad)
 * commonly emit UTF-8 with a BOM. Node's UTF-8 decoding keeps it as U+FEFF at
 * the start of the string, which makes `JSON.parse` reject otherwise valid
 * documents, so every stdin or file sourced JSON payload must pass through here.
 */
export function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
