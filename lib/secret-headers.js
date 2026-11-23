// Shared by the host and the quota backup importer.
/** {{VAR}} 占位符形态(与 custom-balance.js resolveTemplateString 同一文法)。 */
const HEADER_PLACEHOLDER_RE = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/

/** 敏感头名:这类头下的非占位符值一律按密钥处理(自定义余额场景里它们就是凭据)。 */
const SENSITIVE_HEADER_NAME_RE = /authorization|api[-_]?key|apikey|token|secret|cookie|session|credential|private[-_]?key/i

/** 典型密钥值形状:sk- 系 / Google AIza / GitHub ghp_ / Slack xoxb- / JWT eyJ 头。 */
const KNOWN_KEY_VALUE_RE = /^(sk-[A-Za-z0-9_-]|rk-[A-Za-z0-9_-]|gsk_[A-Za-z0-9]|AIza[0-9A-Za-z_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[bap]-|eyJ[A-Za-z0-9_-]{10,})/

/**
 * 判定一个请求头的值是否疑似明文密钥(issue #86)。
 * 两级判定:敏感头名(authorization / api-key / token 等)的非占位符值一律视为密钥;
 * 其余头名只在值具备典型密钥形状(Bearer 前缀 / 已知 key 前缀 / ≥32 位混合字母数字的
 * 不透明长串)时判密钥——Content-Type、Accept 等普通值不会误判(误判会让该头无法落盘)。
 * @param {unknown} name - 头名。
 * @param {unknown} value - 头值。
 * @returns {boolean}
 */
export function looksLikeSecretHeaderValue(name, value) {
  if (typeof value !== 'string' || value.length === 0) return false
  // 只能豁免纯引用及常见认证前缀；追加一个占位符不能使已有明文密钥绕过脱敏。
  if (HEADER_PLACEHOLDER_RE.test(value)) {
    const literal = value.replace(new RegExp(HEADER_PLACEHOLDER_RE.source, 'g'), '').trim()
    if (/^(?:(?:bearer|basic|token)\s*)?[:\s]*$/i.test(literal)) return false
    value = literal
  }
  if (SENSITIVE_HEADER_NAME_RE.test(String(name ?? ''))) return true
  const trimmed = value.trim()
  if (/^(bearer|basic|token)\s+\S/i.test(trimmed)) return true
  if (KNOWN_KEY_VALUE_RE.test(trimmed)) return true
  if (trimmed.length >= 32 && /^[A-Za-z0-9_-]+$/.test(trimmed) && /[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed)) return true
  return false
}
