export const TRAE_PANELS = ['cn', 'enterprise', 'ai']
export const TRAE_EDITION_SCOPES = ['auto', 'cn', 'enterprise', 'ai']

const TRAE_USAGE_PATH = '/plugins/dsh-connect-trae/usage'
const TRAE_ACCOUNT_CREDITS_PATH = '/plugins/dsh-connect-trae/account-credits'

const finiteNonNeg = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const finitePos = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
const cleanText = (value, max = 120) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max)
  : ''

export function formatTraeCredits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value * 100) / 100
  const [whole, frac] = String(rounded).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

function parseExpiringBucket(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const total = finiteNonNeg(raw.total)
  const packs = finiteNonNeg(raw.packs)
  if (total === null && packs === null) return null
  const earliestExpiresAtMs = finitePos(raw.earliestExpiresAtMs)
  return {
    total: total ?? 0,
    packs: packs !== null ? Math.floor(packs) : 0,
    ...(earliestExpiresAtMs !== null ? { earliestExpiresAtMs } : {}),
  }
}

function parseExpiry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  for (const key of ['within24h', 'within3d', 'within7d', 'expired']) {
    const bucket = parseExpiringBucket(raw[key])
    if (bucket !== null) out[key] = bucket
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseUnsupportedRegion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const region = cleanText(raw.region, 24).toLowerCase()
  if (!region) return undefined
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts.map(name => cleanText(name, 80)).filter(Boolean).slice(0, 20)
    : []
  return { region, count: accounts.length }
}

function parseCnCredits(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const total = finiteNonNeg(raw.total)
  const consumed = finiteNonNeg(raw.consumed)
  const available = finiteNonNeg(raw.available)
  const workAvailable = finiteNonNeg(raw.workAvailable)
  const generalAvailable = finiteNonNeg(raw.generalAvailable)
  if (total === null && consumed === null && available === null && workAvailable === null && generalAvailable === null) return undefined
  // Preserve genuine 0 and decimal precision; never run through normalizePercent (<=1 would x100).
  const usedPercent = total !== null && total > 0 && consumed !== null
    ? Math.min(100, Math.max(0, Math.round((consumed / total) * 1000) / 10))
    : null
  let nearestExpiryMs = null
  if (Array.isArray(raw.accounts)) {
    for (const pack of raw.accounts.slice(0, 200)) {
      if (!pack || typeof pack !== 'object') continue
      const remain = finiteNonNeg(pack.remain)
      const expiresAtMs = finitePos(pack.expiresAtMs)
      if ((remain === null || remain > 0) && expiresAtMs !== null) {
        if (nearestExpiryMs === null || expiresAtMs < nearestExpiryMs) nearestExpiryMs = expiresAtMs
      }
    }
  }
  const expiry = parseExpiry(raw.expiry)
  return {
    total: total ?? 0,
    consumed: consumed ?? 0,
    available: available ?? 0,
    workAvailable: workAvailable ?? 0,
    generalAvailable: generalAvailable ?? available ?? 0,
    ...(usedPercent !== null ? { usedPercent } : {}),
    ...(nearestExpiryMs !== null ? { nearestExpiryMs } : {}),
    ...(expiry !== undefined ? { expiry } : {}),
  }
}

function parseCnCheckin(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  if (typeof raw.checkedIn !== 'boolean' && typeof raw.didCheckedIn !== 'boolean' && typeof raw.enabled !== 'boolean') return undefined
  const credits = finiteNonNeg(raw.credits)
  const extraCredits = finiteNonNeg(raw.extraCredits)
  return {
    enabled: raw.enabled === true,
    checkedIn: raw.checkedIn === true,
    didCheckedIn: raw.didCheckedIn === true,
    credits: credits ?? 0,
    ...(extraCredits !== null ? { extraCredits } : {}),
  }
}

function parsePayStatus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const payIdentityStr = cleanText(raw.payIdentityStr, 48)
  const hasPackage = raw.hasPackage === true
  const inTrial = raw.inTrial === true
  const trialEndTimeMs = finitePos(raw.trialEndTimeMs)
  const isDollarUsageBilling = raw.isDollarUsageBilling === true
  const paid = (payIdentityStr.length > 0 && !/^free$/i.test(payIdentityStr)) || hasPackage
  return {
    ...(payIdentityStr ? { payIdentityStr } : {}),
    paid,
    hasPackage,
    inTrial,
    ...(trialEndTimeMs !== null ? { trialEndTimeMs } : {}),
    isDollarUsageBilling,
  }
}

async function readPanel(panel, read) {
  const res = await read(`${TRAE_USAGE_PATH}?region=${panel}`)
  if (res.missing || res.failed) return { panel, ...res }
  const body = res.body
  const status = body.status
  if (!['signed-in', 'signed-out', 'error'].includes(status)) return { panel, failed: true }
  const unsupportedRegion = parseUnsupportedRegion(body.unsupportedRegion)
  if (status === 'error') return { panel, failed: true, ...(unsupportedRegion ? { unsupportedRegion } : {}) }
  if (status === 'signed-out') {
    return {
      panel,
      status: 'signed-out',
      accountCount: Array.isArray(body.accounts) ? body.accounts.length : 0,
      ...(unsupportedRegion ? { unsupportedRegion } : {}),
    }
  }
  const accountName = cleanText(body.accountName, 120)
  const rawAccounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 200) : []
  const seenAccounts = new Set()
  const accounts = []
  for (const row of rawAccounts) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id.length === 0 || row.id.length > 128) continue
    const id = cleanText(row.id, 128)
    if (!id || seenAccounts.has(id)) continue
    seenAccounts.add(id)
    accounts.push({
      id,
      name: cleanText(row.accountName, 120),
      selected: row.selected === true,
      generalAvailable: null,
    })
  }
  const entry = {
    panel,
    status: 'signed-in',
    accountName,
    accountCount: accounts.length || (accountName ? 1 : 0),
    accounts,
    ...(unsupportedRegion ? { unsupportedRegion } : {}),
  }
  if (panel === 'cn') {
    const credits = parseCnCredits(body.credits)
    const checkin = parseCnCheckin(body.checkin)
    if (credits !== undefined) entry.credits = credits
    if (typeof body.creditsError === 'string' && body.creditsError.trim().length > 0 && credits === undefined) entry.creditsFailed = true
    if (checkin !== undefined) entry.checkin = checkin
    if (typeof body.checkinError === 'string' && body.checkinError.trim().length > 0 && checkin === undefined) entry.checkinFailed = true
  } else if (panel === 'enterprise') {
    // Enterprise deliberately exposes no tenant credit API; never substitute personal CN credits.
    entry.creditsUnavailable = true
  } else if (panel === 'ai') {
    const payStatus = parsePayStatus(body.payStatus)
    if (payStatus !== undefined) entry.payStatus = payStatus
    if (typeof body.payStatusError === 'string' && body.payStatusError.trim().length > 0 && payStatus === undefined) entry.payStatusFailed = true
  }
  return entry
}

async function readCnAccountCredits(read) {
  const res = await read(`${TRAE_ACCOUNT_CREDITS_PATH}?region=cn`)
  if (!res.body || !Array.isArray(res.body.accounts)) return null
  const out = []
  const seen = new Set()
  for (const row of res.body.accounts.slice(0, 200)) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) continue
    const id = cleanText(row.id, 128)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: cleanText(row.accountName, 120),
      selected: row.selected === true,
      generalAvailable: finiteNonNeg(row.generalAvailable),
    })
  }
  return out
}

function aiPlanLabel(payStatus, locale) {
  if (!payStatus) return locale === 'en' ? 'International' : '国际版'
  if (payStatus.payIdentityStr) return payStatus.payIdentityStr
  if (payStatus.inTrial) return locale === 'en' ? 'Trial' : '试用中'
  if (payStatus.hasPackage) return locale === 'en' ? 'Subscribed' : '已订阅'
  if (payStatus.isDollarUsageBilling) return locale === 'en' ? 'Pay-as-you-go' : '按量计费'
  return 'Free'
}

export async function readTraeQuota(config, { locale = 'zh', signal, read }) {
  signal?.throwIfAborted()
  const scope = TRAE_EDITION_SCOPES.includes(config?.editionScope) ? config.editionScope : 'auto'
  const panelsToRead = scope === 'auto' ? TRAE_PANELS : [scope]

  const results = await Promise.all(panelsToRead.map(panel => readPanel(panel, read)))
  signal?.throwIfAborted()

  if (results.every(row => row.missing === true)) {
    throw Object.assign(new Error('traeConnectUnavailable'), { code: 'traeConnectUnavailable' })
  }

  const signedIn = results.filter(row => row.status === 'signed-in')
  const unsupported = results.find(row => row.unsupportedRegion)?.unsupportedRegion
  if (signedIn.length === 0) {
    if (unsupported) {
      throw Object.assign(new Error('traeUnsupportedRegion'), { code: 'traeUnsupportedRegion', region: unsupported.region })
    }
    if (results.some(row => row.denied)) throw Object.assign(new Error('traeAccessDenied'), { code: 'traeAccessDenied' })
    if (results.some(row => row.failed === true)) {
      throw Object.assign(new Error('traeConnectFailed'), { code: 'traeConnectFailed' })
    }
    throw Object.assign(new Error('traeNotSignedIn'), { code: 'traeNotSignedIn' })
  }

  // Only read multi-account credits for CN when CN is actually signed in with accounts.
  const cnPanel = signedIn.find(row => row.panel === 'cn')
  if (cnPanel && cnPanel.accountCount > 0) {
    const accountCredits = await readCnAccountCredits(read)
    signal?.throwIfAborted()
    if (accountCredits && accountCredits.length > 0) {
      cnPanel.accounts = accountCredits
    }
  }

  const enterprisePanel = signedIn.find(row => row.panel === 'enterprise')
  const aiPanel = signedIn.find(row => row.panel === 'ai')

  const windows = {}
  const notes = []
  const en = locale === 'en'

  if (cnPanel) {
    if (cnPanel.credits) {
      windows.balance = { resetsAt: '', text: formatTraeCredits(cnPanel.credits.generalAvailable) }
      if (typeof cnPanel.credits.usedPercent === 'number') {
        windows.usage = { percent: cnPanel.credits.usedPercent, resetsAt: '' }
      }
    } else if (cnPanel.creditsFailed) {
      windows.balance = { resetsAt: '', text: '—' }
      notes.push(en ? 'CN credits could not be fetched; check the dsh-connect-trae plugin card.' : '国内版积分查询失败，请在 dsh-connect-trae 插件卡片查看。')
    }
  }

  if (aiPanel) {
    if (aiPanel.payStatus) {
      windows.plan = { resetsAt: '', text: aiPlanLabel(aiPanel.payStatus, locale) }
    } else if (aiPanel.payStatusFailed) {
      if (!windows.plan) windows.plan = { resetsAt: '', text: en ? 'International (unavailable)' : '国际版（查询失败）' }
      notes.push(en ? 'International plan status could not be fetched.' : '国际版订阅状态查询失败。')
    } else if (!cnPanel && !enterprisePanel) {
      windows.plan = { resetsAt: '', text: en ? 'International' : '国际版' }
    }
  }

  if (enterprisePanel && !cnPanel && !aiPanel) {
    windows.plan = { resetsAt: '', text: en ? 'Enterprise (view in console)' : '企业版（控制台查看）' }
    notes.push(en ? 'Trae Enterprise tenant balance is only available in console.enterprise.trae.cn.' : 'Trae 企业版租户额度仅可在 console.enterprise.trae.cn 查看。')
  } else if (enterprisePanel && Object.keys(windows).length === 0) {
    windows.plan = { resetsAt: '', text: en ? 'Enterprise' : '企业版' }
  }

  if (unsupported) {
    notes.push(en
      ? `Detected ${unsupported.region.toUpperCase()} region Trae login (not supported yet by dsh-connect-trae).`
      : `检测到 ${unsupported.region.toUpperCase()} 区域 Trae 登录，dsh-connect-trae 暂不支持该区域。`)
  }

  const incomplete = results.some(row => row.failed === true)
  if (incomplete) {
    notes.push(en ? 'Some Trae editions failed to query.' : '部分 Trae 版本查询失败。')
  }

  const trae = {
    editionScope: scope,
    fetchedAt: Date.now(),
    incomplete,
    ...(unsupported ? { unsupportedRegion: unsupported } : {}),
    editions: signedIn.map(row => ({
      panel: row.panel,
      accountName: row.accountName,
      accountCount: row.accountCount,
      ...(row.credits ? { credits: row.credits } : {}),
      ...(row.creditsFailed ? { creditsFailed: true } : {}),
      ...(row.creditsUnavailable ? { creditsUnavailable: true } : {}),
      ...(row.checkin ? { checkin: row.checkin } : {}),
      ...(row.checkinFailed ? { checkinFailed: true } : {}),
      ...(row.payStatus ? { payStatus: row.payStatus } : {}),
      ...(row.payStatusFailed ? { payStatusFailed: true } : {}),
      ...(row.panel === 'cn' && row.accounts?.length ? { accounts: row.accounts } : {}),
    })),
  }

  return {
    windows,
    trae,
    message: notes.join(' '),
  }
}

/** Per-account readings are available from the Chinese connector account pool. */
export function traeAccountQuotas(trae, fetchedAt) {
  const accounts = trae?.editions?.find(edition => edition.panel === 'cn')?.accounts ?? []
  return accounts.map((row, index) => {
    const known = Number.isFinite(row.generalAvailable)
    return { accountId: 'pool-' + encodeURIComponent(row.id.toWellFormed()), accountLabel: row.name || '#' + (index + 1), fetchedAt,
      status: known ? 'ok' : 'off', message: '', windows: known ? { balance: { text: formatTraeCredits(row.generalAvailable), resetsAt: '' } } : {} }
  })
}
