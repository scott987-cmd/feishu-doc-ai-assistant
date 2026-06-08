import { BUILD_CONFIG } from '../config'

// Redact likely-PII before a data payload is sent to the LLM. Conservative patterns to avoid
// mangling normal values. Only the LLM COPY is touched — the rendered viz / written-back data
// still uses the real values. Enabled by VITE_LLM_REDACT.
const RULES: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]'],
  // CN mobile, incl. optional +86 / 86 prefix (the bare `1[3-9]…` covers the plain form too).
  [/(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)/g, '[手机]'],
  // CN ID card (18-digit, trailing checksum may be X). 15-digit legacy IDs are intentionally NOT
  // matched, and no generic 16–19-digit "card" rule — both over-match benign IDs (order/snowflake)
  // and corrupt the data the model reasons over.
  [/(?<!\d)\d{17}[\dXx](?!\d)/g, '[身份证]'],
]

export function redactSensitive(s: string): string {
  if (!BUILD_CONFIG.llmRedact) return s
  let out = s
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  return out
}

export function capPayload(s: string): string {
  const cap = BUILD_CONFIG.llmMaxPayloadChars
  return cap > 0 && s.length > cap ? s.slice(0, cap) + '\n…[已截断：超出企业外发上限]' : s
}

/** Cap THEN redact (cap first → redact only the bytes that actually go to the model). Use this for
 *  CONTEXT/sample data the model reads but need NOT echo back verbatim (viz / report / slides). For
 *  data the model must return key-by-key (smartfill), use redactSensitive alone — capping would cut
 *  the JSON mid-row and silently drop fills. */
export function sanitizeForLlm(s: string): string {
  return redactSensitive(capPayload(s))
}
