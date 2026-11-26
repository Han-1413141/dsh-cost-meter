// Generated from Mars-Sea/dsh-commandcode-provider 0.19.0. See LICENSE and NOTICE.
// src/adapter.ts
import { createHash, randomUUID as randomUUID3 } from "node:crypto";

// src/response-encoding.ts
var IDENTITY_ENCODING_HEADER = { "accept-encoding": "identity" };

// src/timeout-limits.ts
var MAX_TIMEOUT_SECONDS = 3600;

// src/model-visibility.ts
function modelIsVisible(id, allowlist, overrides) {
  const flag = overrides !== null && typeof overrides === "object" && !Array.isArray(overrides) ? overrides[id] : void 0;
  return typeof flag === "boolean" ? flag : allowlist.length === 0 || allowlist.includes(id);
}

// src/model-names.ts
function effectiveModelName(catalogName, modelId, options) {
  const custom = options?.modelNames?.[modelId];
  if (typeof custom === "string" && custom.trim() !== "") return custom.trim();
  return catalogName === void 0 ? modelId : `${catalogName} (CC)`;
}

// src/context-window.ts
var CONTEXT_WINDOW_MIN = 1;
var CONTEXT_WINDOW_MAX = 1e7;
function isValidContextWindow(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= CONTEXT_WINDOW_MIN && value <= CONTEXT_WINDOW_MAX;
}
function effectiveContextWindow(catalog, model, options) {
  const perModel = options.contextWindowOverrides?.[model];
  if (isValidContextWindow(perModel)) return perModel;
  if (isValidContextWindow(options.contextWindow)) return options.contextWindow;
  return catalog;
}

// src/output-budget.ts
var MAX_OUTPUT_TOKEN_LIMIT = 131072;
var OMIT_OUTPUT_TOKENS = 0;
function applyMaxOutputTokens(derived, configured) {
  if (configured === void 0 || configured === OMIT_OUTPUT_TOKENS) return derived;
  return Math.min(derived, configured);
}
function omitOutputTokens(configured, protocol, hostRequestedTokens) {
  if (configured !== OMIT_OUTPUT_TOKENS) return false;
  if (protocol === "messages") return false;
  return hostRequestedTokens === void 0;
}

// src/readable-error.ts
function readableErrorText(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const message = error.message;
    if (typeof message === "string" && message !== "") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

// src/transport-failure.ts
var REASONS = {
  ECONNREFUSED: "连接被拒绝",
  ECONNRESET: "连接被重置",
  ENOTFOUND: "域名解析失败",
  EAI_AGAIN: "域名解析临时失败",
  EHOSTUNREACH: "主机不可达",
  ENETUNREACH: "网络不可达",
  ETIMEDOUT: "连接超时",
  UND_ERR_CONNECT_TIMEOUT: "连接超时",
  UND_ERR_SOCKET: "连接中断",
  UND_ERR_CLOSED: "连接已关闭",
  CERT_HAS_EXPIRED: "证书已过期",
  DEPTH_ZERO_SELF_SIGNED_CERT: "自签名证书不受信任",
  SELF_SIGNED_CERT_IN_CHAIN: "证书链中有自签名证书",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法验证证书"
};
function codeOf(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== "object") return void 0;
  const entry = value;
  if (typeof entry.code === "string" && entry.code !== "") return entry.code;
  if (Array.isArray(entry.errors)) {
    for (const nested of entry.errors) {
      const code = codeOf(nested, depth + 1);
      if (code !== void 0) return code;
    }
  }
  return codeOf(entry.cause, depth + 1);
}
function transportFailureReason(error) {
  const code = codeOf(error);
  if (code === void 0) return void 0;
  const reason = REASONS[code];
  return reason === void 0 ? `网络错误（${code}）` : `${reason}（${code}）`;
}
function httpOrigin(base) {
  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}`;
  } catch {
    return void 0;
  }
}

// src/provider-errors.ts
import { CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError } from "../commandcode-host-llm.js";

// src/llm-error.ts
import { LlmError } from "../commandcode-host-llm.js";
function providerError(message, code, options) {
  const ErrorClass = LlmError;
  if (typeof ErrorClass.fromFailure === "function") {
    const { cause: _cause, ...facts } = options ?? {};
    return ErrorClass.fromFailure({ ...facts, message, code }, options);
  }
  const LegacyError = LlmError;
  return new LegacyError(message, code, options);
}

// src/accounts.ts
import { LlmError as LlmError2 } from "../commandcode-host-llm.js";

// src/transient-retry.ts
var THROTTLED_CODE = "THROTTLED";

// src/accounts.ts
var RETRY_MAX_DELAY_MS = 9e5;
var EXPLICIT_ACCOUNT_PROBE_INTERVAL_MS = 6e4;
var MODEL_UNAVAILABLE_TTL_MS = 5 * 6e4;
function modelUnavailableKey(apiKey, model) {
  return `${apiKey}\0${model}`;
}
function clockLabel(ms) {
  return new Date(ms).toLocaleString();
}
function accountUsable(state) {
  if (state === void 0) return true;
  if (state.kind === "cooldown") return state.until > 0 && Date.now() >= state.until;
  return false;
}
function selectActiveAccount(accounts, preferredId) {
  const usable = accounts.filter((account) => accountUsable(account.state));
  if (preferredId !== void 0) {
    const preferred = usable.find((account) => account.slot.id === preferredId);
    if (preferred !== void 0) return preferred;
  }
  return usable[0];
}
function matchModelRule(model, rules) {
  if (model === "" || rules === void 0 || rules.length === 0) return void 0;
  for (const rule of rules) {
    if (rule.models.includes(model)) return rule;
  }
  return void 0;
}
function selectAccountForModel(accounts, model, rules) {
  const rule = matchModelRule(model, rules);
  if (rule === void 0) return void 0;
  return accounts.find((account) => account.slot.id === rule.account && accountUsable(account.state));
}
function captureAccountSelection(selection) {
  return Object.freeze({
    slots: Object.freeze(selection.slots.map((slot) => Object.freeze({ ...slot }))),
    preferredId: selection.preferredId,
    modelAccountRules: Object.freeze(selection.modelAccountRules.map((rule) => {
      const models = [...rule.models];
      Object.freeze(models);
      return Object.freeze({ ...rule, models });
    }))
  });
}
var CommandCodeAccountPool = class _CommandCodeAccountPool {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  /** 当前作用域内按密钥共享的健康状态；不记录到日志。 */
  states = /* @__PURE__ */ new Map();
  /** 当前网关与密钥的显式探测时间，限制失败探测的频率。 */
  explicitProbes = /* @__PURE__ */ new Map();
  /**
   * 模型级 `unavailable` 软标记：`key\0model` → 过期时刻（毫秒）。
   * 只影响选择顺序，从不参与 {@link accountUsable}，所以免费模型仍可用。
   */
  modelUnavailable = /* @__PURE__ */ new Map();
  scopedStates = /* @__PURE__ */ new Map();
  /** 每个调用持有自己的定义和探测，只有同网关的健康事实共享；不临时改写全局依赖。 */
  scope(context) {
    const selection = captureAccountSelection(context);
    let shared = this.scopedStates.get(context.apiBase);
    if (shared === void 0) {
      shared = { states: /* @__PURE__ */ new Map(), probes: /* @__PURE__ */ new Map(), modelUnavailable: /* @__PURE__ */ new Map() };
      this.scopedStates.set(context.apiBase, shared);
    }
    const scoped = new _CommandCodeAccountPool({
      ...this.deps,
      slots: () => selection.slots,
      preferredId: () => selection.preferredId,
      modelAccountRules: () => selection.modelAccountRules,
      probeWindow: context.probeWindow
    });
    scoped.states = shared.states;
    scoped.explicitProbes = shared.probes;
    scoped.modelUnavailable = shared.modelUnavailable;
    scoped.scopedStates = this.scopedStates;
    return scoped;
  }
  /**
   * Resolve every slot's key, deduplicated by key (first slot wins). Slots
   * without any resolvable key are omitted — they still appear in the
   * settings page as unconfigured, they just cannot serve requests.
   */
  async resolvedAccounts() {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const slot of this.deps.slots()) {
      const key = await this.resolveSlotKey(slot);
      if (key === void 0 || seen.has(key)) continue;
      seen.add(key);
      out.push({ slot, key, state: this.states.get(key) });
    }
    return out;
  }
  /**
   * Every slot paired with its resolved key and rotation state — NOT
   * deduplicated: two slots sharing one credential both appear (the usage
   * view reports them individually), while slots without any resolvable key
   * are omitted. The serving path uses {@link resolvedAccounts} instead.
   */
  async describeAccounts() {
    const out = [];
    for (const slot of this.deps.slots()) {
      const key = await this.resolveSlotKey(slot);
      if (key === void 0) continue;
      out.push({ slot, key, state: this.states.get(key) });
    }
    return out;
  }
  /**
   * Hand out the key for a request: the model-routed account when usable, else
   * the manually preferred account when usable, else the first usable account
   * in rotation order. Returns `undefined` when no account resolves any key,
   * or when an account this request already used is still UNMARKED — the
   * caller's own rejection is the honest answer then. Throws `RATE_LIMIT` /
   * `INVALID_CREDENTIAL` when every account is marked.
   *
   * `options.tried` lists the keys this request already used; they are removed
   * from the resolution entirely, which is what lets one request walk a
   * four-account pool. An explicit selection (pin or model rule) that a
   * rate-limit mark would demote is probed first, so a fallback never becomes
   * permanent (issue #51). Scoped rules stay fixed for the call; credential values re-resolve.
   */
  async resolveKey(options) {
    const accounts = await this.resolvedAccounts();
    if (accounts.length === 0) {
      return void 0;
    }
    const tried = options?.tried;
    const available = tried === void 0 || tried.length === 0 ? accounts : accounts.filter((account) => !tried.includes(account.key));
    const preferred = this.deps.preferredId?.();
    const diagnoseOnly = available.length === 0;
    if (diagnoseOnly) {
      if (selectActiveAccount(accounts, preferred) !== void 0) return void 0;
      throw allAccountsUnusable(accounts);
    }
    const model = options?.model ?? "";
    const serveable = this.withoutModelUnavailable(available, model);
    const routed = selectAccountForModel(serveable, model, this.deps.modelAccountRules?.());
    if (routed !== void 0) return this.pick(routed);
    const chosen = selectActiveAccount(serveable, preferred);
    if (chosen !== void 0) {
      const revived2 = await this.reviveExplicit(available, model, preferred, chosen);
      return this.pick(revived2 ?? chosen);
    }
    await this.probeAllMarked(available);
    const latestAccounts = await this.resolvedAccounts();
    const latest = tried === void 0 || tried.length === 0 ? latestAccounts : latestAccounts.filter((account) => !tried.includes(account.key));
    const revived = selectActiveAccount(latest, preferred);
    if (revived !== void 0) return this.pick(revived);
    if (selectActiveAccount(latestAccounts, preferred) !== void 0) return void 0;
    throw allAccountsUnusable(latestAccounts.length > 0 ? latestAccounts : accounts);
  }
  /**
   * Which account is serving right now, for display (the settings page's
   * account card, the sidebar usage stats) — without consuming a request's
   * `tried` budget and without throwing when nothing can serve.
   *
   * Reads and self-heals exactly like {@link resolveKey} would: an `unknown`
   * mark on the pinned account is re-probed (throttled the same way, sharing
   * the same per-key timestamp), and a pool where nothing currently resolves
   * gets one batch probe pass too. Without this, the badge read a possibly
   * stale mark forever — nothing but an actual generate request ever cleared
   * an `unknown` mark, so a page left open with no chat activity kept
   * showing "switched to the fallback account" long after a real request
   * would have quietly recovered (issue #51's follow-up report: the account
   * card and the sidebar stats both stuck on the wrong account).
   *
   * No `model` parameter: the badge describes the pool as a whole, not one
   * request, so model-routing rules are deliberately not consulted here —
   * matching what the direct `selectActiveAccount` call this replaces did.
   */
  async activeAccount() {
    const accounts = await this.resolvedAccounts();
    if (accounts.length === 0) return void 0;
    const preferred = this.deps.preferredId?.();
    const chosen = selectActiveAccount(accounts, preferred);
    if (chosen !== void 0) {
      const revived = await this.reviveExplicit(accounts, "", preferred, chosen);
      return revived ?? chosen;
    }
    await this.probeAllMarked(accounts);
    return selectActiveAccount(await this.resolvedAccounts(), preferred);
  }
  /**
   * Record a rejection against one key. A `throttled` rejection (the plain 429
   * that named no window) marks the key with the `throttle` cause, leaving
   * rotation exactly like a window mark but keeping the pool's own diagnosis at
   * "rate limited" rather than inventing an exhausted window. `rate-limit`
   * marks a `cooldown` until `resetAtMs` when the body named the provider's own
   * reset, otherwise an `unknown` mark whose window is probed lazily.
   * `invalid-credential` (401) disables the key until the stored credential
   * changes.
   *
   * `resetAtMs` is seconds-to-millis converted by the adapter from
   * `error.rateLimit.reset`; it applies to a window mark only. A plain throttle
   * keeps its window unknown on purpose, so a probe can still find out.
   */
  markRejected(apiKey, rejection, resetAtMs) {
    if (rejection === "invalid-credential") {
      this.states.set(apiKey, { kind: "disabled", cause: "auth", reason: "invalid API key (401)", until: 0 });
      this.clearModelUnavailable(apiKey);
    } else if (rejection === "throttled") {
      this.states.set(apiKey, { kind: "unknown", cause: "throttle", reason: "rate limited (429)", until: 0 });
    } else if (resetAtMs !== void 0 && resetAtMs > Date.now()) {
      this.states.set(apiKey, { kind: "cooldown", cause: "window", reason: "usage window exhausted (429)", until: resetAtMs });
    } else {
      this.states.set(apiKey, { kind: "unknown", cause: "window", reason: "usage window exhausted (429)", until: 0 });
    }
  }
  /**
   * 用量报告读到的窗口结论（设置页账号卡片、`/commandcode` 拉取的
   * `/alpha/billing/credits`）：某个窗口已超限，就按探测的同一口径给这个密钥
   * 打标记——有可信重置时刻记为到期自动恢复的 `cooldown`，否则为 `unknown`。
   *
   * 为什么需要（issue #105）：轮转原本只认真实请求的拒绝，进程重启或冷却过早
   * 到期后，卡片明明显示「每周 100%」，自动模式和「当前使用」徽标仍选列表第一个
   * 账号，下一个请求白撞一次拒绝才换号。报告本来就要拉这个接口，把结论记进池里
   * 不增加任何请求。
   *
   * 只加不减：窗口未超限时不清除已有标记。限流（throttle）或消费上限这类拒绝
   * 在窗口数据里看不到（issue #54），据此清标记会让每次刷新卡片都换来一次注定
   * 被拒的请求；清除仍只走有节流的探测路径。401 禁用的密钥不改。
   */
  noteWindowReport(apiKey, verdict) {
    if (verdict === void 0 || !verdict.exceeded) return;
    const state = this.states.get(apiKey);
    if (state?.kind === "disabled") return;
    this.stampWindowMark({ key: apiKey, state }, verdict);
  }
  /**
   * Record a model-scoped `unavailable` rejection (no credits, or a model
   * outside this account's plan) as a SHORT-LIVED PREFERENCE demotion.
   *
   * 职责：让同一模型的后续请求先跳过这个账号，而不是每一步都重撞一次
   * `400 insufficient credits`；同时刻意不写进 `states`，所以
   * {@link accountUsable} 与 {@link activeAccount} 都不受影响——余额为空的
   * 账号仍然能服务 `:free` 模型，账号卡片也不会把它标成"不可用"。
   *
   * 为什么按时限而非永久：余额/套餐是可以不换密钥就改变的事实（充值、升级），
   * 而进程内没有任何事件能通知这改变，所以只能靠时钟自行恢复。
   */
  markModelUnavailable(apiKey, model) {
    if (model === "") return;
    const now = this.now();
    this.modelUnavailable.set(modelUnavailableKey(apiKey, model), now + MODEL_UNAVAILABLE_TTL_MS);
    for (const [key, until] of this.modelUnavailable) {
      if (until <= now) this.modelUnavailable.delete(key);
    }
  }
  /** Drop every model-scoped mark for one key (a new credential invalidates them). */
  clearModelUnavailable(apiKey) {
    const prefix = `${apiKey}\0`;
    for (const key of this.modelUnavailable.keys()) {
      if (key.startsWith(prefix)) this.modelUnavailable.delete(key);
    }
  }
  /**
   * The candidates for THIS model, in preference order: accounts without a live
   * model-scoped mark first, everything else after them.
   *
   * 为什么要"排后"而不是"剔除"：软标记只是偏好（见
   * {@link markModelUnavailable}）。全部候选都被标记时必须退回全量，否则唯一
   * 账号的池子会变成"没有可用账号"，把一次余额不足误报成额度耗尽。
   */
  withoutModelUnavailable(accounts, model) {
    if (model === "") return accounts;
    const now = this.now();
    const healthy = accounts.filter((account) => {
      const until = this.modelUnavailable.get(modelUnavailableKey(account.key, model));
      return until === void 0 || until <= now;
    });
    return healthy.length > 0 ? healthy : accounts;
  }
  /**
   * One account's key: literal → credential seam → auth file (default slot).
   *
   * Every source is normalized here, at the single point where a slot's key
   * enters the pool. The adapter sends the key through the plugin's own
   * `assertUsableApiKey()`, which trims it, and reports that trimmed form back
   * to {@link markRejected}: returning the raw value would file every 429/401
   * mark under a key no later lookup can find — rotation would re-offer the same
   * account, the account card would show no mark, and the usage endpoints would
   * 401 while chat kept working.
   */
  async resolveSlotKey(slot) {
    if (slot.literal !== void 0) {
      const literal = normalizeResolvedKey(slot.literal);
      if (literal !== void 0) return literal;
    }
    if (slot.ref !== void 0) {
      const hit = await this.deps.resolveRef(slot.ref);
      if (hit !== void 0) {
        const resolved = normalizeResolvedKey(hit);
        if (resolved !== void 0) return resolved;
      }
    }
    if (slot.allowAuthFile) {
      const fromFile = this.deps.authFileKey();
      if (fromFile !== void 0) {
        const fileKey = normalizeResolvedKey(fromFile);
        if (fileKey !== void 0) return fileKey;
      }
    }
    return void 0;
  }
  /**
   * The account the user explicitly asked for: the slot a model rule routes the
   * request to when that id exists among the resolved slots, else the manually
   * pinned slot. Consulted only on the fallback path, so — unlike
   * {@link selectAccountForModel} — it does NOT require the account to be usable,
   * which is exactly what {@link resolveKey} re-probes.
   */
  explicitAccount(accounts, model, preferredId) {
    const rule = matchModelRule(model, this.deps.modelAccountRules?.());
    const id = rule !== void 0 && accounts.some((account) => account.slot.id === rule.account) ? rule.account : preferredId;
    return id === void 0 ? void 0 : accounts.find((account) => account.slot.id === id);
  }
  /**
   * Whether an explicitly selected account's mark is due for a window probe.
   * Only an `unknown` mark (a 429 whose reset was never learned) is worth
   * re-probing: a `cooldown` carries its reset and expires by itself, and a
   * `disabled` (401) key stays out until the stored credential changes. The
   * interval bounds a probe endpoint that keeps failing.
   */
  canProbeExplicit(account) {
    if (account.state?.kind !== "unknown") return false;
    const last = this.explicitProbes.get(account.key);
    return last === void 0 || this.now() - last >= EXPLICIT_ACCOUNT_PROBE_INTERVAL_MS;
  }
  /** The clock the probe throttle reads; injected so a test can travel in time. */
  now() {
    return this.deps.now?.() ?? Date.now();
  }
  /**
   * Probe one explicitly selected account's window and apply the answer. A
   * window that is no longer exceeded drops the mark, so the user's own
   * selection serves again on this very request; an exceeded one is stamped as
   * a cooldown carrying the provider's reset time, after which
   * {@link accountUsable} lets the account back in with no further probe. A
   * probe that fails changes nothing: the mark stays `unknown` and the next
   * attempt waits out the interval.
   */
  async probeExplicit(account) {
    this.explicitProbes.set(account.key, this.now());
    let probe;
    try {
      probe = await this.deps.probeWindow(account.key);
    } catch {
      return void 0;
    }
    if (probe === void 0) return void 0;
    if (!probe.exceeded) {
      this.states.delete(account.key);
      return { slot: account.slot, key: account.key, state: void 0 };
    }
    this.stampWindowMark(account, probe);
    return void 0;
  }
  /**
   * Stamp a probe-read window onto one key. A known reset becomes a cooldown
   * that expires by itself; without one the mark stays `unknown`, so a later
   * probe can still learn it — and a mark that already carries a cooldown
   * keeps it, never trading a known reset for an unknown one. The cause is
   * `window` either way: a probe that read a window as exceeded IS window
   * evidence, whatever the key was marked for. An `until: 0` cooldown would
   * read as "never usable again" to {@link accountUsable}, so `unknown` it is.
   */
  stampWindowMark(account, probe) {
    if (probe.resetAt > 0) {
      this.states.set(account.key, {
        kind: "cooldown",
        cause: "window",
        reason: account.state?.reason ?? "usage window exhausted (429)",
        until: probe.resetAt
      });
    } else if (account.state?.kind !== "cooldown") {
      this.states.set(account.key, {
        kind: "unknown",
        cause: "window",
        reason: account.state?.reason ?? "usage window exhausted (429)",
        until: 0
      });
    }
  }
  /**
   * The explicit-account fallback re-check: when `chosen` (what rotation
   * would currently serve) is not the account the user actually asked for,
   * re-probe that explicit account's mark before accepting the fallback —
   * so a rate-limit mark never demotes the user's own selection for good
   * (issue #51). Returns the revived account, or `undefined` when there is
   * nothing to revive (explicit account already serving, not due for a
   * probe, or the probe found it still exceeded). Shared by {@link resolveKey}
   * (the request path) and {@link activeAccount} (the display path), so both
   * agree on what "currently usable" means instead of drifting apart.
   */
  async reviveExplicit(accounts, model, preferred, chosen) {
    const explicit = this.explicitAccount(accounts, model, preferred);
    if (explicit === void 0 || explicit.key === chosen.key || !this.canProbeExplicit(explicit)) {
      return void 0;
    }
    return this.probeExplicit(explicit);
  }
  /**
   * Probe every marked account's real usage window when nothing currently
   * resolves. Disabled (401) keys are not probed — an invalid key stays
   * invalid. A throwing probe counts as "unknown" (like a failed one): it
   * must not turn the all-exhausted path into a raw rejection instead of
   * RATE_LIMIT. Shared by {@link resolveKey} and {@link activeAccount}.
   */
  async probeAllMarked(accounts) {
    await Promise.all(accounts.map(async (account) => {
      if (account.state?.kind === "disabled") return;
      let probe;
      try {
        probe = await this.deps.probeWindow(account.key);
      } catch {
        return;
      }
      if (probe === void 0) return;
      if (!probe.exceeded) {
        this.states.delete(account.key);
        return;
      }
      this.stampWindowMark(account, probe);
    }));
  }
  /** Hand out the chosen account's key. */
  pick(account) {
    return { key: account.key, slot: account.slot };
  }
};
function allAccountsUnusable(accounts) {
  const disabled = accounts.filter((account) => account.state?.kind === "disabled");
  if (disabled.length === accounts.length) {
    return new LlmError2(
      `llm-commandcode: every configured Command Code account (${accounts.length}) was rejected with 401 — check the stored API keys (Models page / settings) or the auth file；已配置的 ${accounts.length} 个 Command Code 账户密钥均被拒绝（401）——请在设置页检查存储的 API 密钥，或重新运行 command-code login`,
      "INVALID_CREDENTIAL"
    );
  }
  const marked = accounts.map((account) => account.state).filter((state) => state !== void 0);
  const windowMarked = marked.filter((state) => state.cause === "window");
  if (windowMarked.length === 0) {
    return providerError(
      `llm-commandcode: all ${accounts.length} Command Code account(s) are rate limited (429) — the provider did not report an exhausted usage window; retrying；全部 ${accounts.length} 个 Command Code 账户被限流（429）——服务商未报告用量窗口用尽，正在重试`,
      THROTTLED_CODE
    );
  }
  const resets = windowMarked.filter((state) => state.kind === "cooldown" && state.until > 0).map((state) => state.until);
  const earliest = resets.length > 0 ? Math.min(...resets) : 0;
  const wait = earliest > 0 ? Math.max(1e3, earliest - Date.now()) : 0;
  return new LlmError2(
    `llm-commandcode: all ${accounts.length} Command Code account(s) have exhausted their usage window` + (earliest > 0 ? `; the earliest window resets at ${clockLabel(earliest)}` : " — the provider published no reset time for it") + ` — requests will succeed again after the reset (or add another account)；已用尽全部 ${accounts.length} 个 Command Code 账户的用量窗口` + (earliest > 0 ? `，最早的重置时间为 ${clockLabel(earliest)}` : "，服务商未公布重置时间") + "——窗口重置后请求会自动恢复（也可以添加更多账户）",
    "RATE_LIMIT",
    wait > 0 && wait <= RETRY_MAX_DELAY_MS ? { providerRetryAfterMs: wait } : void 0
  );
}
function normalizeResolvedKey(value) {
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}

// src/wire-guards.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value) {
  return typeof value === "string" ? value : void 0;
}
function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function booleanValue(value) {
  return typeof value === "boolean" ? value : void 0;
}
function recordOrEmpty(value) {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (isRecord(parsed)) return parsed;
    } catch {
    }
  }
  return {};
}

// src/provider-errors.ts
function bilingual(code, en, zh, options) {
  return providerError(`${en}；${zh}`, code, options);
}
var TERMINAL_STREAM_ERROR_MARKERS = [
  "premium credits exhausted",
  "model not in plan",
  "insufficient credits"
];
function hasTerminalStreamMarker(message) {
  const normalized = message.toLowerCase().replaceAll("_", " ");
  return TERMINAL_STREAM_ERROR_MARKERS.some((marker) => normalized.includes(marker));
}
var CLI_CONTEXT_OVERFLOW_PATTERN = /prompt is too long|context.*(length|window)|max_tokens|maximum.*tokens/i;
function isContextOverflowDetail(detail) {
  return isContextWindowExceededError(detail) || CLI_CONTEXT_OVERFLOW_PATTERN.test(detail);
}
var OUTPUT_LIMIT_REJECTION = new RegExp([
  "max_tokens:\\s*\\d+\\s*>\\s*\\d+",
  "maximum allowed number of output tokens",
  "invalid input[^\\n]*max_tokens",
  "expected number[^\\n]*at max_tokens"
].join("|"), "i");
function parseOutputCeiling(detail) {
  const stated = /max_tokens:\s*\d+\s*>\s*(\d+)/i.exec(detail)?.[1];
  if (stated === void 0) return void 0;
  const ceiling = Number(stated);
  return Number.isSafeInteger(ceiling) && ceiling > 0 ? ceiling : void 0;
}
var JSON_NODE_LIMIT_REJECTION = /JSON node count cannot exceed\s+(\d+)/i;
var ASSISTANT_MESSAGE_SHAPE_REJECTION = /content or tool_calls must be set/i;
var ZDR_NO_PROVIDERS_PATTERN = /cmd[_\s-]?zdr[_\s-]?no[_\s-]?providers/i;
function isZdrNoProviders(providerCode, providerDetail, errText) {
  return ZDR_NO_PROVIDERS_PATTERN.test(providerCode ?? "") || ZDR_NO_PROVIDERS_PATTERN.test(providerDetail) || ZDR_NO_PROVIDERS_PATTERN.test(errText);
}
function streamErrorToLlmError(value, fallbackMessage) {
  const record = isRecord(value) ? value : void 0;
  const message = record ? stringValue(record.message) ?? JSON.stringify(record) : stringValue(value) ?? fallbackMessage ?? "Stream error";
  const statusCode = record === void 0 ? void 0 : numberValue(record.statusCode) ?? numberValue(record.status);
  const isRetryable = record === void 0 ? void 0 : booleanValue(record.isRetryable);
  const detail = [stringValue(record?.code), stringValue(record?.type), message].filter((part) => part !== void 0 && part !== "").join(" ");
  const statusOption = statusCode !== void 0 ? { status: statusCode } : void 0;
  if (OUTPUT_LIMIT_REJECTION.test(detail)) {
    const stated = /max_tokens:\s*\d+\s*>\s*\d+/i.exec(detail)?.[0];
    return bilingual(
      "PROVIDER_STREAM_ERROR",
      `Command Code refused the request's max_tokens for this model` + (stated !== void 0 ? ` (${stated})` : "") + ' — the session is not oversized, so compacting it will not help; lower "Max output tokens" or pick a model with a larger output ceiling',
      `Command Code 拒绝了本次请求的 max_tokens（该模型的输出上限更低）` + (stated !== void 0 ? `（${stated}）` : "") + "——会话内容并未超长，压缩上下文无效；请调低「最大输出 token」或改用输出上限更大的模型",
      statusOption
    );
  }
  if (isContextOverflowDetail(detail)) {
    return bilingual(
      CONTEXT_WINDOW_EXCEEDED_CODE,
      `Command Code stream error: ${message}`,
      "Command Code API 拒绝了这次请求：内容超出模型上下文窗口。正在压缩上下文后重试；如仍失败，请新建会话或减少上下文",
      statusOption
    );
  }
  const terminal = hasTerminalStreamMarker(detail);
  const retryableStatus = statusCode !== void 0 && (statusCode === 429 || statusCode >= 500);
  const retryable = isRetryable === true || (isRetryable === false || terminal ? false : statusCode !== void 0 ? retryableStatus : true);
  if (!retryable) {
    return providerError(
      `Command Code stream error: ${message}`,
      "PROVIDER_STREAM_ERROR",
      statusOption
    );
  }
  const rejection = classifyAccountRejection(statusCode ?? 0, JSON.stringify(value) ?? message);
  if (rejection?.reason === "rate-limit" || rejection?.reason === "throttled") {
    const wait = rejection.resetAtMs === void 0 ? 0 : Math.min(RETRY_MAX_DELAY_MS, Math.max(1e3, rejection.resetAtMs - Date.now()));
    return bilingual(
      rejection.reason === "rate-limit" ? "RATE_LIMIT" : THROTTLED_CODE,
      `Command Code stream error: ${message}`,
      rejection.reason === "rate-limit" ? "Command Code 用量窗口已限流，等待恢复" : "Command Code 请求暂时被限流，正在重试",
      { ...statusOption, ...wait > 0 ? { providerRetryAfterMs: wait } : {} }
    );
  }
  return providerError(
    `Command Code stream error: ${message}`,
    "SERVER",
    statusOption
  );
}
function unwrapProviderMessage(raw) {
  if (raw === void 0) return void 0;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const inner = JSON.parse(trimmed);
    if (!isRecord(inner)) return raw;
    const nested = isRecord(inner.error) ? inner.error : void 0;
    return stringValue((nested ?? inner).message) ?? raw;
  } catch {
    return raw;
  }
}
function parseProviderError(errText) {
  try {
    const parsed = JSON.parse(errText);
    if (!isRecord(parsed)) return { message: errText };
    const nested = isRecord(parsed.error) ? parsed.error : void 0;
    const body = nested ?? parsed;
    const rawMessage = stringValue(body.message);
    return {
      root: parsed,
      nested,
      code: stringValue(body.code),
      type: stringValue(body.type),
      rawMessage,
      // The body itself is the floor, never `undefined`: the Messages endpoint
      // answers some rejections with bare prose (`Invalid input: expected
      // number, received undefined at max_tokens`, `Too small: expected array to
      // have >=1 items at messages`), and dropping those lost the only sentence
      // the user could act on.
      message: unwrapProviderMessage(rawMessage) ?? errText,
      rateLimit: isRecord(body.rateLimit) ? body.rateLimit : void 0
    };
  } catch {
    return { message: errText };
  }
}
function generateHttpError(status, errText, retryAfterMs, parsed = parseProviderError(errText), priorRejection) {
  const providerCode = parsed.nested === void 0 ? void 0 : parsed.code;
  const providerDetail = parsed.nested === void 0 ? "" : [parsed.code, parsed.type, parsed.rawMessage ?? parsed.message].filter((part) => part !== void 0 && part !== "").join(" ");
  const detail = providerCode ?? `HTTP ${status}`;
  const overflowDetail = providerDetail !== "" ? providerDetail : errText.slice(0, 500);
  if (status < 500 && OUTPUT_LIMIT_REJECTION.test(overflowDetail)) {
    const stated = /max_tokens:\s*\d+\s*>\s*\d+/.exec(overflowDetail)?.[0] ?? (parsed.message !== void 0 && parsed.message.length <= 200 ? parsed.message : void 0);
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      `Command Code API error ${status}: this request's max_tokens is not valid for this model` + (stated ? ` (${stated})` : "") + ' — the session is not oversized, so compacting it will not help; lower "Max output tokens" or pick a model with a larger output ceiling',
      `Command Code API 返回 ${status}：本次请求的 max_tokens 对该模型不合法` + (stated ? `（${stated}）` : "") + "——会话内容并未超长，压缩上下文无效；请调低「最大输出 token」或改用输出上限更大的模型",
      { status }
    );
  }
  if (status < 500 && isContextOverflowDetail(overflowDetail)) {
    return bilingual(
      CONTEXT_WINDOW_EXCEEDED_CODE,
      `Command Code API error ${status}: the request exceeds the model's context window — this session is being compacted and the request retried`,
      `Command Code API 返回 ${status}：请求内容超出模型上下文窗口——正在压缩上下文后重试；如仍失败，请新建会话或减少上下文`,
      { status }
    );
  }
  const nodeLimit = status < 500 ? JSON_NODE_LIMIT_REJECTION.exec(overflowDetail)?.[1] : void 0;
  if (nodeLimit !== void 0) {
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      `Command Code API error ${status}: the request exceeds the gateway's JSON node limit (node count cannot exceed ${nodeLimit}) — the cap is on the request's structure, not its token length, so compacting the session usually will not be enough; start a new session, or reduce the messages and images in this one`,
      `Command Code API 返回 ${status}：请求超过网关的 JSON 节点数上限（节点数不能超过 ${nodeLimit}）——限制的是请求结构，不是 token 长度，压缩上下文通常不足以降到该上限以内；请新建会话，或减少本会话中的消息与图片`,
      { status }
    );
  }
  if (status < 500 && ASSISTANT_MESSAGE_SHAPE_REJECTION.test(overflowDetail)) {
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      `Command Code API error ${status}: a replayed assistant turn is malformed — the provider refuses a message whose content is empty while it carries no tool call (upstream: "content or tool_calls must be set"). This is not a model, plan or settings problem: the session history contains a turn this endpoint cannot accept. Update the plugin, then retry; if it persists, start a new session`,
      `Command Code API 返回 ${status}：回放的 assistant 消息结构不合法——上游拒绝了「正文为空且没有工具调用」的 assistant 消息（原文：content or tool_calls must be set）。这不是模型、套餐或请求设置的问题，而是会话历史里存在该端点无法接受的一轮。请升级插件后重试；若仍失败，请新建会话`,
      { status }
    );
  }
  if (status === 422 && isZdrNoProviders(providerCode, providerDetail, errText)) {
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      `Command Code API error 422 (${detail}): zero data retention is enforced but no ZDR-capable upstream is available for this model — turn the ZDR setting off (or use another model)`,
      "Command Code API 返回 422：已开启零数据保留（ZDR），但该模型当前没有可用的 ZDR 上游——请关闭 ZDR 开关，或改用其他模型",
      { status: 422 }
    );
  }
  if (status === 401) {
    return bilingual(
      "INVALID_CREDENTIAL",
      `Command Code API error 401 (${detail}): the API key is missing or invalid — check the key stored for COMMANDCODE_API_KEY (Models page) or the auth file`,
      "Command Code API 返回 401：API 密钥缺失或无效——请在设置页检查 COMMANDCODE_API_KEY 存储的密钥，或检查 auth 文件",
      { status: 401 }
    );
  }
  if (status === 413) {
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      "Command Code API error 413: the request body exceeds the provider's size limit (the cap is undocumented, measured at about 50 MB) — the session history is too large to send, usually because of accumulated image attachments. Start a new session, or drop the image-heavy part of this one, and retry",
      "Command Code API 返回 413：请求体超过服务端的体积上限（官方未公开，实测约 50 MB）——会话历史过大，通常是历史图片累积所致。请新建会话，或移除本会话中图片较多的部分后重试",
      { status: 413 }
    );
  }
  const creditsCode = providerCode?.toUpperCase();
  if (creditsCode !== void 0 && INSUFFICIENT_CREDITS_CODES.has(creditsCode) || isInsufficientCreditsText(overflowDetail) || isInsufficientCreditsText(errText)) {
    return bilingual(
      httpErrorCode(status),
      `Command Code API error ${status}: this account has insufficient credits for the request — top up credits or switch to another account`,
      `Command Code API 返回 ${status}：账户额度不足，无法完成本次请求——请充值额度，或切换到其他账号`,
      { status }
    );
  }
  const safeIdentifier = (value) => value !== void 0 && /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : void 0;
  const diagnosticCode = safeIdentifier(parsed.code) ?? /^\s*(MODEL_NOT_IN_PLAN|INSUFFICIENT_CREDITS|USAGE_EXCEEDED|PREMIUM_CREDITS_EXHAUSTED)\b/i.exec(parsed.message ?? "")?.[1];
  const diagnosticType = safeIdentifier(parsed.type);
  const identifiers = [
    diagnosticCode === void 0 ? void 0 : `错误码：${diagnosticCode}`,
    diagnosticType === void 0 ? void 0 : `错误类型：${diagnosticType}`
  ].filter((value) => value !== void 0);
  const diagnostic = identifiers.length === 0 ? "" : `（${identifiers.join("；")}）`;
  const priorIdentifier = priorRejection === void 0 ? void 0 : safeIdentifier(priorRejection);
  const priorNote = priorIdentifier === void 0 ? "" : `此前 Messages 接口以 ${priorIdentifier} 拒绝，已回退 CLI 直连，仍未成功。`;
  return providerError(
    `Command Code 请求失败（HTTP ${status}）${diagnostic}：` + (status === 429 ? "请求受到用量或速率限制，请稍后重试并检查账户额度。" : status === 408 ? "服务端处理超时，请稍后重试。" : status >= 500 ? "上游服务暂时无法完成请求，请稍后重试。" : "服务端拒绝了本次请求，请检查模型、套餐和请求设置。") + priorNote,
    httpErrorCode(status),
    {
      status,
      ...retryAfterMs !== void 0 && retryAfterMs > 0 && retryAfterMs <= RETRY_MAX_DELAY_MS ? { providerRetryAfterMs: retryAfterMs } : {}
    }
  );
}
function httpErrorCode(status) {
  if (status === 429) return THROTTLED_CODE;
  if (status === 408) return "TIMEOUT";
  if (status >= 500) return "SERVER";
  return "PROVIDER_HTTP_ERROR";
}
function parseRetryAfterMs(value, now = Date.now()) {
  if (value === void 0 || value === null) return void 0;
  const trimmed = value.trim();
  if (trimmed === "") return void 0;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const ms = seconds * 1e3;
    return Number.isFinite(ms) ? Math.round(ms) : void 0;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return void 0;
}
var ACCOUNT_UNAVAILABLE_CODES = /* @__PURE__ */ new Set([
  "USAGE_EXCEEDED",
  "INSUFFICIENT_CREDITS",
  "PREMIUM_CREDITS_EXHAUSTED",
  "MODEL_NOT_IN_PLAN"
]);
var INSUFFICIENT_CREDITS_CODES = /* @__PURE__ */ new Set([
  "INSUFFICIENT_CREDITS",
  "PREMIUM_CREDITS_EXHAUSTED"
]);
function isInsufficientCreditsText(text) {
  const lower = text.toLowerCase().replaceAll("_", " ");
  return lower.includes("insufficient credits") || lower.includes("premium credits exhausted") || /insufficient (credit|balance)/.test(lower) || /out of credit/.test(lower);
}
function isModelOutsidePlanText(text) {
  const lower = text.toLowerCase().replaceAll("_", " ");
  return lower.includes("model not in plan") || /not (available|included)[^.]{0,40}plan/.test(lower) || lower.includes("upgrade your plan");
}
function classifyAccountRejection(status, errText, parsed = parseProviderError(errText)) {
  const code = (parsed.code ?? parsed.type)?.toUpperCase();
  if (status === 429 || code === "RATE_LIMITED") {
    const evidence = readWindowLimitEvidence(errText, parsed);
    if (evidence.window === void 0) return { reason: "throttled" };
    return evidence.resetAtMs === void 0 ? { reason: "rate-limit" } : { reason: "rate-limit", resetAtMs: evidence.resetAtMs };
  }
  if (status === 401) return { reason: "invalid-credential" };
  if (code !== void 0 && ACCOUNT_UNAVAILABLE_CODES.has(code)) return { reason: "unavailable" };
  if (status < 400 || status >= 500) return void 0;
  if (isInsufficientCreditsText(errText) || isModelOutsidePlanText(errText)) return { reason: "unavailable" };
  return void 0;
}
var MAX_TRUSTED_RESET_MS = 30 * 24 * 60 * 60 * 1e3;
function readWindowLimitEvidence(errText, parsed) {
  const named = stringValue(parsed.rateLimit?.window);
  const message = parsed.message ?? stringValue(parsed.root?.message) ?? "";
  const seconds = numberValue(parsed.rateLimit?.reset);
  const window = named === "fiveHour" || named === "weekly" || named === "daily" ? named : /usage limit for your plan/i.test(message) || /usage limit for your plan/i.test(errText) ? /weekly/i.test(message) ? "weekly" : "fiveHour" : void 0;
  const stamp = /resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(message)?.[1] ?? /resets at (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/i.exec(errText)?.[1];
  const stamped = stamp === void 0 ? void 0 : Date.parse(stamp);
  const published2 = seconds !== void 0 && seconds > 0 ? Math.round(seconds * 1e3) : stamped !== void 0 && !Number.isNaN(stamped) ? stamped : void 0;
  const resetAtMs = published2 !== void 0 && Number.isFinite(published2) && published2 - Date.now() <= MAX_TRUSTED_RESET_MS ? published2 : void 0;
  return {
    ...window === void 0 ? {} : { window },
    ...resetAtMs === void 0 ? {} : { resetAtMs }
  };
}
function isUpgradeRequiredError(status, errText, parsed = parseProviderError(errText)) {
  if (status !== 403) return false;
  const lower = errText.toLowerCase();
  if (lower.includes("upgrade_required")) return true;
  if (lower.includes("go plan") && lower.includes("api access")) return true;
  if (lower.includes("only plan without api access")) return true;
  if (lower.includes("upgrade to goat or higher")) return true;
  if ((parsed.code ?? parsed.type)?.toLowerCase() === "upgrade_required") return true;
  if (parsed.message?.toLowerCase().includes("go plan") && parsed.message.toLowerCase().includes("api access")) return true;
  return false;
}
function isMessagesPermissionRejection(status, parsed) {
  if (status !== 403) return false;
  return (parsed.code ?? parsed.type)?.toLowerCase() === "permission_error";
}

// src/stream-response.ts
import { randomUUID } from "node:crypto";
import { LlmError as LlmError3, ProviderRequestId, ToolCallId, errorChain } from "../commandcode-host-llm.js";

// src/stream-trace.ts
var STREAM_TRACE_ENV = "DSH_COMMANDCODE_TRACE";
var boundTraceText = () => "";
var openStreamTrace = () => ({ enabled: false, record() {
}, close() {
} });

// src/stream-response.ts
var ConsumerStreamClosed = class extends Error {
};
var READ_STALLED = /* @__PURE__ */ Symbol("readStalled");
function ownedResponseStream(callerSignal, run) {
  const consumer = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, consumer.signal]) : consumer.signal;
  const source = run(signal)[Symbol.asyncIterator]();
  let closed = false;
  const done = () => ({ done: true, value: void 0 });
  const iterator = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (closed) return done();
      try {
        const result = await source.next();
        return closed ? done() : result;
      } catch (error) {
        if (closed) return done();
        throw error;
      }
    },
    async return() {
      if (!closed) {
        closed = true;
        consumer.abort(new ConsumerStreamClosed("消费方已结束读取"));
      }
      await source.return?.();
      return done();
    }
  };
  return iterator;
}
async function* settleStreamResponse(response, context) {
  try {
    yield* readResponse(response, context);
  } finally {
    try {
      context.cleanup();
    } catch {
    }
    context.trace.close();
  }
}
async function* readResponse(response, context) {
  const { protocol, signal, maxTokens, apiBase, streamIdleTimeoutMs, responseMetadata, trace, timing } = context;
  if (!response.body) {
    trace.record("end", { outcome: "empty", code: "PROVIDER_PROTOCOL_ERROR" });
    throw failureWithRequestId(providerError("Command Code API returned no response body", "PROVIDER_PROTOCOL_ERROR"), responseMetadata);
  }
  const reader = response.body.getReader();
  const cancelReader = () => {
    try {
      void reader.cancel().catch(() => void 0);
    } catch {
    }
  };
  let openGate;
  const wakeRead = () => openGate?.();
  const onAbort = () => {
    wakeRead();
    cancelReader();
  };
  const decoder = new TextDecoder();
  let buffer = "";
  const streamStartedAt = Date.now();
  let chunkCount = 0;
  let totalBytes = 0;
  let lastChunkAt = streamStartedAt;
  let idleTimer;
  let idleFired = false;
  const armIdle = () => {
    if (idleTimer !== void 0) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleFired = true;
      wakeRead();
      cancelReader();
    }, streamIdleTimeoutMs);
  };
  const clearIdle = () => {
    if (idleTimer !== void 0) {
      clearTimeout(idleTimer);
      idleTimer = void 0;
    }
  };
  const idleTimeoutError = () => bilingual(
    "TIMEOUT",
    `Command Code API stream from ${apiBase} was idle for ${streamIdleTimeoutMs}ms (no events) and was treated as a dead connection`,
    `Command Code API 流式响应已 ${streamIdleTimeoutMs} 毫秒无任何事件，被判定为死连接——长思考模型可在设置中调大流空闲超时`
  );
  const asm = createBlockAssembler();
  let finish;
  let usage;
  let usageEmitted = false;
  let endRecorded = false;
  let protocolStopped = false;
  const eofFacts = () => ({
    chunks: chunkCount,
    bytes: totalBytes,
    silentMs: Date.now() - lastChunkAt,
    totalMs: Date.now() - streamStartedAt,
    finishSeen: finish !== void 0,
    idleFired,
    buffered: buffer.length
  });
  function* handle(event) {
    captureResponseIdentifiers(responseMetadata, event);
    if (isRecord(event) && (protocol === "messages" && event.type === "message_stop" || protocol === "cli" && event.type === "finish")) protocolStopped = true;
    const chunks = handleEvent(asm, protocol, event);
    for (const chunk of chunks) {
      if (chunk.type === "finish") finish = chunk;
      else if (chunk.type === "usage") usage = chunk.usage;
    }
    for (const chunk of chunks) {
      if (chunk.type === "finish" || chunk.type === "usage") continue;
      signal?.throwIfAborted();
      yield chunk;
    }
  }
  function* handleLine(line) {
    signal?.throwIfAborted();
    if (protocol === "openai" && line.trim().replace(/^data:\s*/, "") === "[DONE]") {
      protocolStopped = true;
      return;
    }
    yield* handle(parseStreamEventLine(line));
  }
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (; ; ) {
      signal?.throwIfAborted();
      let read;
      const gate = new Promise((resolve) => {
        openGate = () => resolve(READ_STALLED);
      });
      armIdle();
      try {
        const pending = reader.read();
        void pending.catch(() => void 0);
        read = await Promise.race([pending, gate]);
      } catch (error) {
        signal?.throwIfAborted();
        trace.record("read-error", {
          chunks: chunkCount,
          bytes: totalBytes,
          silentMs: Date.now() - lastChunkAt,
          message: errorChain(error)
        });
        throw bilingual(
          "TRANSPORT",
          `Command Code API stream from ${apiBase} failed while reading: ${errorChain(error)}`,
          "Command Code API 流式响应中途断开——网络波动所致，重试通常可恢复",
          { cause: error }
        );
      } finally {
        clearIdle();
        openGate = void 0;
      }
      if (read === READ_STALLED) {
        trace.record("eof", { ...eofFacts(), readStalled: true });
        signal?.throwIfAborted();
        throw idleTimeoutError();
      }
      signal?.throwIfAborted();
      const { done, value } = read;
      if (done) {
        trace.record("eof", eofFacts());
        if (idleFired) throw idleTimeoutError();
        if (buffer.trim()) {
          yield* handleLine(buffer);
        }
        break;
      }
      const text = decoder.decode(value, { stream: true });
      if (value.byteLength > 0) timing.first("firstByteMs");
      buffer += text;
      chunkCount += 1;
      totalBytes += value.byteLength;
      lastChunkAt = Date.now();
      trace.record("chunk", {
        n: chunkCount,
        bytes: value.byteLength,
        text: boundTraceText(text)
      });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const [index, line] of lines.entries()) {
        yield* handleLine(line);
        if (protocolStopped) {
          let ignoredLines = 0;
          for (let rest = index + 1; rest < lines.length; rest++) if (lines[rest]?.trim()) ignoredLines++;
          const buffered = buffer.trim().length;
          if (ignoredLines > 0 || buffered > 0) trace.record("protocol-stop", { protocol, ignoredLines, buffered });
          break;
        }
      }
      if (protocolStopped) break;
    }
    signal?.throwIfAborted();
    if (usage !== void 0) {
      usageEmitted = true;
      yield { type: "usage", usage };
    }
    signal?.throwIfAborted();
    if (finish !== void 0) {
      const failure = asm.sawContent ? void 0 : emptyCompletionError(asm.finishReason, maxTokens, usage);
      trace.record("end", {
        outcome: failure === void 0 ? "finished" : failure.code === "OUTPUT_TOKEN_LIMIT" ? "output-token-limit" : failure.code === "REASONING_LIMIT" ? "reasoning-limit" : "empty",
        finishReason: asm.finishReason,
        ...failure === void 0 ? {} : { code: failure.code },
        maxTokens,
        ...usage === void 0 ? {} : { usage },
        chunks: chunkCount,
        bytes: totalBytes,
        totalMs: Date.now() - streamStartedAt,
        sawContent: asm.sawContent,
        responseMetadata
      });
      endRecorded = true;
      if (failure !== void 0) throw failure;
      const replayBlocks = asm.replayBlocks;
      const carryReplay = hasResponseIdentifiers(responseMetadata) || replayBlocks.length > 0;
      yield carryReplay ? {
        ...finish,
        replayState: {
          response: responseMetadata,
          ...replayBlocks.length > 0 ? { blocks: replayBlocks } : {}
        }
      } : finish;
    } else {
      const elapsed = Date.now() - streamStartedAt;
      const detail = `${chunkCount} chunk(s), ${totalBytes} bytes, ${elapsed}ms`;
      trace.record("end", {
        outcome: asm.sawContent ? "stream-closed" : "empty",
        chunks: chunkCount,
        bytes: totalBytes,
        totalMs: elapsed,
        sawContent: asm.sawContent,
        responseMetadata
      });
      endRecorded = true;
      if (!asm.sawContent) {
        throw bilingual("EMPTY_RESPONSE", "Command Code returned an empty response", "Command Code 返回了空响应，重试通常可恢复");
      }
      throw bilingual(
        "STREAM_CLOSED",
        `Command Code API stream from ${apiBase} ended before its finish event (${detail}) — the response was closed mid-generation, so this is not the model stopping by itself`,
        `Command Code API 流式响应在结束事件之前被关闭（生成中途断流），并非模型主动结束——请重试；若频繁出现，可用 ${STREAM_TRACE_ENV}=<文件路径> 抓取原始流以定位断流原因`
      );
    }
  } catch (error) {
    if (!usageEmitted && usage !== void 0) yield { type: "usage", usage };
    if (!endRecorded) {
      trace.record("end", {
        outcome: signal?.aborted ? signal.reason instanceof ConsumerStreamClosed ? "cancelled" : "aborted" : "error",
        code: error instanceof LlmError3 ? error.code : "unknown",
        finishReason: asm.finishReason,
        maxTokens,
        ...usage === void 0 ? {} : { usage },
        sawContent: asm.sawContent,
        chunks: chunkCount,
        bytes: totalBytes,
        totalMs: Date.now() - streamStartedAt,
        responseMetadata
      });
    }
    endRecorded = true;
    signal?.throwIfAborted();
    throw failureWithRequestId(error, responseMetadata);
  } finally {
    clearIdle();
    signal?.removeEventListener("abort", onAbort);
    if (!endRecorded) trace.record("end", {
      outcome: signal?.aborted && !(signal.reason instanceof ConsumerStreamClosed) ? "aborted" : "cancelled",
      ...usage === void 0 ? {} : { usage },
      chunks: chunkCount,
      bytes: totalBytes,
      responseMetadata
    });
    cancelReader();
    try {
      reader.releaseLock();
    } catch {
    }
  }
}
var RESPONSE_ID_HEADERS = ["x-request-id", "request-id", "x-trace-id", "x-generation-id", "traceparent"];
function responseIdentifiers(headers) {
  const result = {};
  for (const name of RESPONSE_ID_HEADERS) {
    const value = diagnosticId(headers.get(name));
    if (value !== void 0) result[name] = value;
  }
  return result;
}
function diagnosticId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512 ? value : void 0;
}
function captureResponseIdentifiers(metadata, event) {
  if (!isRecord(event)) return;
  if (metadata.protocol === "openai" && Array.isArray(event.choices) || event.type === "response-metadata") {
    const id = diagnosticId(event.id);
    if (id !== void 0) metadata.responseId = id;
  }
  for (const name of ["generationId", "providerRequestId", "traceId"]) {
    const id = diagnosticId(event[name]);
    if (id !== void 0) metadata[name] = id;
  }
}
function hasResponseIdentifiers(metadata) {
  return Object.keys(metadata.headers).length > 0 || metadata.responseId !== void 0 || metadata.generationId !== void 0 || metadata.providerRequestId !== void 0 || metadata.traceId !== void 0;
}
function failureWithRequestId(error, metadata) {
  const id = metadata.providerRequestId ?? metadata.headers["x-request-id"] ?? metadata.headers["request-id"];
  if (!(error instanceof LlmError3) || error.failure.requestId !== void 0 || id === void 0) return error;
  return providerError(error.message, error.code, {
    ...error.failure,
    requestId: ProviderRequestId(id),
    ...error.cause === void 0 ? {} : { cause: error.cause }
  });
}
function reasoningDetailsText(value) {
  if (!Array.isArray(value)) return void 0;
  let text = "";
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const exact = stringValue(entry.text);
    const summary = stringValue(entry.summary);
    text += exact !== void 0 && exact !== "" ? exact : summary ?? "";
  }
  return text === "" ? void 0 : text;
}
function nonEmptyText(value) {
  return value === void 0 || value === "" ? void 0 : value;
}
function parseStreamEventLine(line) {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":") || trimmed.startsWith("event:")) return void 0;
  if (trimmed.startsWith("data:")) trimmed = trimmed.slice(5).trim();
  if (!trimmed || trimmed === "[DONE]") return void 0;
  try {
    return JSON.parse(trimmed);
  } catch {
    return void 0;
  }
}
function createBlockAssembler() {
  return {
    nextIndex: 0,
    textIndex: -1,
    textContent: "",
    reasoningIndex: -1,
    reasoningContent: "",
    sawContent: false,
    finishReason: void 0,
    cliCacheWriteTokens: void 0,
    openAiToolCalls: [],
    messagesBlocks: /* @__PURE__ */ new Map(),
    messagesUsage: void 0,
    replayBlocks: []
  };
}
function* closeText(asm) {
  if (asm.textIndex < 0) return;
  yield {
    type: "block-end",
    index: asm.textIndex,
    block: { type: "text", text: asm.textContent }
  };
  asm.textIndex = -1;
  asm.textContent = "";
}
function* closeReasoning(asm) {
  if (asm.reasoningIndex < 0) return;
  yield {
    type: "block-end",
    index: asm.reasoningIndex,
    block: { type: "reasoning", text: asm.reasoningContent }
  };
  asm.reasoningIndex = -1;
  asm.reasoningContent = "";
}
function* emitOpenAiToolCalls(asm) {
  for (const call of asm.openAiToolCalls) {
    const id = call.id ?? randomUUID();
    const name = call.name ?? "";
    const args = call.arguments || "{}";
    const index = asm.nextIndex++;
    asm.sawContent = true;
    yield { type: "block-start", index, blockType: "tool-call" };
    yield { type: "tool-call-delta", index, id: ToolCallId(id), name, argumentsDelta: args };
    yield {
      type: "block-end",
      index,
      block: { type: "tool-call", id: ToolCallId(id), name, arguments: args }
    };
  }
  asm.openAiToolCalls.length = 0;
}
function handleCliEvent(asm, event) {
  const chunks = [];
  if (!isRecord(event)) return chunks;
  switch (event.type) {
    case "text-delta": {
      chunks.push(...closeReasoning(asm));
      if (asm.textIndex < 0) {
        asm.textIndex = asm.nextIndex++;
        chunks.push({ type: "block-start", index: asm.textIndex, blockType: "text" });
      }
      const delta = stringValue(event.text) ?? "";
      asm.textContent += delta;
      if (delta.trim() !== "") asm.sawContent = true;
      chunks.push({ type: "text-delta", index: asm.textIndex, text: delta });
      break;
    }
    case "reasoning-delta": {
      chunks.push(...closeText(asm));
      if (asm.reasoningIndex < 0) {
        asm.reasoningIndex = asm.nextIndex++;
        chunks.push({ type: "block-start", index: asm.reasoningIndex, blockType: "reasoning" });
      }
      const delta = stringValue(event.text) ?? "";
      asm.reasoningContent += delta;
      chunks.push({ type: "reasoning-delta", index: asm.reasoningIndex, text: delta });
      break;
    }
    case "reasoning-start":
      chunks.push(...closeText(asm));
      break;
    case "reasoning-end":
      chunks.push(...closeReasoning(asm));
      break;
    case "tool-call": {
      chunks.push(...closeText(asm), ...closeReasoning(asm));
      const id = stringValue(event.toolCallId) ?? randomUUID();
      const name = stringValue(event.toolName) ?? "";
      const args = JSON.stringify(recordOrEmpty(event.input ?? event.args ?? event.arguments));
      const index = asm.nextIndex++;
      asm.sawContent = true;
      chunks.push(
        { type: "block-start", index, blockType: "tool-call" },
        { type: "tool-call-delta", index, id: ToolCallId(id), name, argumentsDelta: args },
        {
          type: "block-end",
          index,
          block: { type: "tool-call", id: ToolCallId(id), name, arguments: args }
        }
      );
      break;
    }
    case "cache-write-tokens": {
      const cacheWrite = numberValue(event.cacheWriteTokens);
      if (cacheWrite !== void 0 && cacheWrite >= 0) asm.cliCacheWriteTokens = cacheWrite;
      break;
    }
    case "finish": {
      asm.finishReason = stringValue(event.finishReason);
      chunks.push(...closeText(asm), ...closeReasoning(asm));
      const usage = isRecord(event.totalUsage) ? event.totalUsage : void 0;
      const capturedCacheWrite = asm.cliCacheWriteTokens;
      if (usage || capturedCacheWrite !== void 0) {
        const details = isRecord(usage?.inputTokenDetails) ? usage.inputTokenDetails : void 0;
        const totalInput = numberValue(usage?.inputTokens) ?? 0;
        const cacheRead = numberValue(details?.cacheReadTokens) ?? 0;
        const reportedCacheWrite = numberValue(details?.cacheWriteTokens) ?? 0;
        const cacheWrite = reportedCacheWrite === 0 && capturedCacheWrite !== void 0 ? capturedCacheWrite : reportedCacheWrite;
        const tokenUsage = {
          inputTokens: numberValue(details?.noCacheTokens) ?? Math.max(0, totalInput - cacheRead - cacheWrite),
          outputTokens: numberValue(usage?.outputTokens) ?? 0,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite
        };
        const outputDetails = isRecord(usage?.outputTokenDetails) ? usage.outputTokenDetails : void 0;
        const reasoningTokens = numberValue(outputDetails?.reasoningTokens) ?? numberValue(usage?.reasoningTokens);
        if (reasoningTokens !== void 0) tokenUsage.reasoningTokens = reasoningTokens;
        chunks.push({ type: "usage", usage: tokenUsage });
      }
      chunks.push({ type: "finish", reason: mapFinishReason(event.finishReason) });
      break;
    }
    case "error": {
      throw streamErrorToLlmError(event.error, stringValue(event.message));
    }
  }
  return chunks;
}
function handleOpenAIEvent(asm, event) {
  const chunks = [];
  if (!isRecord(event)) return chunks;
  if (event.error !== void 0) throw streamErrorToLlmError(event.error, stringValue(event.message));
  if (isRecord(event.usage)) {
    chunks.push({ type: "usage", usage: mapOpenAIUsage(event.usage) });
  }
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) return chunks;
  const choice = isRecord(choices[0]) ? choices[0] : {};
  const delta = isRecord(choice.delta) ? choice.delta : {};
  const reasoningDelta = nonEmptyText(stringValue(delta.reasoning)) ?? nonEmptyText(stringValue(delta.reasoning_content)) ?? reasoningDetailsText(delta.reasoning_details) ?? "";
  if (reasoningDelta !== "") {
    chunks.push(...closeText(asm));
    if (asm.reasoningIndex < 0) {
      asm.reasoningIndex = asm.nextIndex++;
      chunks.push({ type: "block-start", index: asm.reasoningIndex, blockType: "reasoning" });
    }
    asm.reasoningContent += reasoningDelta;
    chunks.push({ type: "reasoning-delta", index: asm.reasoningIndex, text: reasoningDelta });
  }
  const contentDelta = stringValue(delta.content) ?? "";
  if (contentDelta !== "") {
    chunks.push(...closeReasoning(asm));
    if (asm.textIndex < 0) {
      asm.textIndex = asm.nextIndex++;
      chunks.push({ type: "block-start", index: asm.textIndex, blockType: "text" });
    }
    asm.textContent += contentDelta;
    if (contentDelta.trim() !== "") asm.sawContent = true;
    chunks.push({ type: "text-delta", index: asm.textIndex, text: contentDelta });
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const rawCall of delta.tool_calls) {
      if (!isRecord(rawCall)) continue;
      asm.sawContent = true;
      const callIndex = numberValue(rawCall.index) ?? 0;
      let existing = asm.openAiToolCalls.find((call) => call.index === callIndex);
      const fn = isRecord(rawCall.function) ? rawCall.function : void 0;
      const id = stringValue(rawCall.id);
      const name = fn === void 0 ? void 0 : stringValue(fn.name);
      const argDelta = fn === void 0 ? void 0 : stringValue(fn.arguments) ?? (fn.arguments === void 0 ? "" : JSON.stringify(fn.arguments));
      if (!existing) {
        existing = {
          index: callIndex,
          name: name ?? "",
          arguments: argDelta ?? ""
        };
        if (id !== void 0) existing.id = id;
        asm.openAiToolCalls.push(existing);
      } else {
        if (id !== void 0 && existing.id === void 0) existing.id = id;
        if (name !== void 0 && existing.name === "") existing.name = name;
        if (argDelta !== void 0) existing.arguments += argDelta;
      }
    }
  }
  if (choice.finish_reason !== void 0 && choice.finish_reason !== null) {
    asm.finishReason = stringValue(choice.finish_reason);
    chunks.push(...closeText(asm), ...closeReasoning(asm), ...emitOpenAiToolCalls(asm));
    chunks.push({ type: "finish", reason: mapFinishReason(choice.finish_reason) });
  }
  return chunks;
}
function mapMessagesUsage(raw, previous) {
  if (!isRecord(raw)) return void 0;
  const inputTokens = numberValue(raw.input_tokens) ?? previous?.inputTokens ?? 0;
  const outputTokens = numberValue(raw.output_tokens) ?? previous?.outputTokens ?? 0;
  const cacheRead = numberValue(raw.cache_read_input_tokens) ?? previous?.cacheReadTokens ?? 0;
  const cacheWrite = numberValue(raw.cache_creation_input_tokens) ?? previous?.cacheWriteTokens ?? 0;
  const details = isRecord(raw.output_tokens_details) ? raw.output_tokens_details : void 0;
  const reasoningTokens = numberValue(details?.thinking_tokens) ?? previous?.reasoningTokens;
  const usage = {
    inputTokens: Math.max(0, inputTokens),
    outputTokens,
    cacheReadTokens: cacheRead
  };
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite;
  if (reasoningTokens !== void 0) usage.reasoningTokens = reasoningTokens;
  return usage;
}
function messagesBlockType(native) {
  if (native.type === "text") return "text";
  if (native.type === "thinking") return "reasoning";
  if (native.type === "tool_use") return "tool-call";
  return void 0;
}
function handleMessagesEvent(asm, event) {
  const chunks = [];
  if (!isRecord(event)) return chunks;
  switch (event.type) {
    case "message_start": {
      const message = isRecord(event.message) ? event.message : void 0;
      const usage = mapMessagesUsage(message?.usage);
      if (usage) {
        asm.messagesUsage = usage;
        chunks.push({ type: "usage", usage });
      }
      break;
    }
    case "content_block_start": {
      const wireIndex = numberValue(event.index);
      const native = isRecord(event.content_block) ? event.content_block : void 0;
      const type = native ? messagesBlockType(native) : void 0;
      if (wireIndex === void 0 || type === void 0) break;
      const chunkIndex = asm.nextIndex++;
      const state = {
        type,
        text: stringValue(native?.text) ?? "",
        signature: stringValue(native?.signature) ?? "",
        json: "",
        id: stringValue(native?.id) ?? "",
        name: stringValue(native?.name) ?? "",
        chunkIndex
      };
      asm.messagesBlocks.set(wireIndex, state);
      asm.replayBlocks[chunkIndex] = { type };
      chunks.push({ type: "block-start", index: chunkIndex, blockType: type });
      if (type === "tool-call" && state.id !== "") {
        chunks.push({
          type: "tool-call-delta",
          index: chunkIndex,
          id: ToolCallId(state.id),
          name: state.name,
          argumentsDelta: ""
        });
      }
      break;
    }
    case "content_block_delta": {
      const wireIndex = numberValue(event.index);
      const state = wireIndex === void 0 ? void 0 : asm.messagesBlocks.get(wireIndex);
      const delta = isRecord(event.delta) ? event.delta : void 0;
      if (!state || !delta) break;
      const index = state.chunkIndex;
      if (delta.type === "text_delta" && state.type === "text") {
        const text = stringValue(delta.text) ?? "";
        state.text += text;
        if (text.trim() !== "") asm.sawContent = true;
        chunks.push({ type: "text-delta", index, text });
      } else if (delta.type === "thinking_delta" && state.type === "reasoning") {
        const text = stringValue(delta.thinking) ?? "";
        state.text += text;
        chunks.push({ type: "reasoning-delta", index, text });
      } else if (delta.type === "signature_delta" && state.type === "reasoning") {
        state.signature += stringValue(delta.signature) ?? "";
        const entry = asm.replayBlocks[index];
        if (entry) entry.signature = state.signature;
      } else if (delta.type === "input_json_delta" && state.type === "tool-call") {
        const fragment = stringValue(delta.partial_json) ?? "";
        state.json += fragment;
        chunks.push({
          type: "tool-call-delta",
          index,
          id: ToolCallId(state.id),
          name: state.name,
          argumentsDelta: fragment
        });
      }
      break;
    }
    case "content_block_stop": {
      const wireIndex = numberValue(event.index);
      if (wireIndex === void 0) break;
      const state = asm.messagesBlocks.get(wireIndex);
      if (!state) break;
      asm.messagesBlocks.delete(wireIndex);
      const index = state.chunkIndex;
      if (state.type === "text") {
        if (state.text.trim() !== "") asm.sawContent = true;
        chunks.push({ type: "block-end", index, block: { type: "text", text: state.text } });
      } else if (state.type === "reasoning") {
        chunks.push({ type: "block-end", index, block: { type: "reasoning", text: state.text } });
      } else {
        if (state.id !== "") asm.sawContent = true;
        chunks.push({
          type: "block-end",
          index,
          block: { type: "tool-call", id: ToolCallId(state.id), name: state.name, arguments: state.json || "{}" }
        });
      }
      break;
    }
    case "message_delta": {
      const delta = isRecord(event.delta) ? event.delta : void 0;
      const reason = stringValue(delta?.stop_reason);
      if (reason !== void 0) asm.finishReason = reason;
      const usage = mapMessagesUsage(event.usage, asm.messagesUsage);
      if (usage) {
        asm.messagesUsage = usage;
        chunks.push({ type: "usage", usage });
      }
      break;
    }
    case "message_stop":
      chunks.push({ type: "finish", reason: mapFinishReason(asm.finishReason) });
      break;
    case "ping":
      break;
    case "error":
      throw streamErrorToLlmError(event.error ?? event, stringValue(event.message));
    default:
      break;
  }
  return chunks;
}
function handleEvent(asm, protocol, event) {
  if (protocol === "cli") return handleCliEvent(asm, event);
  return protocol === "messages" ? handleMessagesEvent(asm, event) : handleOpenAIEvent(asm, event);
}
function mapFinishReason(reason) {
  if (reason === "tool-calls" || reason === "tool_calls" || reason === "tool_use") return { kind: "tool-calls" };
  if (reason === "length" || reason === "max_tokens" || reason === "max-tokens" || reason === "max_output_tokens") {
    return { kind: "max-tokens" };
  }
  return { kind: "stop" };
}
function emptyCompletionError(reason, maxTokens, usage) {
  const detail = `finish_reason=${reason ?? "unknown"}, max_tokens=${maxTokens}, outputTokens=${usage?.outputTokens ?? "unknown"}, reasoningTokens=${usage?.reasoningTokens ?? "unknown"}`;
  if (mapFinishReason(reason).kind === "max-tokens") {
    if (usage !== void 0 && usage.outputTokens < maxTokens) {
      return bilingual(
        "REASONING_LIMIT",
        `Command Code stopped the model before it produced answer text or a tool call (${detail}). The output budget was not exhausted, so the upstream ended the generation on its own — a reasoning phase that never converged is the usual cause. Retrying usually recovers; if it repeats, lower the reasoning effort or capture the raw stream with ${STREAM_TRACE_ENV}`,
        "Command Code 在生成正文或工具调用之前就结束了本次响应（" + detail + `）。输出预算并未耗尽，是上游自行终止了生成——常见原因是思考阶段陷入重复、迟迟不收敛。重试通常可恢复；若反复出现，可降低思考强度，或用 ${STREAM_TRACE_ENV} 抓取原始流排查`
      );
    }
    return bilingual(
      "OUTPUT_TOKEN_LIMIT",
      `Command Code returned no answer text or tool call and reported a token-limit finish reason (${detail}). max_tokens is the output budget, not measured token usage. ` + (usage === void 0 ? "The provider supplied no usage, so actual token consumption cannot be confirmed. " : "") + `If this was unexpected, capture the raw stream with ${STREAM_TRACE_ENV} to diagnose the upstream response`,
      "Command Code 未生成正文或工具调用，上游报告输出截断；max_tokens 表示输出预算，并非已消耗 token 数。" + (usage === void 0 ? "上游未返回用量，无法确认实际消耗。" : "") + `若确认预算耗尽，可降低思考强度或在模型和接口上限内增加预算；若与实际情况不符，请通过 ${STREAM_TRACE_ENV} 抓取原始流以排查上游响应`
    );
  }
  if (reason === "content_filter" || reason === "content-filter") {
    return bilingual("CONTENT_FILTER", `Command Code filtered the response (${detail})`, "Command Code 拦截了响应，未生成正文或工具调用");
  }
  return bilingual(
    "EMPTY_RESPONSE",
    `Command Code finished without producing answer text or a tool call (${detail})`,
    "Command Code 返回了空响应（可能只有思考内容），重试通常可恢复"
  );
}
function mapOpenAIUsage(usage) {
  const source = isRecord(usage) ? usage : {};
  const promptTokens = numberValue(source.prompt_tokens) ?? 0;
  const outputTokens = numberValue(source.completion_tokens) ?? 0;
  const totalTokens = numberValue(source.total_tokens);
  const promptDetails = isRecord(source.prompt_tokens_details) ? source.prompt_tokens_details : void 0;
  const cacheRead = numberValue(promptDetails?.cached_tokens) ?? 0;
  const cacheWrite = numberValue(promptDetails?.cache_creation_input_tokens) ?? 0;
  const completionDetails = isRecord(source.completion_tokens_details) ? source.completion_tokens_details : void 0;
  const reasoningTokens = numberValue(completionDetails?.reasoning_tokens);
  const usageOut = {
    inputTokens: Math.max(0, promptTokens - cacheRead - cacheWrite),
    outputTokens,
    cacheReadTokens: cacheRead
  };
  if (cacheWrite > 0) usageOut.cacheWriteTokens = cacheWrite;
  if (reasoningTokens !== void 0) usageOut.reasoningTokens = reasoningTokens;
  if (totalTokens !== void 0) usageOut.totalTokens = totalTokens;
  return usageOut;
}

// src/adapter.ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError as LlmError6,
  ReasoningEffortId,
  errorChain as errorChain2,
  IMAGE_OFFLOAD_REQUIRED_CODE,
  offloadedImageText,
  projectOffloadedImages,
  requiredImageOffload,
  resolveRetryPolicy,
  textOnlyImageText
} from "../commandcode-host-llm.js";

// src/api-key.ts
import { INVALID_CREDENTIAL_CODE, LlmError as LlmError4 } from "../commandcode-host-llm.js";
var LEGAL_API_KEY = /^[\x21-\x7E]+$/;
function assertUsableApiKey(raw, pkg, ref) {
  const value = raw.trim();
  if (value.length === 0) {
    throw new LlmError4(
      `${pkg}: the API key resolved from ${ref} is blank; set ${ref} to the raw key (the web Models page writes it) or export it in the launching environment`,
      INVALID_CREDENTIAL_CODE
    );
  }
  if (!LEGAL_API_KEY.test(value)) {
    throw new LlmError4(
      `${pkg}: the API key resolved from ${ref} contains characters no HTTP header can carry; set ${ref} to the raw key alone (the web Models page writes it)`,
      INVALID_CREDENTIAL_CODE
    );
  }
  return value;
}

// src/image-request.ts
var REQUEST_IMAGE_MAX_LONG_EDGE = 1568;
var REQUEST_IMAGE_MAX_ENCODED_BYTES = 1024 * 1024;
function longEdgeDimensions(width, height, longEdge) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1) };
  }
  if (longEdge >= Math.max(width, height)) return { width, height };
  return width >= height ? { width: longEdge, height: Math.max(1, Math.round(longEdge * height / width)) } : { width: Math.max(1, Math.round(longEdge * width / height)), height: longEdge };
}
function requestImageTarget(ref) {
  const projected = longEdgeDimensions(ref.width, ref.height, REQUEST_IMAGE_MAX_LONG_EDGE);
  const target = {
    ...projected,
    maxBytes: REQUEST_IMAGE_MAX_ENCODED_BYTES,
    maxImageBytes: REQUEST_IMAGE_MAX_ENCODED_BYTES,
    imageTargetBytes: REQUEST_IMAGE_MAX_ENCODED_BYTES
  };
  return target;
}

// src/image-tokens.ts
function imageTokenFamily(modelId) {
  const id = modelId.toLowerCase();
  const vendor = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
  if (id.startsWith("claude")) return "anthropic";
  if (id.startsWith("gpt") || /^o[1-9]/.test(id)) return "openai";
  if (vendor === "google" || id.startsWith("gemini")) return "google";
  if (vendor === "deepseek") return "deepseek";
  return "generic";
}
function imageTokenCost(family, width, height) {
  switch (family) {
    case "anthropic":
      return anthropicImageTokens(width, height);
    case "openai":
      return openAiImageTokens(width, height);
    case "google":
      return googleImageTokens(width, height);
    case "deepseek":
      return deepSeekImageTokens(width, height);
    default:
      return genericImageTokens(width, height);
  }
}
function commandCodeImageTokens(modelId, width, height) {
  return imageTokenCost(imageTokenFamily(modelId), width, height);
}
function anthropicImageTokens(width, height) {
  const projected = longEdgeDimensions(width, height, REQUEST_IMAGE_MAX_LONG_EDGE);
  return Math.max(1, Math.ceil(projected.width * projected.height / 750));
}
function openAiImageTokens(width, height) {
  let scaled = { width: Math.max(1, width), height: Math.max(1, height) };
  const longest = Math.max(scaled.width, scaled.height);
  if (longest > 2048) scaled = scaleBy(scaled, 2048 / longest);
  const shortest = Math.min(scaled.width, scaled.height);
  if (shortest > 768) scaled = scaleBy(scaled, 768 / shortest);
  const tiles = Math.ceil(scaled.width / 512) * Math.ceil(scaled.height / 512);
  return 85 + 170 * tiles;
}
function googleImageTokens(width, height) {
  if (width <= 384 && height <= 384) return 258;
  return 258 * Math.ceil(width / 768) * Math.ceil(height / 768);
}
var DEEPSEEK_PATCH_SIZE = 14;
var DEEPSEEK_DOWNSAMPLE_RATIO = 3;
var DEEPSEEK_MAX_IMAGE_TOKENS = 1024;
var DEEPSEEK_MIN_PIXELS = 544 * 544;
function deepSeekImageTokens(width, height) {
  let scaled = { width: Math.max(1, width), height: Math.max(1, height) };
  const pixels = scaled.width * scaled.height;
  if (pixels < DEEPSEEK_MIN_PIXELS) scaled = scaleBy(scaled, Math.sqrt(DEEPSEEK_MIN_PIXELS / pixels));
  const direct = deepSeekGridTokens(scaled.width, scaled.height);
  if (direct <= DEEPSEEK_MAX_IMAGE_TOKENS) return direct;
  let low = 0;
  let high = 1;
  let best = direct;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    const tokens = deepSeekGridTokens(
      Math.max(1, Math.round(scaled.width * mid)),
      Math.max(1, Math.round(scaled.height * mid))
    );
    if (tokens <= DEEPSEEK_MAX_IMAGE_TOKENS) {
      low = mid;
      best = tokens;
    } else {
      high = mid;
    }
  }
  return best;
}
function deepSeekGridTokens(width, height) {
  const cellsWide = cellCount(width);
  const cellsHigh = cellCount(height);
  return cellsHigh * (cellsWide + 1) + 2;
}
function cellCount(length) {
  const patches = Math.ceil(length / DEEPSEEK_PATCH_SIZE);
  return Math.ceil(patches / DEEPSEEK_DOWNSAMPLE_RATIO);
}
function genericImageTokens(width, height) {
  return Math.max(
    anthropicImageTokens(width, height),
    openAiImageTokens(width, height),
    googleImageTokens(width, height)
  );
}
function scaleBy(size, factor) {
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor))
  };
}

// src/cost-facts.ts
function peakHour(at, windows) {
  const time = new Date(at);
  return time.getUTCDay() !== 0 && time.getUTCDay() !== 6 && windows.some(([start, end]) => time.getUTCHours() >= start && time.getUTCHours() < end);
}

// src/plan-tiers.ts
var PLAN_TIER_ORDER = ["go", "goat", "pro", "provider", "max"];
var PLAN_LABELS = {
  go: "Go",
  goat: "GOAT",
  pro: "Pro",
  provider: "Provider",
  max: "Max"
};
var PLAN_ORDER = Object.fromEntries(
  PLAN_TIER_ORDER.map((tier, index) => [tier, index])
);

// src/capabilities.ts
var KNOWN_EFFORTS = {
  // Re-verified against the authoritative command-code@1.89.1 model table. From
  // 1.82.4 the CLI no longer keeps this map bundled: `getSupportedEfforts()`
  // resolves it through the model catalog (`reasoningEfforts`), served live at
  // `GET /provider/v1/models?view=client` and falling back to an embedded
  // snapshot. The embedded snapshot is a bootstrap only — it was one refresh
  // stale within two days of release (99 of the live catalog's 100 models, and
  // missing the three newest; 1.82.5 folded exactly those three in), so a sync
  // must read the live catalog, not the artifact: exactly these models carry
  // selectable efforts. Models marked 'reasoning:!0' without efforts
  // (e.g. Tencent Hy3, GLM-5/5.1/5.2-Fast)
  // think automatically and are absent here - the CLI omits
  // 'reasoning_effort' for them, so the picker must not offer a selector. Do
  // NOT add entries from the OAuth provider tables (anthropic/openai) - only
  // the Provider-API table is authoritative for this plugin's route.
  //
  // `off` is NOT a strength: it is the DeepSeek family's "do not think" level
  // (command-code@1.73.3), and the official CLI sends it verbatim as
  // `reasoning_effort:"off"` rather than omitting the field. Its presence here
  // is what makes the adapter treat `off` as a real choice for these models
  // instead of the host's "no effort requested" signal - see the lookup in
  // `stream()`. No other family lists it: the Messages transport's
  // `output_config.effort` has no such value, so `off` stays dropped there.
  "Qwen/Qwen3.8-Max": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Max-0902": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-27B": ["low", "medium", "xhigh"],
  "Qwen/Qwen3.8-Flash": ["low", "medium", "xhigh"],
  // command-code@1.56.0; same effort set as its Qwen 3.8 siblings.
  "Qwen/Qwen3.8-Omni-Flash": ["low", "medium", "xhigh"],
  // command-code@1.82.4; the GOAT-tier sibling of `Qwen/Qwen3.8-Max` with the
  // same three selectable levels. It is also the only model the 1.82.2 -> 1.82.4
  // train added to the artifact's own effort table.
  "Qwen/Qwen3.8-Max-Prime": ["low", "medium", "xhigh"],
  // 2026-11-16 (catalog-only sync): `?view=client` serves a new four-level set
  // for the Qwen 4 Max launch, including `off` (the DeepSeek "do not think"
  // level). The 1.89.1 artifact names neither new id, so the catalog is the
  // artifact-side source — the same path earlier catalog-first rows took.
  "Qwen/Qwen4-Max": ["off", "low", "high", "xhigh"],
  // 2026-11-10 (catalog-only sync; the 1.89.0 artifact finally names it): the
  // Fable family's newest and most capable member serves the same five
  // selectable levels as 5.1 and 5. It entered on `?view=client` alone; the
  // command-code@1.89.0 registry row now agrees on levels, context and
  // `zdr:false` (see KNOWN_NON_ZDR_MODELS).
  "claude-fable-5-2": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5-1": ["low", "medium", "high", "xhigh", "max"],
  "claude-fable-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-7": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-4-8": ["low", "medium", "high", "xhigh", "max"],
  "claude-opus-5": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-4-6": ["low", "medium", "high", "xhigh", "max"],
  "claude-sonnet-5": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.68.0; the five-level set shared with the rest of the Sonnet /
  // Opus family. It takes the "recommended" slot from `claude-sonnet-5`.
  "claude-sonnet-5-5": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.39.1 dropped `medium`; the 1.39.2 table ships these three.
  // Still a three-level set at 1.74.3: unlike its V4 siblings, this one never
  // gained `off`, so thinking cannot be switched off on this variant.
  "deepseek/deepseek-v4-flash-fast": ["low", "high", "max"],
  // command-code@1.53.0.
  "deepseek/deepseek-v4.1-flash": ["off", "low", "high", "max"],
  // command-code@1.67.0; the same four-level set as its `deepseek-v4.1-flash`
  // sibling, whose throughput-focused variant this is.
  "deepseek/deepseek-v4.1-flash-fast": ["off", "low", "high", "max"],
  // 2026-11-07 (catalog-only sync): the "High throughput V4.1 Flash" sibling is
  // `minimumPlan: individual-goat` with the same four levels and text + image.
  "deepseek/deepseek-v4.1-flash-ultrafast": ["off", "low", "high", "max"],
  // command-code@1.73.3 added `off` ("Allow disabling thinking for DeepSeek
  // models") to the DeepSeek V4 line and the 4.1 pair above - but NOT to
  // `deepseek-v4-flash-fast`, which the 1.74.3 table still ships at three.
  "deepseek/deepseek-v4-flash": ["off", "high", "max"],
  "deepseek/deepseek-v4-flash-vision-exp": ["off", "high", "max"],
  "deepseek/deepseek-v4-pro": ["off", "high", "max"],
  // command-code@1.82.0 ("Gemini Argon") and the only registry addition in the
  // 1.81.0 -> 1.82.1 train. Three selectable levels, the same set the Gemini
  // Flash family carries.
  "google/gemini-4-argon": ["low", "medium", "high"],
  // 2026-11-13 (catalog-only sync; the 1.89.0 artifact names it now):
  // `google/gemini-4-carbon`, the Pro-tier sibling of Argon — same three
  // selectable levels, 1M context, text + image. It entered on the
  // `?view=client` `reasoningEfforts`, which the artifact registry row repeats
  // verbatim.
  "google/gemini-4-carbon": ["low", "medium", "high"],
  "google/gemini-3.1-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.5-flash": ["low", "medium", "high"],
  "google/gemini-3.5-flash-lite": ["low", "medium", "high"],
  "google/gemini-3.6-flash": ["low", "medium", "high"],
  "google/gemini-3.7-flash": ["low", "medium", "high"],
  "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["low", "medium", "high"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.39.3; it previously reasoned automatically with no levels.
  "moonshotai/Kimi-K3": ["low", "high", "max"],
  // 2026-10-24 (catalog-only sync): the 1.88.0 artifact does not name Kimi K3.1
  // Pro (1.88.2 does, with the same levels), and `?view=client` serves
  // `reasoningEfforts:["low","high","max"]` and the pricing page carries
  // `caps.reasoning: true`. Same three-level set as its K3 predecessor; do not
  // inherit future levels from it without re-checking.
  "moonshotai/Kimi-K3.1-Pro": ["low", "high", "max"],
  // command-code@1.43.0.
  "google/gemini-3.8-flash": ["low", "medium", "high"],
  // `reflection/beam:free` left this map on 2026-11-10 (retirement, not a lazy
  // edit): the row went `hidden` in `?view=client`, disappeared from the
  // default catalog view, and the pricing page, the models docs page and all
  // four plan pages dropped it — the same path the other free previews took.
  // It served the five-level set. The id stays in `KNOWN_NON_ZDR_MODELS`
  // because both sources still serve its `zdr:false` verdict.
  "sakana/fugu-ultra": ["high", "xhigh"],
  // command-code@1.60.0; same three-level set as its Step 3.x Flash siblings,
  // which still reason automatically with no levels and stay out of this map.
  "stepfun/Step-5-Preview": ["low", "medium", "high"],
  // 2026-11-18 (catalog + 1.89.3 artifact sync): the paid Hy4 flagship serves
  // the same three selectable levels as its Preview sibling, and is the family's
  // first member the artifact registers in the same release that launches it.
  "tencent/hy4": ["low", "medium", "high"],
  "tencent/hy4-preview": ["low", "medium", "high"],
  // 2026-11-16 (catalog-only sync): the cheap Hy4 sibling serves `off/high`
  // only — no `low`/`medium`/`xhigh` — and `zdr:false` (see
  // KNOWN_NON_ZDR_MODELS). The 1.89.1 artifact has no registry row for it yet.
  "tencent/hy4-flash": ["off", "high"],
  "xai/grok-4.5": ["low", "medium", "high"],
  "xai/grok-4.6": ["low", "medium", "high", "xhigh"],
  // command-code@1.59.0; same four-level set as Grok 4.6. 1.61.0 put it on a
  // 40% off launch deal (see KNOWN_DEALS).
  "xai/grok-4.7": ["low", "medium", "high", "xhigh"],
  "z-ai/glm-5.3-flash": ["low", "high", "max"],
  // command-code@1.57.0; same effort set as its `z-ai/glm-5.3-flash` sibling.
  "z-ai/glm-5.3-flashx": ["low", "high", "max"],
  "zai-org/GLM-5.2": ["high", "max"],
  "zai-org/GLM-5.3": ["low", "high", "max"],
  // Muse Spark family: selectable levels in command-code@1.45.0, `max` added to
  // 1.3 in 1.48.0 (1.3-contributor keeps the four-level set).
  "meta/muse-spark-1.1": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.2-contributor": ["low", "medium", "high", "xhigh"],
  "meta/muse-spark-1.3": ["low", "medium", "high", "xhigh", "max"],
  "meta/muse-spark-1.3-contributor": ["low", "medium", "high", "xhigh"],
  // command-code@1.80.0 ("Add Muse Wonder"): the Muse family's newest member and
  // the only registry addition in the 1.79.2 -> 1.81.0 train. It carries the
  // same four-level set as Muse Spark 1.1/1.2 (no `max`).
  "meta/muse-wonder-1.0": ["low", "medium", "high", "xhigh"],
  // 2026-11-10 (catalog-only sync; the 1.89.0 artifact names it now): Muse Ember
  // is the Muse family's newest member and the second one to serve `max` (Muse
  // Spark 1.3 is the other). The registry row repeats the five levels verbatim.
  "meta/muse-ember": ["low", "medium", "high", "xhigh", "max"],
  // 2026-10-15; the open-weight Muse Spark. Vision-capable, Go-tier and
  // served only by the live catalog - it postdates the 1.82.4 artifact's own
  // embedded snapshot, so it cannot be read out of `dist/cli.mjs`.
  "meta/muse-spark-open": ["low", "medium", "high"],
  // 2026-10-14; open vision-language reasoning model, Go tier.
  "nvidia/nemotron-3.5-super-vl": ["low", "medium", "high"],
  // command-code@1.49.0; the full five-level set.
  "gpt-6-astra": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.64.0: Claude Opus 5.5 and the GPT-6 Sol / Luna pair, the only
  // registry additions in the 1.62.0 -> 1.64.0 train; all three reason with the
  // same five-level set as `gpt-6-astra`.
  "claude-opus-5-5": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6-sol": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.51.3; it previously reasoned automatically with no levels
  // and lived in KNOWN_THINKING_MODELS. The hidden
  // `minimax/minimax-m3-free` sibling gained the same set in the bundle.
  "MiniMaxAI/MiniMax-M3": ["low", "medium", "high"],
  // 2026-10-20 (catalog-only sync; the 1.86.1 artifact folded the pair in on
  // 2026-10-21): MiniMax M3.1 Flash carries the full five-level set, unlike its
  // three-level M3 sibling. It came from the live `?view=client` catalog — the
  // same catalog-side evidence `reflection/beam:free` arrived on. The `:free`
  // twin left this map on 2026-10-23: its dated promo lapsed
  // (`2026-10-22T10:45Z`), the row went `hidden` in `?view=client`, and it left
  // the default catalog view, the pricing page and the models docs page — the
  // same retirement path `inclusionai/ling-3.1-flash:free` took.
  "minimax/minimax-m3.1-flash": ["low", "medium", "high", "xhigh", "max"],
  // `stealth/space-bunny-alpha` (command-code@1.65.0, `max` added by 1.73.4)
  // was RETIRED by command-code@1.74.3: the artifact drops its own four-level
  // effort list and ships the row as `hidden` instead, the official Desktop
  // changelog for 2026-10-06 says "Remove Space Bunny Alpha from the model
  // picker", and the model is gone from `/provider/v1/models` as well as the
  // pricing page.
  // `stealth/pixel-canary` (the second stealth preview, `xhigh` instead of
  // `high`) was RETIRED by command-code@1.73.1: the CLI hides it behind
  // `isPixelCanaryEnded()` (past 2026-10-01T06:00:00Z) and it is gone from
  // `/provider/v1/models` and the pricing page.
  // command-code@1.77.0 closed both out here as well: neither carries an effort
  // list any more, both sit in the CLI's non-selectable set (its
  // `listSelectableModelIds()` filters them out), and both left the ZDR
  // exclusion set — so no table in this file names either one any more.
  // command-code@1.71.0. Max-and-above availability (see KNOWN_PLANS), Vision
  // per the official registry and inputModalities:["text","image"], and the
  // same five-level set as its `gpt-6-astra` / `gpt-6-sol` predecessors.
  "gpt-6.1-sol": ["low", "medium", "high", "xhigh", "max"],
  // 2026-10-27 (catalog-only sync): `?view=client` serves
  // `reasoningEfforts:["low","medium","high","xhigh","max"]` and the pricing
  // page carries `caps.reasoning: true`; the 1.88.0 artifact does not name the
  // row (1.88.3 does, with the same levels). Same five-level set as its
  // `gpt-6.1-sol` predecessor; do not inherit future levels without
  // re-checking the catalog.
  "gpt-6.1-terra": ["low", "medium", "high", "xhigh", "max"],
  // 2026-11-18 (catalog-only sync): the OpenAI 6.2 pair carries the same
  // five-level set as its `gpt-6.1-*` predecessors. `?view=client` is the only
  // source: the 1.89.3 artifact's registry has no row for either id yet, so the
  // audit reports them as "absent from CLI registry" rather than comparing.
  "gpt-6.2-astra": ["low", "medium", "high", "xhigh", "max"],
  "gpt-6.2-sol": ["low", "medium", "high", "xhigh", "max"],
  // command-code@1.82.2. The paid graduation of the `ling-3.1-flash:free`
  // promo this table used to carry: that row is retired in the same release
  // (the CLI ships it `hidden`, it lost its effort list, and it is gone from
  // both `/provider/v1/models` and the pricing page), so it is named nowhere in
  // this file any more. Three selectable levels, text-only input, Go tier —
  // like its `mistral-large-4` neighbour, and unlike the free stealth previews.
  "inclusionai/ling-3.1-flash": ["low", "medium", "high"],
  // 2026-11-04 (catalog-first sync, confirmed by the 1.88.3 artifact, whose
  // registry now names both the paid row and its retired `:free` twin): the
  // free 1019 promo lapsed at `2026-11-03T16:00Z`, the catalog flipped that row
  // `hidden`, and the paid `inclusionai/ling-3.1-flash-1019` took over the same
  // three selectable levels — the 1019 generation is the 1M-context sibling of
  // `ling-3.1-flash`. Text-only input (see `KNOWN_IMAGE_MODELS`) and Go tier
  // (see `KNOWN_PLANS`).
  "inclusionai/ling-3.1-flash-1019": ["low", "medium", "high"],
  // 2026-11-13 (catalog-only sync; the 1.89.0 artifact names it now):
  // `thinkingmachines/inkling-2-small:free`, the free Inkling 2 Small launch
  // row — four selectable levels, the same `low`/`medium`/`high`/`max` set the
  // free Glyph Cluster preview carries (no `xhigh`), repeated by the registry
  // row. Its paid siblings `thinkingmachines/inkling` and
  // `thinkingmachines/inkling-small` stay in `KNOWN_THINKING_MODELS`: they
  // serve no `reasoningEfforts` at all.
  "thinkingmachines/inkling-2-small:free": ["low", "medium", "high", "max"],
  // `stealth/crouton-alpha` (the 2026-11-04 stealth preview, five levels) left
  // this map on 2026-11-13 with the rest of the picker-facing tables: the row
  // went `hidden` in `?view=client`, left the default catalog view, and was
  // dropped by the pricing page, the models docs page and all four plan pages
  // — the same retirement path Beam 1.0 and Laguna S 2.1 took. The artifact
  // still names it (and the 1.89.0/1.89.1 snapshot marks it `hidden`), which is
  // why `KNOWN_NON_ZDR_MODELS` keeps it.
  // command-code@1.75.0 ("Add Mistral Large 4") — the only model the 1.74.3 ->
  // 1.77.0 train added. A three-level set; Vision per the official registry and
  // the CLI's inputModalities:["text","image"] (see `KNOWN_IMAGE_MODELS`), and
  // Go-tier availability (see `KNOWN_PLANS`).
  "mistral/mistral-large-4": ["low", "medium", "high"],
  // command-code@1.78.0 ("Add Claude Haiku 5.5 (Pro and above)") and 1.79.0
  // ("Add Glyph Cluster as a free model, 100 requests a day") are the only
  // registry additions in the 1.77.0 -> 1.79.1 train. Both carry selectable
  // efforts, so neither belongs in KNOWN_THINKING_MODELS; Claude Haiku 5.5 takes
  // the Claude family's five-level set, while the free Glyph Cluster preview
  // stops at four and offers no `max`.
  "claude-haiku-5-5": ["low", "medium", "high", "xhigh", "max"],
  "stealth/glyph-cluster:free": ["low", "medium", "high", "xhigh"]
  // `stealth/cat-jam:free` — the free stealth preview added on 2026-10-15 with
  // the full five-level set — left every model table on 2026-10-20: the live
  // catalog (both views), the pricing page and the models docs page stopped
  // serving the row, so there is no selectable model left to describe. The
  // 1.84.0 artifact still named it in its ZDR exclusion set, which kept one
  // entry in `KNOWN_NON_ZDR_MODELS` until the 1.86.1 artifact dropped it as
  // well; that table no longer carries the id (decision record, chapter 7
  // item 13).
};
var KNOWN_IMAGE_MODELS = /* @__PURE__ */ new Set([
  "MiniMaxAI/MiniMax-M3",
  "Qwen/Qwen3.6-Plus",
  "Qwen/Qwen3.7-Flash",
  "Qwen/Qwen3.7-Plus",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-Flash",
  "Qwen/Qwen3.8-Max",
  // command-code@1.41.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image"].
  "Qwen/Qwen3.8-Max-0902",
  // command-code@1.56.0; Vision per the official registry and inputModalities.
  "Qwen/Qwen3.8-Omni-Flash",
  // command-code@1.82.4; inputModalities:["text","image"] in both the artifact's
  // embedded catalog and the live `?view=client` catalog.
  "Qwen/Qwen3.8-Max-Prime",
  // 2026-11-16 (catalog-only sync): inputModalities:["text","image"] on both
  // new Open Source rows in `?view=client`, with `caps.vision:true` on the
  // pricing page; neither id is in the 1.89.1 artifact yet.
  "Qwen/Qwen4-Max",
  "tencent/hy4-flash",
  // 2026-11-18 (catalog + 1.89.3 artifact sync): the paid Hy4 flagship takes
  // image input — `inputModalities:["text","image"]` in `?view=client` AND in
  // the artifact's registry row, `caps.vision: true` on the pricing page, and
  // the models docs page labels it "Text input, Vision, Reasoning".
  "tencent/hy4",
  // 2026-11-10 (catalog-only sync): inputModalities:["text","image"] in the live
  // `?view=client` catalog, and `caps.vision: true` on the pricing page.
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-haiku-4-5-20251001",
  // command-code@1.78.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image"].
  "claude-haiku-5-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  // command-code@1.64.0; Vision per the official registry and inputModalities.
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  // command-code@1.68.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image"].
  "claude-sonnet-5-5",
  "deepseek/deepseek-v4-flash-vision-exp",
  // command-code@1.53.0; Vision per the official registry and inputModalities.
  "deepseek/deepseek-v4.1-flash",
  // command-code@1.67.0; Vision per the official registry and inputModalities.
  "deepseek/deepseek-v4.1-flash-fast",
  // 2026-11-07 (catalog-only sync): inputModalities:["text","image"] in
  // `?view=client` and on the models docs page.
  "deepseek/deepseek-v4.1-flash-ultrafast",
  // command-code@1.82.0; Vision per the official registry, the CLI's
  // inputModalities:["text","image"] and the docs page's "Text input, Vision,
  // Reasoning" capability label.
  "google/gemini-4-argon",
  // 2026-11-13 (catalog-only sync): inputModalities:["text","image"] in
  // `?view=client` and the models docs page's Vision capability label.
  "google/gemini-4-carbon",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.5-flash",
  "google/gemini-3.5-flash-lite",
  "google/gemini-3.6-flash",
  "google/gemini-3.7-flash",
  // command-code@1.43.0; Vision per the official registry and inputModalities.
  "google/gemini-3.8-flash",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  // command-code@1.49.0; Vision per the official registry and inputModalities.
  "gpt-6-astra",
  // command-code@1.64.0 added the GPT-6 Sol / Luna pair; Vision per the
  // official registry and inputModalities.
  "gpt-6-luna",
  "gpt-6-sol",
  // command-code@1.71.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image"] — unlike the text-only Ling free models.
  "gpt-6.1-sol",
  // 2026-10-27 (catalog-only sync): inputModalities:["text","image"] in the live
  // `?view=client` catalog; the pricing page (`caps.vision: true`) and the
  // models docs page both mark the row Vision.
  "gpt-6.1-terra",
  // 2026-11-18 (catalog-only sync): inputModalities:["text","image"] in
  // `?view=client`; the pricing page (`caps.vision: true`) and the models docs
  // page both mark both rows Vision. No 1.89.3 registry row for either id yet.
  "gpt-6.2-astra",
  "gpt-6.2-sol",
  // command-code@1.44.0 added Muse Spark 1.3 and its Contributor sibling; both
  // are Vision per the official registry and inputModalities.
  "meta/muse-spark-1.1",
  "meta/muse-spark-1.2",
  "meta/muse-spark-1.2-contributor",
  "meta/muse-spark-1.3",
  "meta/muse-spark-1.3-contributor",
  // command-code@1.80.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image","file"] — one of two models in this catalog
  // that also declares the `file` modality (the other is `meta/muse-ember`).
  "meta/muse-wonder-1.0",
  // 2026-11-10 (catalog-only sync): inputModalities:["text","image","file"] in
  // the live `?view=client` catalog, and `caps.vision: true` on the pricing page.
  "meta/muse-ember",
  // 2026-10-15; inputModalities:["text","image"] in the live catalog.
  "meta/muse-spark-open",
  // 2026-10-14; inputModalities:["text","image"], and the only Nemotron row
  // in this catalog that carries vision.
  "nvidia/nemotron-3.5-super-vl",
  // command-code@1.75.0; Vision per the official registry and the CLI's
  // inputModalities:["text","image"].
  "mistral/mistral-large-4",
  // 2026-10-20 (catalog-only sync): inputModalities:["text","image"] in the
  // live `?view=client` catalog, and the models docs page labels the row
  // Vision. The `:free` twin left this map with the other snapshots on
  // 2026-10-23 (promo lapsed, row hidden).
  "minimax/minimax-m3.1-flash",
  "moonshotai/Kimi-K2.5",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.7-Code-Highspeed",
  "moonshotai/Kimi-K3",
  // 2026-10-24 (catalog-only sync): inputModalities:["text","image"] in the live
  // `?view=client` catalog, and both the pricing page (`caps.vision: true`) and
  // the models docs page mark the row Vision.
  "moonshotai/Kimi-K3.1-Pro",
  // 2026-10-21 (command-code@1.86.1 sync): inputModalities:["text","image"] in
  // the live `?view=client` catalog and `caps.vision: true` on both the pricing
  // page and the models docs page. The `:free` twin left this map on 2026-10-23
  // with the other snapshots (promo lapsed, row hidden).
  "ornith/ornith-1.5-122b",
  "sakana/fugu-ultra",
  // 2026-11-13 (catalog-only sync): inputModalities:["text","image"] in
  // `?view=client`, and both the pricing page (`caps.vision: true`) and the
  // models docs page mark the row Vision.
  "thinkingmachines/inkling-2-small:free",
  // `stealth/crouton-alpha` (the first stealth preview with image input) left
  // this map on 2026-11-13 with the rest of the picker-facing tables — the row
  // is `hidden` in `?view=client` and gone from every public page.
  // command-code@1.65.0; Vision per the official registry and inputModalities.
  "stepfun/Step-3.7-Flash",
  // command-code@1.60.0; Vision per the official registry and inputModalities.
  "stepfun/Step-5-Preview",
  "thinkingmachines/inkling",
  "thinkingmachines/inkling-small",
  "xai/grok-4.5",
  // command-code@1.47.0 marked Grok 4.6 vision-capable (text-only in 1.46.0).
  "xai/grok-4.6",
  // command-code@1.59.0; Vision per the official registry and inputModalities.
  "xai/grok-4.7",
  // `xiaomi/mimo-v2.5` left this map on 2026-10-23: MiMo V2.6 took over its
  // rates, the row went `hidden` in `?view=client`, and the default catalog
  // view, the pricing page and the models docs page stopped serving it.
  // command-code@1.62.0 added the MiMo V2.6 family (Flash, Pro, Pro
  // UltraSpeed); all three are Vision. None carries a reasoning flag in any
  // source, so no effort or automatic-reasoning entry belongs beside these.
  "xiaomi/mimo-v2.6-flash",
  "xiaomi/mimo-v2.6-pro",
  "xiaomi/mimo-v2.6-pro-ultraspeed",
  "z-ai/glm-5.3-flash",
  // command-code@1.57.0; Vision per the official registry and inputModalities.
  "z-ai/glm-5.3-flashx"
]);
var MESSAGES_ONLY_MODELS = /* @__PURE__ */ new Set([
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-haiku-4-5-20251001"
]);
function requiresMessagesEndpoint(modelId) {
  return MESSAGES_ONLY_MODELS.has(modelId) || modelId.startsWith("claude-");
}
var PINNED_TEMPERATURE_MODELS = /* @__PURE__ */ new Set([
  "moonshotai/Kimi-K3.1-Pro"
]);
function pinsTemperature(modelId) {
  return PINNED_TEMPERATURE_MODELS.has(modelId);
}
var MODEL_OUTPUT_TOKEN_LIMITS = /* @__PURE__ */ new Map([
  // anthropic
  ["claude-fable-5", 128e3],
  // anthropic
  ["claude-fable-5-1", 128e3],
  // anthropic
  ["claude-fable-5-2", 128e3],
  // anthropic
  ["claude-haiku-4-5-20251001", 64e3],
  // anthropic
  ["claude-haiku-5-5", 128e3],
  // anthropic
  ["claude-opus-4-7", 128e3],
  // anthropic
  ["claude-opus-4-8", 128e3],
  // anthropic
  ["claude-opus-5", 128e3],
  // anthropic
  ["claude-opus-5-5", 128e3],
  // anthropic
  ["claude-sonnet-4-6", 128e3],
  // anthropic
  ["claude-sonnet-5", 128e3],
  // anthropic
  ["claude-sonnet-5-5", 128e3],
  // deepseek
  ["deepseek/deepseek-v4-flash", 393216],
  // 1 provider(s), unanimous
  ["deepseek/deepseek-v4-flash-fast", 384e3],
  // deepseek
  ["deepseek/deepseek-v4-flash-vision-exp", 393216],
  // deepseek
  ["deepseek/deepseek-v4-pro", 393216],
  // google
  ["google/gemini-3.1-flash-lite", 65536],
  // google
  ["google/gemini-3.5-flash", 65536],
  // google
  ["google/gemini-3.5-flash-lite", 65536],
  // google
  ["google/gemini-3.6-flash", 65536],
  // google
  ["google/gemini-3.7-flash", 65536],
  // google
  ["google/gemini-3.8-flash", 65536],
  // google
  ["google/gemini-4-argon", 32768],
  // google
  ["google/gemini-4-carbon", 32768],
  // openai
  ["gpt-5.3-codex", 128e3],
  // openai
  ["gpt-5.4", 128e3],
  // openai
  ["gpt-5.4-mini", 128e3],
  // openai
  ["gpt-5.5", 128e3],
  // openai
  ["gpt-5.6-luna", 128e3],
  // openai
  ["gpt-5.6-sol", 128e3],
  // openai
  ["gpt-5.6-terra", 128e3],
  // openai
  ["gpt-6-astra", 128e3],
  // openai
  ["gpt-6-luna", 128e3],
  // openai
  ["gpt-6-sol", 128e3],
  // openai
  ["gpt-6.1-sol", 128e3],
  // openai
  ["gpt-6.1-terra", 128e3],
  // openai
  ["gpt-6.2-astra", 128e3],
  // openai
  ["gpt-6.2-sol", 128e3],
  // 2 provider(s), unanimous
  ["inclusionai/ling-3.1-flash-1019", 262144],
  // 2 provider(s), unanimous
  ["meituan/LongCat-2.0", 131072],
  // meta
  ["meta/muse-spark-1.1", 131072],
  // meta
  ["meta/muse-spark-1.2", 131072],
  // meta
  ["meta/muse-spark-1.2-contributor", 131072],
  // meta
  ["meta/muse-spark-1.3", 131072],
  // meta
  ["meta/muse-spark-1.3-contributor", 131072],
  // meta
  ["meta/muse-wonder-1.0", 131072],
  // minimax
  ["minimax/minimax-m3.1-flash", 524288],
  // minimax
  ["MiniMaxAI/MiniMax-M2.5", 131072],
  // minimax
  ["MiniMaxAI/MiniMax-M2.7", 131072],
  // minimax
  ["MiniMaxAI/MiniMax-M3", 524288],
  // 9 provider(s), unanimous
  ["mistral/mistral-large-4", 262144],
  // moonshotai
  ["moonshotai/Kimi-K2.6", 262144],
  // moonshotai
  ["moonshotai/Kimi-K2.7-Code", 262144],
  // moonshotai
  ["moonshotai/Kimi-K2.7-Code-Highspeed", 262144],
  // moonshotai
  ["moonshotai/Kimi-K3", 1048576],
  // moonshotai
  ["moonshotai/Kimi-K3.1-Pro", 1048576],
  // nvidia
  ["nvidia/nemotron-3-ultra-550b-a55b", 65536],
  // 1 provider(s), unanimous
  ["ornith/ornith-1.5-122b", 32768],
  // alibaba
  ["Qwen/Qwen3.6-Max-Preview", 65536],
  // alibaba
  ["Qwen/Qwen3.6-Plus", 65536],
  // alibaba
  ["Qwen/Qwen3.7-Flash", 131072],
  // alibaba
  ["Qwen/Qwen3.7-Max", 131072],
  // alibaba
  ["Qwen/Qwen3.7-Plus", 131072],
  // alibaba
  ["Qwen/Qwen3.8-Flash", 131072],
  // alibaba
  ["Qwen/Qwen3.8-Max", 131072],
  // 2 provider(s), unanimous
  ["Qwen/Qwen3.8-Max-0902", 131072],
  // 1 provider(s), unanimous
  ["Qwen/Qwen3.8-Max-Prime", 131072],
  // alibaba
  ["Qwen/Qwen3.8-Omni-Flash", 131072],
  // 1 provider(s), unanimous
  ["Qwen/Qwen4-Max", 262144],
  // 1 provider(s), unanimous
  ["recursive/flint-v1.0:free", 235929],
  // sakana
  ["sakana/fugu-ultra", 1e6],
  // 1 provider(s), unanimous
  ["stealth/glyph-cluster:free", 256e3],
  // stepfun
  ["stepfun/Step-3.5-Flash", 256e3],
  // stepfun
  ["stepfun/Step-3.7-Flash", 256e3],
  // stepfun
  ["stepfun/Step-5-Preview", 65536],
  // 1 provider(s), unanimous
  ["tencent/hy3-paid", 128e3],
  // thinkingmachines
  ["thinkingmachines/inkling", 65536],
  // 1 provider(s), unanimous
  ["thinkingmachines/inkling-2-small:free", 131072],
  // thinkingmachines
  ["thinkingmachines/inkling-small", 65536],
  // xai
  ["xai/grok-4.5", 5e5],
  // xai
  ["xai/grok-4.6", 5e5],
  // xai
  ["xai/grok-4.7", 5e5],
  // xiaomi
  ["xiaomi/mimo-v2.6-flash", 131072],
  // xiaomi
  ["xiaomi/mimo-v2.6-pro", 131072],
  // xiaomi
  ["xiaomi/mimo-v2.6-pro-ultraspeed", 131072],
  // zai
  ["z-ai/glm-5.3-flash", 131072],
  // zai
  ["z-ai/glm-5.3-flashx", 131072],
  // zai
  ["zai-org/GLM-5", 131072],
  // zai
  ["zai-org/GLM-5.1", 131072],
  // zai
  ["zai-org/GLM-5.2", 131072],
  // zai
  ["zai-org/GLM-5.3", 131072]
]);
var DEFAULT_MESSAGES_MAX_TOKENS = 64e3;
var KNOWN_PLANS = {
  // --- Go (57 paid + 3 free) ---
  "MiniMaxAI/MiniMax-M2.5": "go",
  "MiniMaxAI/MiniMax-M2.7": "go",
  "MiniMaxAI/MiniMax-M3": "go",
  "Qwen/Qwen3.6-Max-Preview": "go",
  "Qwen/Qwen3.6-Plus": "go",
  "Qwen/Qwen3.7-Flash": "go",
  "Qwen/Qwen3.7-Max": "go",
  "Qwen/Qwen3.7-Plus": "go",
  "Qwen/Qwen3.8-27B": "go",
  "Qwen/Qwen3.8-Flash": "go",
  "Qwen/Qwen3.8-Max": "go",
  // 2026-11-16 (catalog-only sync): individual-go through teams-pro are all
  // true on the pricing page; the official model page says "Go and above".
  "Qwen/Qwen4-Max": "go",
  // command-code@1.41.0; listed on the Go plan page.
  "Qwen/Qwen3.8-Max-0902": "go",
  // command-code@1.82.4; individual-go is false and individual-goat true — the
  // one new model in this train that lands on GOAT rather than Go.
  "Qwen/Qwen3.8-Max-Prime": "goat",
  // command-code@1.56.0; the pricing page's embedded availability grants every
  // tier (individual-go through teams-pro) — the "all":true shape shared by the
  // Qwen 3.8 family and the stealth-preview models below.
  "Qwen/Qwen3.8-Omni-Flash": "go",
  // command-code@1.39.0; Go-tier like the rest of the DeepSeek V4 family.
  "deepseek/deepseek-v4-flash-fast": "go",
  // command-code@1.53.0; every plan including Go.
  "deepseek/deepseek-v4.1-flash": "go",
  // command-code@1.67.0; individual-go true, so Go-tier like the rest of the
  // DeepSeek V4 family.
  "deepseek/deepseek-v4.1-flash-fast": "go",
  "deepseek/deepseek-v4-flash": "go",
  "deepseek/deepseek-v4-flash-vision-exp": "go",
  "deepseek/deepseek-v4-pro": "go",
  "gpt-5.6-luna": "go",
  // command-code@1.64.0; the opensource-category GPT-6, on every plan including
  // Go, unlike its premium-category siblings Sol (Pro) and Astra (Provider/Max).
  "gpt-6-luna": "go",
  // command-code@1.42.0 added the free LongCat 2.0 on every plan; that promo
  // ended 2026-09-19 and the catalog renamed the id to the paid
  // `meituan/LongCat-2.0` ($0.30/$1.20/$0.006), which keeps this slot. The CLI
  // followed in command-code@1.58.0, marking the retired `:free` sibling
  // `hidden`, so its registry now agrees with the catalog this map is keyed by.
  "meituan/LongCat-2.0": "go",
  // command-code@1.82.2; the paid successor of the retired
  // `ling-3.1-flash:free` promo. The pricing page's embedded availability
  // grants every tier (individual-go through teams-pro) — the "all":true shape
  // shared with its `ling-3.0-flash-sante:free` predecessor.
  "inclusionai/ling-3.1-flash": "go",
  // 2026-11-04; the free 1019 promo lapsed and the paid row graduated in
  // place — Go on every source (`minimumPlan: "individual-go"` in
  // `?view=client`, and the pricing page's embedded availability grants every
  // tier, the same "all":true shape as its `ling-3.1-flash` sibling).
  "inclusionai/ling-3.1-flash-1019": "go",
  // 2026-11-13 (catalog-only sync): the free Inkling 2 Small launch row is Go on
  // every source — `minimumPlan: "individual-go"` in `?view=client` and
  // `"all": true` in the pricing page's embedded availability, so it appears on
  // the go / goat / pro / max plan pages alike.
  "thinkingmachines/inkling-2-small:free": "go",
  // `stealth/crouton-alpha` (Go on every source) left this map on 2026-11-13
  // with the rest of the picker-facing tables: the row is `hidden` in
  // `?view=client` and gone from the go / goat / pro / max plan pages.
  // command-code@1.44.0; on every plan including Go, like its 1.2 Contributor
  // sibling.
  "meta/muse-spark-1.2-contributor": "go",
  "meta/muse-spark-1.3-contributor": "go",
  // 2026-10-15; individual-go true (Go and every higher tier), the same
  // "all":true availability shape as its Muse siblings.
  "meta/muse-spark-open": "go",
  // 2026-11-10 (catalog-only sync): Muse Ember is Go on every source —
  // `minimumPlan: "individual-go"` in `?view=client` and every tier true in the
  // pricing page's embedded availability, so the go / goat / pro / max plan
  // pages all list it. It entered on catalog-only evidence; the 1.89.0 artifact
  // registry row now carries `minimumPlan: "individual-go"` as well.
  "meta/muse-ember": "go",
  // command-code@1.75.0; the pricing page's embedded availability grants every
  // tier (individual-go through teams-pro) — the "all":true shape shared by the
  // Qwen 3.8 family above.
  "mistral/mistral-large-4": "go",
  // 2026-10-20 (catalog-only sync): MiniMax M3.1 Flash is Go-tier —
  // `minimumPlan: "individual-go"` in the live `?view=client` catalog and every
  // tier true in the pricing page's embedded availability. The `:free` twin left
  // this map on 2026-10-23 (promo lapsed, row hidden).
  "minimax/minimax-m3.1-flash": "go",
  "moonshotai/Kimi-K2.5": "go",
  "moonshotai/Kimi-K2.6": "go",
  "moonshotai/Kimi-K2.7-Code": "go",
  "moonshotai/Kimi-K2.7-Code-Highspeed": "go",
  "moonshotai/Kimi-K3": "go",
  // 2026-10-24 (catalog-only sync): `minimumPlan: "individual-go"` in the live
  // `?view=client` catalog and every tier true in the pricing page's embedded
  // availability (`"all": true`); the go/goat/pro plan pages all list the row.
  "moonshotai/Kimi-K3.1-Pro": "go",
  "nvidia/nemotron-3-ultra-550b-a55b": "go",
  // 2026-10-14; individual-go true, the "all":true shape shared by the rest of
  // the open-weight Nemotron family.
  "nvidia/nemotron-3.5-super-vl": "go",
  // 2026-10-21 (command-code@1.86.1 sync): Ornith 1.5 122B is a Go-tier
  // open-weight MoE — `minimumPlan: "individual-go"` in the live catalog and
  // every tier true in the pricing page's embedded availability. The `:free`
  // twin left this map on 2026-10-23 (promo lapsed, row hidden).
  "ornith/ornith-1.5-122b": "go",
  // `poolside/laguna-s-2.1-free` left this map on 2026-11-06 with the free
  // Laguna S 2.1 retirement (command-code@1.88.4); `?view=client` still serves
  // the row but only as `hidden`, and this map tracks the default view.
  // KNOWN_DEALS drops the matching FREE badge and the generated output-limit
  // table follows this map, so its 32768 row goes too. KNOWN_NON_ZDR_MODELS
  // keeps the id: both sources still serve its `zdr:false` verdict.
  // This map tracks the DEFAULT catalog view: the `hidden:true` rows of
  // `?view=client` do not belong here, unlike `KNOWN_NON_ZDR_MODELS`, whose
  // membership is the catalog/artifact union (see the decision record,
  // chapter 7). `reflection/beam:free` was the one new id the default view
  // served at the 1.84.0 sync (93 ids); on 2026-11-10 the row went `hidden`,
  // left the default view and was dropped by the pricing page, the models docs
  // page and all four plan pages, so it left this map by the same retirement
  // path the other free previews took. At this check the default view carries
  // 97 ids and `?view=client` 112 (fifteen hidden): +Claude Fable 5.2,
  // +Muse Ember, -Beam 1.0 (Free).
  "stepfun/Step-3.5-Flash": "go",
  "stepfun/Step-3.7-Flash": "go",
  // command-code@1.60.0; every tier, and listed by the Go/GOAT/Pro/Max plan
  // pages alike — the superset chain this map encodes.
  "stepfun/Step-5-Preview": "go",
  // `stealth/cat-jam:free` left this map on 2026-10-20 with the rest of the
  // model tables: both catalog views, the pricing page and the models docs page
  // stopped serving it. The 1.86.1 artifact dropped it from its ZDR exclusion
  // set as well, so `KNOWN_NON_ZDR_MODELS` no longer carries it either (see the
  // decision record, chapter 7 item 13).
  // command-code@1.79.0 ("Add Glyph Cluster as a free model, 100 requests a
  // day"); the pricing page's embedded availability grants every tier
  // (individual-go through teams-pro) — the "all":true shape shared by the Ling
  // free models above. Its zero-credit deal (see KNOWN_DEALS) also makes it lead
  // the picker.
  "stealth/glyph-cluster:free": "go",
  "tencent/hy3-paid": "go",
  // 2026-11-18 (catalog + 1.89.3 artifact sync): Go on `?view=client`, in the
  // artifact's registry row (`minimumPlan: "individual-go"`) and on the pricing
  // page's embedded availability (every tier true). Unlike the Preview row it
  // takes image input; see `KNOWN_IMAGE_MODELS`.
  "tencent/hy4": "go",
  "tencent/hy4-preview": "go",
  // 2026-11-16 (catalog-only sync): same all-tiers availability shape as the
  // other Open Source Go rows; "Go and above" on the official model page.
  "tencent/hy4-flash": "go",
  // 2026-11-17 (catalog + 1.89.2 artifact sync): the free Flint row is Go on
  // every source — `minimumPlan: "individual-go"` in `?view=client` and every
  // tier true in the pricing page's embedded availability; the model page says
  // "Available on Go and above".
  "recursive/flint-v1.0:free": "go",
  "thinkingmachines/inkling": "go",
  "thinkingmachines/inkling-small": "go",
  "xai/grok-4.5": "go",
  // `xiaomi/mimo-v2.5` and `xiaomi/mimo-v2.5-pro` left this map on 2026-10-23:
  // MiMo V2.6 took over their rates, both rows went `hidden` in `?view=client`,
  // and this map tracks the default view.
  // command-code@1.62.0 added the MiMo V2.6 family; these two are on every tier
  // (the Go plan page lists both), while the Pro UltraSpeed sibling is GOAT —
  // individual-go is what separates them.
  "xiaomi/mimo-v2.6-flash": "go",
  "xiaomi/mimo-v2.6-pro": "go",
  "z-ai/glm-5.3-flash": "go",
  // command-code@1.57.0; the "all":true shape shared with its
  // `z-ai/glm-5.3-flash` sibling.
  "z-ai/glm-5.3-flashx": "go",
  "zai-org/GLM-5": "go",
  "zai-org/GLM-5.1": "go",
  "zai-org/GLM-5.2": "go",
  "zai-org/GLM-5.2-Fast": "go",
  "zai-org/GLM-5.3": "go",
  // --- GOAT (11 more) ---
  // 2026-11-07 (catalog-only sync): `minimumPlan: "individual-goat"` in
  // `?view=client`, and the pricing page's embedded availability has
  // `individual-go: false`; the go/goat/pro/max plan pages all list the row.
  "deepseek/deepseek-v4.1-flash-ultrafast": "goat",
  // command-code@1.79.2 lowers the 1.78.0 Pro gate to GOAT: individual-go
  // remains false, individual-goat and all higher tiers are true.
  "claude-haiku-5-5": "goat",
  // command-code@1.68.0; individual-go false, individual-goat true — "Available
  // on GOAT and above", one tier ABOVE its `claude-sonnet-5` predecessor, which
  // sits in the Pro block below.
  "claude-sonnet-5-5": "goat",
  "google/gemini-3.7-flash": "goat",
  // command-code@1.43.0; "Available on GOAT and above", like the rest of the
  // Gemini Flash family.
  "google/gemini-3.8-flash": "goat",
  "gpt-5.6-sol": "goat",
  "meta/muse-spark-1.2": "goat",
  // command-code@1.44.0; "Available on GOAT and above", like the 1.2/1.1 models.
  "meta/muse-spark-1.3": "goat",
  "xai/grok-4.6": "goat",
  // command-code@1.59.0; "Available on GOAT and above" (individual-go false).
  "xai/grok-4.7": "goat",
  // command-code@1.62.0; GOAT and above, the same split as its Grok 4.7
  // sibling. Its two cheaper V2.6 siblings are Go, above.
  "xiaomi/mimo-v2.6-pro-ultraspeed": "goat",
  // --- Pro (16 more) ---
  "claude-haiku-4-5-20251001": "pro",
  "claude-sonnet-4-6": "pro",
  "claude-sonnet-5": "pro",
  // command-code@1.82.0; individual-go / go-v1 / goat all false, Pro and every
  // higher tier true — one tier above the Gemini Flash family above it.
  "google/gemini-4-argon": "pro",
  // 2026-11-13 (catalog-only sync): `minimumPlan: "individual-pro"` in
  // `?view=client`; the pricing page's embedded availability sets individual-go
  // / go-v1 / goat false and Pro and above true — the same split as Argon.
  "google/gemini-4-carbon": "pro",
  "google/gemini-3.1-flash-lite": "pro",
  "google/gemini-3.5-flash": "pro",
  "google/gemini-3.5-flash-lite": "pro",
  "google/gemini-3.6-flash": "pro",
  "gpt-5.3-codex": "pro",
  "gpt-5.4": "pro",
  "gpt-5.4-mini": "pro",
  "gpt-5.5": "pro",
  "gpt-5.6-terra": "pro",
  // command-code@1.64.0; Pro and above (individual-go/goat false).
  "gpt-6-sol": "pro",
  // 2026-10-27 (catalog-only sync): `minimumPlan: "individual-pro"` in the live
  // `?view=client` catalog; the pricing page's embedded availability sets
  // individual-go / go-v1 / goat false and Pro and above true.
  "gpt-6.1-terra": "pro",
  // 2026-11-18 (catalog-only sync): `minimumPlan: "individual-pro"` in
  // `?view=client`; the pricing page's embedded availability sets go / go-v1 /
  // goat false and Pro and above true. Absent from the 1.89.3 registry.
  "gpt-6.2-sol": "pro",
  "meta/muse-spark-1.1": "pro",
  // --- Provider (8) ---
  // 2026-11-10 (catalog-only sync): the Fable 5.2 flagship is Provider/Max like
  // its siblings — `minimumPlan: "individual-provider"`, while the pricing
  // page's embedded availability sets go / go-v1 / goat / pro / pro-v1 false and
  // max / ultra / provider / teams-pro true. It entered on catalog-only
  // evidence; the 1.89.0 artifact registry row now carries
  // `minimumPlan: "individual-provider"` as well.
  "claude-fable-5-2": "provider",
  // command-code@1.40.0; Provider/Max exactly like its `claude-fable-5`
  // predecessor — individual-provider/max/ultra and teams-pro only.
  "claude-fable-5-1": "provider",
  "claude-fable-5": "provider",
  "claude-opus-4-7": "provider",
  "claude-opus-4-8": "provider",
  // command-code@1.64.0; Provider API only (go/goat/pro/pro-v1 all false), and
  // the catalog serves it with supported_endpoints ['/messages'] — the Claude
  // route, which the adapter's `claude-*` prefix rule already sends down the
  // CLI transport.
  "claude-opus-5-5": "provider",
  "claude-opus-5": "provider",
  // command-code@1.49.0; on Max.
  "gpt-6-astra": "provider",
  // 2026-11-18 (catalog-only sync): the 6.2 refresh of the Provider flagship at
  // the same `minimumPlan: "individual-provider"` — and CHEAPER than its
  // predecessor ($8/$40 vs `gpt-6-astra`'s $10/$50, cache write $10 vs $12.5).
  // No 1.89.3 registry row yet; the 272k step doubles the row's rates.
  "gpt-6.2-astra": "provider",
  "sakana/fugu-ultra": "provider",
  // --- Max (2) ---
  // command-code@1.71.0; the FIRST Max-only model in this catalog and the only
  // one whose minimum plan is `max`: the embedded availability sets every lower
  // tier false (individual-go / go-v1 / goat / pro / pro-v1 / provider all
  // false) and only individual-max, individual-ultra and teams-pro true.
  // `PLAN_ORDER` already carries `max` above `provider`, so the picker sorts it
  // last without a change there (plan-tiers.ts).
  "gpt-6.1-sol": "max",
  // command-code@1.80.0; the same Max-and-above availability as `gpt-6.1-sol`
  // (every lower tier false, only individual-max / individual-ultra /
  // teams-pro true) and the note "Available on Max and above."
  "meta/muse-wonder-1.0": "max"
};
function isFreeModel(modelId) {
  return KNOWN_DEALS[modelId]?.free === true;
}
function compareByPlan(a, b) {
  const freeDelta = Number(isFreeModel(b.id)) - Number(isFreeModel(a.id));
  if (freeDelta !== 0) return freeDelta;
  const pa = PLAN_ORDER[KNOWN_PLANS[a.id] ?? ""] ?? Number.MAX_SAFE_INTEGER;
  const pb = PLAN_ORDER[KNOWN_PLANS[b.id] ?? ""] ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const nameDiff = a.name.localeCompare(b.name);
  if (nameDiff !== 0) return nameDiff;
  return a.id.localeCompare(b.id);
}
var KNOWN_SUBSCRIPTION_PLANS = {
  "individual-go": { name: "Go", monthlyCredits: 10, tierWeight: 0 },
  // command-code@1.69.0 ("Go plan moves to per-model credits") added this second
  // Go row to the CLI's plan maps. Same display name and monthly total, so
  // `tierWeight` stays 0 alongside `individual-go` — exactly how the pre-existing
  // `individual-pro-v1` sits at Pro's weight 2. Resolution is longest-prefix
  // match (see below), so the explicit `-v1` suffix still wins over the base.
  "individual-go-v1": { name: "Go", monthlyCredits: 10, tierWeight: 0 },
  "individual-goat": { name: "GOAT", monthlyCredits: 70, tierWeight: 1 },
  "individual-pro": { name: "Pro", monthlyCredits: 30, tierWeight: 2 },
  "individual-pro-v1": { name: "Pro", monthlyCredits: 80, tierWeight: 2 },
  "individual-provider": { name: "Provider", monthlyCredits: 15, tierWeight: 3 },
  "individual-max": { name: "Max", monthlyCredits: 150, tierWeight: 4 },
  "individual-ultra": { name: "Ultra", monthlyCredits: 300, tierWeight: 4 },
  "teams-pro": { name: "Teams Pro", monthlyCredits: 40, tierWeight: 2 }
};
var SUBSCRIPTION_PLAN_PREFIXES = Object.keys(KNOWN_SUBSCRIPTION_PLANS).sort((a, b) => b.length - a.length);
function subscriptionPlanInfo(planId) {
  const normalized = planId.toLowerCase().replace(/_/g, "-");
  const prefix = SUBSCRIPTION_PLAN_PREFIXES.find((candidate) => normalized.startsWith(candidate));
  return prefix === void 0 ? void 0 : KNOWN_SUBSCRIPTION_PLANS[prefix];
}
function modelVisibleInPlan(modelId, access) {
  if (access === void 0) return true;
  if (access.onDemandCredits > 0) return true;
  if (access.tierWeight === void 0 || !Number.isFinite(access.tierWeight)) return true;
  const tier = KNOWN_PLANS[modelId];
  if (tier === void 0) return true;
  const weight = PLAN_ORDER[tier];
  if (weight === void 0) return true;
  return weight <= access.tierWeight;
}
function modelVisibleForAnyAccount(modelId, accounts) {
  if (accounts === void 0 || accounts.length === 0) return true;
  return accounts.some((access) => modelVisibleInPlan(modelId, access));
}
var KNOWN_DEALS = {
  "MiniMaxAI/MiniMax-M3": { label: "50% off" },
  // 2026-11-13 (catalog-only sync): `thinkingmachines/inkling-2-small:free` is
  // the free Inkling 2 Small launch row — the undated kind, 100% off "while the
  // free tier lasts", up to 200 requests a day, no published end instant, so it
  // carries no `expiresAt` and is deleted (not lapsed) when the tier ends, like
  // the Glyph Cluster preview below. The pricing page publishes it at a literal
  // zero, which `modelPriceTable()` serves from this deal, so it gets no row in
  // the vendored price table either.
  "thinkingmachines/inkling-2-small:free": { label: "FREE", free: true },
  // 2026-11-17 (catalog + 1.89.2 artifact sync): the free Flint row is 100% off
  // "while the free tier lasts", capped at 1,000 requests a day, with no
  // published end instant — the same undated shape as Inkling / Glyph, so it
  // carries no `expiresAt` and needs no row in the vendored price table (the
  // pricing page publishes literal zeros, served from this deal).
  "recursive/flint-v1.0:free": { label: "FREE", free: true },
  // `stealth/crouton-alpha` (the 2026-11-04 free stealth preview, 1000 requests
  // a day) left this map on 2026-11-13: the row went `hidden` in
  // `?view=client`, left the default catalog view, and the pricing page (its
  // deal list included), the models docs page and all four plan pages dropped
  // it — the same retirement path Beam 1.0 and Laguna S 2.1 took.
  // `inclusionai/ling-3.1-flash-1019:free` (the dated 2026-11-02 promo, 100% off
  // through `2026-11-03T16:00Z`) left this map on 2026-11-04: the promo lapsed,
  // the row went `hidden` in `?view=client`, and both the default catalog view
  // and the pricing page dropped it — the same retirement path
  // `minimax/minimax-m3.1-flash:free` took. The paid
  // `inclusionai/ling-3.1-flash-1019` graduation is priced normally and carries
  // no deal; the page instead publishes its boosted GOAT/Pro allowance, which
  // the vendored price table carries as `planAllowance`.
  // `minimax/minimax-m3.1-flash:free` (the 2026-10-20 dated launch promo, 100%
  // off through `2026-10-22T10:45Z`) left this map on 2026-10-23: the promo
  // lapsed, the row went `hidden` in `?view=client`, and it is gone from the
  // default catalog view, the pricing page and the models docs page — the same
  // retirement path `inclusionai/ling-3.1-flash:free` took. A dated promo only
  // needs its badge while the row is still served.
  // `xiaomi/mimo-v2.5` (98% off) and `xiaomi/mimo-v2.5-pro` (99% off) left this
  // map on the same check: MiMo V2.6 took over their rates as regular ones, both
  // rows went `hidden`, and the pricing page dropped the whole Xiaomi
  // collaboration block, so there is no deal left to display.
  // 2026-11-06 (command-code@1.88.4): the free Laguna S 2.1 row is RETIRED —
  // the npm CHANGELOG names "retire the free Laguna S 2.1 model", the row is
  // `hidden` in `?view=client`, and the models/pricing/plan pages plus the
  // pricing page's deal list no longer carry it — so the FREE entry is removed
  // rather than left to badge a model the catalog no longer serves (the same
  // path the MiniMax/Ornith/Ling free twins took). `isFreeModel()` therefore
  // stops ranking it, and `KNOWN_PLANS` dropped its plan entry in the same
  // check. `KNOWN_NON_ZDR_MODELS` keeps the id because both sources still serve
  // its `zdr:false` verdict; the generated output-limit table follows
  // `KNOWN_PLANS` and loses its row with it.
  // 2026-11-10 (catalog-only sync): the free Beam preview is RETIRED — the row
  // is `hidden` in `?view=client`, left the default catalog view, and the
  // pricing page (its deal list included), the models docs page and all four
  // plan pages dropped it — so the FREE entry is removed rather than left to
  // badge a model the catalog no longer serves (the same path the Laguna /
  // MiniMax / Ornith / Ling free twins took). `isFreeModel()` therefore stops
  // ranking it and `KNOWN_PLANS` lost its plan entry in the same check.
  // `KNOWN_NON_ZDR_MODELS` keeps the id because both sources still serve its
  // `zdr:false` verdict; retirement alone is not coverage evidence. The page
  // published it at a literal zero, so it never had a vendored price row.
  // `stealth/cat-jam:free` (`FREE`, the 2026-10-15 stealth preview) left this
  // map on 2026-10-20: the live catalog (both views), the pricing page and the
  // models docs page stopped serving the row, so there is no deal to display.
  // It stays in `KNOWN_NON_ZDR_MODELS` on artifact evidence alone — see the
  // decision record, chapter 7 item 13.
  // `inclusionai/ling-3.1-flash:free` (command-code@1.70.0, 100% off "Free
  // while it lasts", the `ling-3.0-flash-sante:free` successor) left this map
  // on 2026-10-15: command-code@1.82.2 ships the row as `hidden`, drops its
  // selectable efforts, and the model is gone from both
  // `/provider/v1/models` and the pricing page — the same retirement path
  // `meituan/LongCat-2.0:free` and `stealth/space-bunny-alpha` took. Its paid
  // graduation `inclusionai/ling-3.1-flash` is priced normally and carries no
  // deal.
  // `inclusionai/ling-3.0-flash-sante:free` followed it out on 2026-10-16 with
  // the 1.82.4 catalog migration: it had already left the live catalog and the
  // pricing page, and it is absent from the 1.82.4 artifact's embedded snapshot
  // as well, so no official source names it any more.
  // command-code@1.79.0 ("Add Glyph Cluster as a free model, 100 requests a
  // day"): 100% off "Free while the preview lasts", the same 100-requests-a-day
  // cap as its Ling predecessors and likewise no published end date, so no
  // `expiresAt`. The pricing page publishes it at a literal zero, which
  // `modelPriceTable()` serves from this deal, so it gets no row in the vendored
  // price table either. Unlike those free models it is NOT ZDR-routed — the
  // page's own tip says so outright (see `KNOWN_NON_ZDR_MODELS`).
  "stealth/glyph-cluster:free": { label: "FREE", free: true }
  // `ornith/ornith-1.5-122b:free` (the 2026-10-21 dated launch promo, 100% off
  // "until 11:00 PM PT on October 21" = `2026-10-22T06:00Z`) left this map on
  // 2026-10-23 for the same reason as its MiniMax sibling: the promo lapsed, the
  // row went `hidden` in `?view=client`, and the default catalog view, the
  // pricing page and the models docs page stopped serving it. The paid id stays
  // listed at $0.16/$0.64/$0.02 and carries no deal.
  // `stealth/space-bunny-alpha` (command-code@1.65.0, 100% off "Free while the
  // stealth preview lasts", auto-applied, no published end date) left this map
  // on 2026-10-06: command-code@1.74.3 hides the model, the catalog and the
  // pricing page dropped it, and the official Desktop changelog says "Remove
  // Space Bunny Alpha from the model picker". Its twin Pixel Canary left the
  // same way when command-code@1.73.1 retired it.
};
var KNOWN_PEAK_PRICING = /* @__PURE__ */ new Set([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  // command-code@1.53.0; the same `timeOfDay` block as the other three
  // (off-peak $0.15/$0.60, peak $0.30/$1.20, 01–04 & 06–10 UTC Mon–Fri).
  "deepseek/deepseek-v4.1-flash",
  // command-code@1.67.0; the same 01–04 & 06–10 UTC Mon–Fri windows and the same
  // 2026-08-16T16:00Z effective date, at its own rates (off-peak
  // $0.16/$0.58/$0.016, peak $0.32/$1.16/$0.032) — note these are NOT 2× the
  // sibling's, so this row must come from its own `timeOfDay` block.
  "deepseek/deepseek-v4.1-flash-fast"
]);
var PEAK_HOUR_RANGES = [
  [1, 4],
  [6, 10]
];
function isPeakPricingHour(now = Date.now()) {
  return peakHour(now, PEAK_HOUR_RANGES);
}
function peakPricingState(modelId, now = Date.now()) {
  if (!KNOWN_PEAK_PRICING.has(modelId)) return void 0;
  return isPeakPricingHour(now) ? "peak" : "off-peak";
}
function peakPricingLabel(modelId, now = Date.now()) {
  const state = peakPricingState(modelId, now);
  if (state === void 0) return void 0;
  return state === "peak" ? "Peak" : "Half";
}
function planLabel(modelId) {
  const plan = KNOWN_PLANS[modelId];
  return plan === void 0 ? void 0 : PLAN_LABELS[plan];
}
function dealLabel(modelId, now = Date.now()) {
  const deal = KNOWN_DEALS[modelId];
  if (deal === void 0) return void 0;
  if (deal.expiresAt !== void 0 && now >= Date.parse(deal.expiresAt)) return void 0;
  return deal.label;
}
var DEAL_BADGE_TEXT = {
  FREE: { en: "FREE", zh: "免费" },
  "50% off": { en: "50% off", zh: "5折" }
};
function dealBadgeText(label) {
  return DEAL_BADGE_TEXT[label] ?? label;
}
function modelBadge(modelId, now = Date.now()) {
  const label = dealLabel(modelId, now);
  if (label === void 0) return void 0;
  return { text: dealBadgeText(label), tone: "success" };
}
function formatContext(contextWindow) {
  if (contextWindow === void 0 || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return void 0;
  }
  if (contextWindow >= 1e6) {
    const m = contextWindow / 1e6;
    const rounded = Math.round(m * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}M`;
  }
  if (contextWindow < 1e3) return String(Math.floor(contextWindow));
  return `${Math.floor(contextWindow / 1e3)}K`;
}
function capabilityDescription(modelId, contextWindow, now = Date.now()) {
  const parts = [];
  const plan = planLabel(modelId);
  if (plan !== void 0) parts.push(plan);
  const deal = dealLabel(modelId, now);
  if (deal !== void 0) parts.push(deal);
  const peak = peakPricingLabel(modelId, now);
  if (peak !== void 0) parts.push(peak);
  if (KNOWN_IMAGE_MODELS.has(modelId)) parts.push("Image");
  const ctx = formatContext(contextWindow);
  if (ctx !== void 0) parts.push(ctx);
  return parts.join(" · ");
}

// src/model-prices.ts
var ALLOWANCE_TIERS = ["go", "goat", "pro"];
function allowanceTierForWeight(tierWeight) {
  if (tierWeight === void 0) return void 0;
  return ALLOWANCE_TIERS.find((tier) => PLAN_ORDER[tier] === tierWeight);
}
var MODEL_PRICE_ROWS = [
  { id: "claude-fable-5", rates: [10, 50, 1, 12.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-fable-5-1", rates: [10, 50, 0.25, 12.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-fable-5-2", rates: [8, 40, 0.2, 10], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-haiku-4-5", rates: [1, 5, 0.1, 1.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-haiku-5-5", rates: [0.1, 0.5, 0.01, 0.125], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 1e5, "rates": [0.1, 0.5, 0.01, 0.125] }, { "rates": [0.5, 2.5, 0.05, 0.625] }] },
  { id: "claude-opus-4-7", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-4-8", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-5", rates: [5, 25, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-opus-5-5", rates: [4, 20, 0.2, 5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-4-6", rates: [3, 15, 0.3, 3.75], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-5", rates: [2, 10, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "claude-sonnet-5-5", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 10, pro: 20 } },
  { id: "deepseek-v4-flash", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 6, goat: 60, pro: 70 } },
  { id: "deepseek-v4-flash-fast", rates: [0.28, 0.56, 0.07], allowance: { go: 8, goat: 20, pro: 30 } },
  { id: "deepseek-v4-flash-vision-exp", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "deepseek-v4-pro", rates: [0.66, 1.98, 0.022], peak: [1.32, 3.96, 0.044], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "deepseek-v4.1-flash", rates: [0.15, 0.6, 3e-3], peak: [0.3, 1.2, 6e-3], allowance: { go: 10, goat: 100, pro: 110 } },
  { id: "deepseek-v4.1-flash-fast", rates: [0.16, 0.58, 0.016], peak: [0.32, 1.16, 0.032], allowance: { go: 6, goat: 60, pro: 70 } },
  { id: "deepseek-v4.1-flash-ultrafast", rates: [2.4, 9.6, 0.048], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "fugu-ultra", rates: [5, 30, 0.5], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.1-flash-lite", rates: [0.25, 1.5, 0.03], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.5-flash", rates: [1.5, 9, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.5-flash-lite", rates: [0.3, 2.5, 0.03], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.6-flash", rates: [1.5, 7.5, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-3.7-flash", rates: [1.5, 7.5, 0.15, 0.08334], allowance: { go: 6, goat: 40, pro: 50 } },
  { id: "gemini-3.8-flash", rates: [1.5, 7.5, 0.15], allowance: { go: 6, goat: 40, pro: 50 } },
  { id: "gemini-4-argon", rates: [2, 10, 0.1], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gemini-4-carbon", rates: [2, 10, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5", rates: [1, 3.2, 0.2], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5.1", rates: [1.4, 4.4, 0.26], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "glm-5.2", rates: [1.4, 4.4, 0.26], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "glm-5.2-fast", rates: [3, 10.25, 0.5], allowance: { go: 9, goat: 20, pro: 30 } },
  { id: "glm-5.3", rates: [1.4, 4.4, 0.26], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "glm-5.3-flash", rates: [0.15, 0.5, 0.03], allowance: { go: 10, goat: 100, pro: 110 } },
  { id: "glm-5.3-flashx", rates: [0.37, 1.25, 0.075], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "gpt-5.3-codex", rates: [2, 8, 0.5, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.4", rates: [2.5, 15, 0.25, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.4-mini", rates: [0.75, 4.5, 0.075, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.5", rates: [5, 30, 0.5, 0], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "gpt-5.6-luna", rates: [0.2, 1.2, 0.02, 0.25], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [0.2, 1.2, 0.02, 0.25] }, { "rates": [0.4, 1.8, 0.04, 0.5] }] },
  { id: "gpt-5.6-sol", rates: [5, 30, 0.5, 6.25], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [5, 30, 0.5, 6.25] }, { "rates": [10, 45, 1, 12.5] }] },
  { id: "gpt-5.6-terra", rates: [2, 12, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 12, 0.2, 2.5] }, { "rates": [4, 18, 0.4, 5] }] },
  { id: "gpt-6-astra", rates: [10, 50, 1, 12.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [10, 50, 1, 12.5] }, { "rates": [20, 75, 2, 25] }] },
  { id: "gpt-6-luna", rates: [0.1, 0.5, 0.01, 0.125], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 272e3, "rates": [0.1, 0.5, 0.01, 0.125] }, { "rates": [0.2, 0.75, 0.02, 0.25] }] },
  { id: "gpt-6-sol", rates: [2, 10, 0.2, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.2, 2.5] }, { "rates": [4, 15, 0.4, 5] }] },
  { id: "gpt-6.1-sol", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.1, 2.5] }, { "rates": [4, 15, 0.2, 5] }] },
  { id: "gpt-6.1-terra", rates: [1, 5, 0.05, 1.25], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [1, 5, 0.05, 1.25] }, { "rates": [2, 7.5, 0.1, 2.5] }] },
  { id: "gpt-6.2-astra", rates: [8, 40, 0.4, 10], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [8, 40, 0.4, 10] }, { "rates": [16, 60, 0.8, 20] }] },
  { id: "gpt-6.2-sol", rates: [2, 10, 0.1, 2.5], allowance: { go: 6, goat: 20, pro: 20 }, contextTiers: [{ "maxContext": 272e3, "rates": [2, 10, 0.1, 2.5] }, { "rates": [4, 15, 0.2, 5] }] },
  { id: "grok-4.5", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "grok-4.6", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 2e5, "rates": [2, 6, 0.5] }, { "rates": [4, 12, 1] }] },
  { id: "grok-4.7", rates: [2, 6, 0.5], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 2e5, "rates": [2, 6, 0.5] }, { "rates": [4, 12, 1] }] },
  { id: "inkling", rates: [1, 4.05, 0.17], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "inkling-small", rates: [0.5, 1.2, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.5", rates: [0.6, 3, 0.1], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.6", rates: [0.95, 4, 0.16], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k2.7-code", rates: [0.95, 4, 0.19], allowance: { go: 9, goat: 60, pro: 70 } },
  { id: "kimi-k2.7-code-highspeed", rates: [1.9, 8, 0.38], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "kimi-k3", rates: [3, 15, 0.3], allowance: { go: 8, goat: 20, pro: 30 } },
  { id: "kimi-k3.1-pro", rates: [2, 10, 0.2], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "ling-3.1-flash", rates: [0.3, 0.9, 0.06], allowance: { go: 6, goat: 100, pro: 110 } },
  { id: "ling-3.1-flash-1019", rates: [0.3, 0.9, 0.06], allowance: { go: 6, goat: 100, pro: 110 } },
  { id: "longcat-2.0", rates: [0.3, 1.2, 6e-3], allowance: { go: 10, goat: 50, pro: 60 } },
  { id: "mimo-v2.6-flash", rates: [0.14, 0.28, 28e-4], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mimo-v2.6-pro", rates: [0.435, 0.87, 36e-4], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mimo-v2.6-pro-ultraspeed", rates: [4.35, 8.7, 0.036], allowance: { go: 6, goat: 10, pro: 20 } },
  { id: "minimax-m2.5", rates: [0.3, 1.2, 0.03], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "minimax-m2.7", rates: [0.3, 1.2, 0.06], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "minimax-m3", rates: [0.3, 1.2, 0.06], listRates: [0.6, 2.4, 0.12], allowance: { go: 8, goat: 47, pro: 57 } },
  { id: "minimax-m3.1-flash", rates: [0.15, 0.6, 0.015], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "mistral-large-4", rates: [1.36, 4.18, 0.14], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-ember", rates: [0.1, 0.5, 4e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.1", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "muse-spark-1.2", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.2-contributor", rates: [0.1, 0.2, 2e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.3", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-1.3-contributor", rates: [0.1, 0.2, 2e-3], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-spark-open", rates: [1.25, 4.25, 0.15], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "muse-wonder-1.0", rates: [4, 20, 0.2], allowance: { go: 6, goat: 20, pro: 20 } },
  { id: "nemotron-3-ultra", rates: [0.6, 2.4, 0.12], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "nemotron-3.5-super-vl", rates: [0.2, 0.5, 0.04], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "ornith-1.5-122b", rates: [0.16, 0.64, 0.02], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.6-max", rates: [1.3, 7.8, 0.26, 1.63], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.6-plus", rates: [0.5, 3, 0.1], allowance: { go: 10, goat: 33, pro: 43 }, contextTiers: [{ "maxContext": 256e3, "rates": [0.5, 3, 0.1] }, { "rates": [2, 6, 0.2] }] },
  { id: "qwen-3.7-flash", rates: [0.03, 0.13, 6e-3, 0.038], allowance: { go: 6, goat: 20, pro: 30 }, contextTiers: [{ "maxContext": 32e3, "rates": [0.03, 0.13, 6e-3, 0.038] }, { "maxContext": 256e3, "rates": [0.1, 0.4, 0.02, 0.125] }, { "rates": [0.2, 0.8, 0.04, 0.25] }] },
  { id: "qwen-3.7-max", rates: [2.5, 7.5, 0.5, 3.13], allowance: { go: 10, goat: 33, pro: 43 } },
  { id: "qwen-3.7-plus", rates: [0.4, 1.6, 0.08, 0.5], allowance: { go: 10, goat: 33, pro: 43 }, contextTiers: [{ "maxContext": 256e3, "rates": [0.4, 1.6, 0.08, 0.5] }, { "rates": [1.2, 4.8, 0.24, 1.5] }] },
  { id: "qwen-3.8-27b", rates: [0.4, 3, 0.04], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "qwen-3.8-flash", rates: [0.16, 0.47, 0.016], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max", rates: [2, 6, 0.25, 2.5], allowance: { go: 7, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max-0902", rates: [2, 6, 0.25], allowance: { go: 7, goat: 20, pro: 30 } },
  { id: "qwen-3.8-max-prime", rates: [4, 12, 0.5, 5], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-3.8-omni-flash", rates: [0.15, 0.47, 0.016], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "qwen-4-max", rates: [1.5, 4.5, 0.075, 1.875], allowance: { go: 6, goat: 15, pro: 25 } },
  { id: "step-3.5-flash", rates: [0.09, 0.3, 0.02], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "step-3.7-flash", rates: [0.2, 1.15, 0.04], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "step-5-preview", rates: [1, 2.7, 0.05], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "tencent/hy3-paid", rates: [0.14, 0.58, 0.035], allowance: { go: 10, goat: 70, pro: 80 } },
  { id: "tencent/hy4", rates: [0.834, 2.501, 0.042], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "tencent/hy4-flash", rates: [0.07, 0.281, 3e-3], allowance: { go: 6, goat: 15, pro: 25 } },
  { id: "tencent/hy4-preview", rates: [0.834, 2.501, 0.042], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "typesafe/jev", rates: [0.042, 0, 0], allowance: { go: 6, goat: 20, pro: 30 } },
  { id: "typesafe/jev-1.14.0", rates: [0.042, 0, 0], allowance: { go: 6, goat: 20, pro: 30 } }
];
var ROWS_BY_SLUG = new Map(
  MODEL_PRICE_ROWS.map((row) => [row.id, row])
);
var KNOWN_SLUGS = new Set(ROWS_BY_SLUG.keys());

// src/request-timing.ts
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
var REQUEST_TIMING_ENV = "DSH_COMMANDCODE_TIMING";
var RequestTiming = class {
  constructor(model, sink, now = () => performance.now()) {
    this.sink = sink;
    this.now = now;
    this.started = now();
    this.summary = {
      version: 1,
      startedAt: Date.now(),
      model,
      outcome: "cancelled",
      totalMs: 0,
      phasesMs: { credentials: 0, images: 0, body: 0, serialization: 0, headers: 0 },
      attempts: []
    };
  }
  sink;
  now;
  started;
  summary;
  /** 返回结束函数，确保成功和异常都计入同一阶段。阶段可嵌套，不能直接相加。 */
  phase(name) {
    if (!this.sink) return () => {
    };
    const start = this.now();
    return () => {
      this.summary.phasesMs[name] += this.now() - start;
    };
  }
  attempt(protocol, bodyBytes) {
    if (!this.sink) return () => {
    };
    const start = this.now();
    const attempt = { protocol, bodyBytes, headersMs: 0 };
    this.summary.attempts.push(attempt);
    return (status) => {
      Object.assign(attempt, { headersMs: this.now() - start, ...status === void 0 ? {} : { status } });
      this.summary.phasesMs.headers += attempt.headersMs;
    };
  }
  first(kind) {
    if (this.sink && this.summary[kind] === void 0) this.summary[kind] = this.now() - this.started;
  }
  async close(outcome, errorCode) {
    if (!this.sink) return;
    this.summary.outcome = outcome;
    this.summary.totalMs = this.now() - this.started;
    if (errorCode !== void 0) this.summary.errorCode = errorCode;
    try {
      await this.sink(this.summary);
    } catch {
    }
  }
};
function openRequestTiming(model, sink) {
  if (sink) return new RequestTiming(model, sink);
  const raw = process.env[REQUEST_TIMING_ENV]?.trim();
  if (!raw || ["0", "false", "no", "off"].includes(raw.toLowerCase())) return new RequestTiming(model);
  const path = ["1", "true", "yes", "on"].includes(raw.toLowerCase()) ? join(tmpdir(), "dsh-commandcode-timing.jsonl") : raw;
  return new RequestTiming(model, async (summary) => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(summary)}
`, { mode: 384 });
  });
}

// src/gateway-facts.ts
import { mkdir as mkdir2, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { LlmError as LlmError5 } from "../commandcode-host-llm.js";
var DEFAULT_MAX_OUTPUT_TOKENS = 131072;
var MODEL_CATALOG_TTL_MS = 5 * 6e4;
var MODEL_CATALOG_RETRY_MS = 1e4;
var MODEL_CACHE_VERSION = 3;
var learned = /* @__PURE__ */ new Map();
var published = /* @__PURE__ */ new Map();
var generations = /* @__PURE__ */ new Map();
var validLimit = (value) => value !== void 0 && Number.isSafeInteger(value) && value > 0;
var fallbackLimit = (model) => MODEL_OUTPUT_TOKEN_LIMITS.get(model) ?? (requiresMessagesEndpoint(model) ? DEFAULT_MESSAGES_MAX_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS);
function learnedOutputLimit(apiBase, model) {
  return learned.get(apiBase)?.get(model) ?? Infinity;
}
function modelOutputTokenLimit(apiBase, model) {
  return Math.min(published.get(apiBase)?.get(model) ?? fallbackLimit(model), learnedOutputLimit(apiBase, model));
}
function catalogModelMaxTokens(apiBase, model, contextWindow = model.contextWindow) {
  return Math.min(contextWindow, model.publishedMaxTokens ?? fallbackLimit(model.id), learnedOutputLimit(apiBase, model.id));
}
function outputCeilingRefusal(apiBase, model, sent, error) {
  if (!(error instanceof LlmError5) || !OUTPUT_LIMIT_REJECTION.test(error.message)) return void 0;
  const stated = parseOutputCeiling(error.message);
  if (!validLimit(stated) || stated >= sent) return void 0;
  let limits = learned.get(apiBase);
  if (limits === void 0) learned.set(apiBase, limits = /* @__PURE__ */ new Map());
  const next = Math.min(stated, learnedOutputLimit(apiBase, model));
  limits.set(model, next);
  return next;
}
function normalizeModel(raw, apiBase, disk) {
  if (!isRecord(raw)) return void 0;
  const id = stringValue(raw.id), name = stringValue(raw.name);
  const contextWindow = numberValue(disk ? raw.contextWindow : raw.context_length);
  if (!id || !name || contextWindow === void 0 || !Number.isFinite(contextWindow) || contextWindow <= 0) return void 0;
  const limit = numberValue(disk ? raw.publishedMaxTokens : raw.max_output_tokens);
  const endpoints = disk ? raw.supportedEndpoints : raw.supported_endpoints;
  return {
    id,
    name,
    contextWindow,
    image: typeof raw.image === "boolean" ? raw.image : void 0,
    reasoningEfforts: Array.isArray(raw.reasoningEfforts) ? raw.reasoningEfforts.filter((e) => typeof e === "string").slice(0, 12) : void 0,
    minimumPlan: stringValue(raw.minimumPlan),
    deal: stringValue(raw.deal),
    maxTokens: Math.min(contextWindow, validLimit(limit) ? limit : fallbackLimit(id), learnedOutputLimit(apiBase, id)),
    ...validLimit(limit) ? { publishedMaxTokens: limit } : {},
    supportedEndpoints: Array.isArray(endpoints) ? endpoints.filter((item) => typeof item === "string") : []
  };
}
function parseCatalog(value, apiBase) {
  if (!isRecord(value) || value.object !== "list" || !Array.isArray(value.data)) throw providerError("Unexpected Command Code models response shape", "PROVIDER_PROTOCOL_ERROR");
  const rows = value.data.map((raw) => normalizeModel(raw, apiBase, false)).filter((row) => row !== void 0);
  if (rows.length === 0) throw providerError("Command Code returned an empty model catalog", "PROVIDER_PROTOCOL_ERROR");
  return rows;
}
async function readCache(source) {
  const value = JSON.parse(await readFile(source.modelsCachePath, "utf8"));
  if (!isRecord(value) || value.version !== MODEL_CACHE_VERSION || value.apiBase !== source.apiBase || !Array.isArray(value.models)) throw new Error("Invalid model cache source");
  const rows = value.models.map((raw) => normalizeModel(raw, source.apiBase, true)).filter((row) => row !== void 0);
  if (rows.length === 0) throw new Error("Empty model cache");
  return rows;
}
function publish(apiBase, rows) {
  published.set(apiBase, new Map(rows.flatMap((row) => row.publishedMaxTokens === void 0 ? [] : [[row.id, row.publishedMaxTokens]])));
}
async function writeCache(source, rows, mayCommit) {
  await mkdir2(dirname2(source.modelsCachePath), { recursive: true });
  const temp = `${source.modelsCachePath}.${process.pid}.${randomUUID2()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify({ version: MODEL_CACHE_VERSION, apiBase: source.apiBase, models: rows }, null, 2)}
`, { encoding: "utf8", mode: 384 });
    if (mayCommit()) await rename(temp, source.modelsCachePath);
  } finally {
    await rm(temp, { force: true }).catch(() => void 0);
  }
}
function copyRows(rows) {
  return rows.map((row) => ({ ...row, supportedEndpoints: [...row.supportedEndpoints] }));
}
var GatewayFacts = class {
  constructor(fetchCatalog) {
    this.fetchCatalog = fetchCatalog;
  }
  fetchCatalog;
  state;
  forSource(source) {
    const identity = JSON.stringify([source.apiBase, source.modelsCachePath]);
    if (this.state?.source !== identity) this.state = { source: identity, rows: [], expiresAt: 0, origin: "none" };
    return this.state;
  }
  /** 模型解析保持原有热目录直读；不把生成的磁盘冷读取推广到其他入口。 */
  knownModel(source, model) {
    const row = this.forSource(source).rows.find((candidate) => candidate.id === model);
    return row === void 0 ? void 0 : copyRows([row])[0];
  }
  /**
   * 本进程**联网成功过**的目录；否则返回 undefined。
   *
   * 判据是来源而不是「内存里有行」：`snapshot()` 会把磁盘缓存写进同一份
   * `state.rows`（生成路径需要它），若只看行数，冷启动先发过一次聊天再打开
   * 选择器时，首屏拿到的就是没有年龄校验的磁盘副本——正是本方法要排除的东西。
   * 空目录同样返回 undefined：刷新失败后的空行（`expiresAt` 已进入重试窗口）
   * 不能让选择器把「暂时读不到」画成「没有模型」，调用方应回落到 `refresh()`。
   */
  loaded(source) {
    const state = this.forSource(source);
    if (state.origin !== "network" || state.rows.length === 0) return void 0;
    return copyRows(state.rows);
  }
  /** 生成只读取本地目录；捕获状态后不再转向实例的新来源。 */
  async snapshot(source) {
    const state = this.forSource(source);
    if (state.rows.length > 0 || state.expiresAt > 0) return copyRows(state.rows);
    state.disk ??= readCache(source).catch(() => []);
    const rows = await state.disk;
    if (state.rows.length > 0 || state.expiresAt > 0) return copyRows(state.rows);
    if (state.inflight === void 0) {
      state.rows = rows;
      if (rows.length > 0 && state.origin === "none") state.origin = "disk";
    }
    return copyRows(rows);
  }
  async refresh(source, signal, force = false) {
    signal?.throwIfAborted();
    const state = this.forSource(source);
    if (!force && Date.now() < state.expiresAt) return copyRows(state.rows);
    if (state.inflight === void 0) {
      const generation = (generations.get(source.apiBase) ?? 0) + 1;
      generations.set(source.apiBase, generation);
      const mayPublish = () => this.state === state && generations.get(source.apiBase) === generation;
      state.inflight = (async () => {
        let rows2, ttl = MODEL_CATALOG_TTL_MS;
        let network = false;
        try {
          rows2 = parseCatalog(await this.fetchCatalog(source), source.apiBase);
          network = true;
          if (mayPublish()) {
            publish(source.apiBase, rows2);
            await writeCache(source, rows2, mayPublish).catch(() => void 0);
          }
        } catch {
          ttl = MODEL_CATALOG_RETRY_MS;
          rows2 = state.rows.length > 0 ? state.rows : await readCache(source).catch(() => []);
          if (mayPublish() && !published.has(source.apiBase) && rows2.length > 0) publish(source.apiBase, rows2);
        }
        state.rows = rows2;
        state.expiresAt = Date.now() + ttl;
        if (network) state.origin = "network";
        else if (state.origin === "none" && rows2.length > 0) state.origin = "disk";
        return rows2;
      })().finally(() => {
        delete state.inflight;
      });
    }
    const inflight = state.inflight;
    if (!signal) return copyRows(await inflight);
    const rows = await new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      inflight.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    });
    return copyRows(rows);
  }
};

// src/adapter.ts
var COMMAND_CODE_CLI_VERSION = "1.89.3";
var DEFAULT_GENERATE_MAX_TOKENS = MAX_OUTPUT_TOKEN_LIMIT;
var MODELS_TIMEOUT_MS = 1e4;
var BILLING_ACCESS_TTL_MS = 5 * 6e4;
var ACCOUNT_FACTS_TTL_MS = 3e4;
var ACCOUNT_ENDPOINT_RETRY_DELAY_MS = 500;
var PROTOCOL_CACHE_TTL_MS = 15 * 6e4;
var GO_TIER_WEIGHT = 0;
var MAX_ACCOUNT_ROTATIONS = 16;
var ACTIVE_SUBSCRIPTION_STATUSES = /* @__PURE__ */ new Set(["active", "trialing", "past_due"]);
var LONE_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
var ANY_SURROGATE_PATTERN = /[\uD800-\uDFFF]/;
function sanitizeSurrogates(value) {
  if (typeof value !== "string") return value;
  return ANY_SURROGATE_PATTERN.test(value) ? value.replace(LONE_SURROGATE_PATTERN, "") : value;
}
function fingerprintValue(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value) ?? String(value);
  } catch {
    serialized = String(value);
  }
  return {
    bytes: Buffer.byteLength(serialized),
    sha256: sha256Hex(serialized)
  };
}
function sha256Hex(serialized) {
  return createHash("sha256").update(serialized).digest("hex");
}
function requestFingerprint(protocol, body) {
  const params = protocol === "cli" ? recordOrEmpty(body.params) : body;
  const messages = Array.isArray(params.messages) ? params.messages : [];
  const tools = Array.isArray(params.tools) ? params.tools : [];
  return {
    protocol,
    model: typeof params.model === "string" ? params.model : void 0,
    threadId: typeof body.threadId === "string" ? body.threadId : void 0,
    body: fingerprintValue(body),
    config: fingerprintValue(body.config),
    system: fingerprintValue(protocol === "cli" ? params.system : messages.filter((m) => isRecord(m) && m.role === "system")),
    tools: {
      count: tools.length,
      ...fingerprintValue(tools)
    },
    messages: {
      count: messages.length,
      roles: messages.map((message) => isRecord(message) && typeof message.role === "string" ? message.role : "unknown"),
      ...fingerprintValue(messages),
      // Whole-history hashes change on every append. Per-message hashes let
      // adjacent requests identify the first changed byte-bearing message.
      items: messages.map((message) => fingerprintValue(message))
    }
  };
}
function periodTimestampValue(value) {
  const asNumber = numberValue(value);
  if (asNumber !== void 0) return asNumber;
  const asString = stringValue(value);
  if (asString === void 0) return 0;
  const parsed = Date.parse(asString);
  return Number.isNaN(parsed) ? 0 : parsed;
}
function isRequestTimeout(error) {
  return error instanceof Error && error.name === "TimeoutError";
}
function accountRetryDelay() {
  return new Promise((resolve) => setTimeout(resolve, ACCOUNT_ENDPOINT_RETRY_DELAY_MS));
}
var MIN_SUGGESTED_TIMEOUT_MS = 3e5;
function headersTimeoutAdvice(protocol, timeoutMs) {
  if (protocol === "openai") {
    const suggestionMs = Math.min(MAX_TIMEOUT_SECONDS * 1e3, Math.max(timeoutMs * 2, MIN_SUGGESTED_TIMEOUT_MS));
    return {
      cause: "upstream-first-token",
      // That route charges the upstream's time-to-first-token to this wait, so
      // a larger budget is the one thing that can help when it expires.
      ...suggestionMs > timeoutMs ? { suggestionMs } : {}
    };
  }
  return { cause: "gateway" };
}
var MAX_CONSECUTIVE_HEADER_TIMEOUTS = 3;
var GLOBAL_HEADER_TIMEOUT_KEY = "\0global";
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).length;
}
function headersTimeoutError(input) {
  const { protocol, endpoint, timeoutMs, cause } = input;
  const bytes = utf8ByteLength(input.body);
  const megabytes = `${(bytes / 1048576).toFixed(1)} MB`;
  const advice = headersTimeoutAdvice(protocol, timeoutMs);
  if (advice.cause === "upstream-first-token") {
    const suggestion = advice.suggestionMs ?? timeoutMs;
    return bilingual(
      "TIMEOUT",
      `Command Code API request to ${endpoint} did not respond within ${timeoutMs}ms: this route withholds response headers until the upstream model emits its first token, and it did not start within the budget. Raise "Request timeout" in the plugin's advanced settings to ${suggestion}ms, or compact the session or start a new one. The request body was ${megabytes}, but size is not the cause here — a slow upstream is. ${errorChain2(cause)}`,
      `Command Code API 请求在 ${timeoutMs} 毫秒内未收到响应：该路由要等上游模型吐出第一个 token 才返回响应头，而上游在预算内没有开始作答。可在插件「高级」设置里把「请求超时」调到 ${suggestion} 毫秒，或压缩上下文 / 新开会话。本次请求体约 ${megabytes}，但体积不是原因——慢的是上游。（${errorChain2(cause)}）`,
      { cause }
    );
  }
  return bilingual(
    "TIMEOUT",
    `Command Code API request to ${endpoint} did not respond within ${timeoutMs}ms: the gateway returned no response headers at all — it answers headers itself before the model replies. This is usually provider queueing, a Go-plan capacity limit, or a network/proxy path problem; a longer timeout will not help, but retrying usually recovers. The request body was ${megabytes}, and size is not the cause on this route. ${errorChain2(cause)}`,
    `Command Code API 请求在 ${timeoutMs} 毫秒内未收到响应：网关完全没有返回响应头——它会在模型开始回答前先返回响应头。这通常是服务商排队、Go 套餐容量限制，或网络/代理链路问题；调大超时不会有帮助，重试通常可恢复。本次请求体约 ${megabytes}，而在该路由上体积不是原因。（${errorChain2(cause)}）`,
    { cause }
  );
}
var SCHEMA_NORMALIZE_MAX_DEPTH = 4;
var TOOL_SCHEMA_CACHE = /* @__PURE__ */ new WeakMap();
function isObjectShaped(node) {
  return isRecord(node.properties) || isRecord(node.patternProperties) || Array.isArray(node.required) || node.additionalProperties !== void 0;
}
function requiredNames(node) {
  return Array.isArray(node.required) ? node.required.filter((name) => typeof name === "string") : [];
}
function resolveLocalRef(root, ref) {
  if (!ref.startsWith("#/")) return void 0;
  let node = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(node)) return void 0;
    node = node[segment];
  }
  return isRecord(node) ? node : void 0;
}
function mergeCombinatorBranches(node, depth) {
  if (depth >= SCHEMA_NORMALIZE_MAX_DEPTH) return void 0;
  const properties = {};
  const required = /* @__PURE__ */ new Set();
  const alternatives = [];
  let sawBranch = false;
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    const branches = node[key];
    if (!Array.isArray(branches)) continue;
    const objectBranches = [];
    for (const branch of branches) {
      if (!isRecord(branch)) continue;
      objectBranches.push(normalizeToolParameters(branch, depth + 1));
    }
    if (objectBranches.length === 0) continue;
    sawBranch = true;
    const names = objectBranches.map(requiredNames);
    if (key === "allOf") for (const name of names.flat()) required.add(name);
    else if (names.length > 0) {
      alternatives.push(names[0].filter((name) => names.every((list) => list.includes(name))));
    }
    for (const branch of objectBranches) {
      const branchProperties = isRecord(branch.properties) ? branch.properties : {};
      for (const [name, schema] of Object.entries(branchProperties)) {
        if (!(name in properties)) properties[name] = schema;
      }
    }
  }
  if (!sawBranch) return void 0;
  for (const group of alternatives) for (const name of group) required.add(name);
  const merged = { type: "object", properties };
  if (required.size > 0) merged.required = [...required];
  if (node.additionalProperties !== void 0) merged.additionalProperties = node.additionalProperties;
  for (const key of ["description", "title"]) {
    if (node[key] !== void 0) merged[key] = node[key];
  }
  return merged;
}
function toolParametersSchema(parameters) {
  if (!isRecord(parameters)) return normalizeToolParameters(parameters, 0);
  const cached = TOOL_SCHEMA_CACHE.get(parameters);
  if (cached !== void 0) return cached;
  const normalized = normalizeToolParameters(parameters, 0);
  TOOL_SCHEMA_CACHE.set(parameters, normalized);
  return normalized;
}
function normalizeToolParameters(parameters, depth) {
  if (!isRecord(parameters)) return { type: "object", properties: {}, additionalProperties: true };
  if (parameters.type === "object") return parameters;
  if (Array.isArray(parameters.type) && parameters.type.includes("object")) {
    return { ...parameters, type: "object" };
  }
  if (parameters.type === void 0 || parameters.type === null) {
    if (typeof parameters.$ref === "string" && depth < SCHEMA_NORMALIZE_MAX_DEPTH) {
      const target = resolveLocalRef(parameters, parameters.$ref);
      if (target !== void 0) {
        const { $ref: _ref, ...rest } = parameters;
        return normalizeToolParameters({ ...target, ...rest }, depth + 1);
      }
    }
    if (isObjectShaped(parameters)) return { ...parameters, type: "object" };
    const merged = mergeCombinatorBranches(parameters, depth);
    if (merged !== void 0) return merged;
    if (typeof parameters.$ref === "string") return { ...parameters, type: "object" };
  }
  return { type: "object", properties: {}, additionalProperties: true };
}
function projectSlugFromPath(pathName) {
  const slug = pathName.toLowerCase().replace(/^[a-z]:/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|(?<!-)-+$/g, "");
  return slug || "project";
}
function toolResultOf(message) {
  if (message.role !== "tool") return void 0;
  const { toolCallId, content } = message;
  if (typeof toolCallId !== "string" || toolCallId === "") return void 0;
  return { toolCallId, isError: message.isError ?? false, content };
}
function pairedToolCalls(messages) {
  const callIds = /* @__PURE__ */ new Set();
  const names = /* @__PURE__ */ new Map();
  const resultIds = /* @__PURE__ */ new Set();
  for (const message of messages) {
    const result = toolResultOf(message);
    if (result) resultIds.add(result.toolCallId);
    for (const block of message.content) {
      if (message.role === "assistant" && block.type === "tool-call") {
        callIds.add(block.id);
        names.set(block.id, block.name);
      }
    }
  }
  return { ids: new Set([...callIds].filter((id) => resultIds.has(id))), names };
}
var MAX_WIRE_TOOL_CALL_ID_LENGTH = 64;
function wireToolCallIds(paired) {
  const wire = /* @__PURE__ */ new Map();
  const taken = /* @__PURE__ */ new Set();
  for (const id of paired) {
    if (id.length <= MAX_WIRE_TOOL_CALL_ID_LENGTH) {
      wire.set(id, id);
      taken.add(id);
    }
  }
  let seq = 1;
  for (const id of paired) {
    if (wire.has(id)) continue;
    let alias = `cc-${seq++}`;
    while (taken.has(alias)) alias = `cc-${seq++}`;
    wire.set(id, alias);
    taken.add(alias);
  }
  return wire;
}
function blockText(block) {
  return block.type === "text" || block.type === "reasoning" ? block.text : "";
}
function toolResultMedia(block) {
  const chunks = [];
  const images = [];
  const seen = /* @__PURE__ */ new Set();
  for (const nested of block.content) {
    if (nested.type === "text" || nested.type === "reasoning") {
      if (nested.text) chunks.push(nested.text);
      continue;
    }
    if (nested.type === "image" && !seen.has(nested.attachment.attachmentId)) {
      seen.add(nested.attachment.attachmentId);
      images.push(nested.attachment);
    }
  }
  return { text: chunks.join("\n"), images };
}
function toolResultTextForWire(media) {
  return media.text || (media.images.length > 0 ? "(image returned; see the attached image)" : "");
}
var TOOL_RESULT_IMAGE_TEXT = "Attached image(s) from tool result";
function toolResultImageNote(media, toolCallId) {
  const lead = `${TOOL_RESULT_IMAGE_TEXT} (${toolCallId}):`;
  const first = media.images[0];
  if (first === void 0) return lead;
  const dimensions = `${first.width}x${first.height} px`;
  if (first.width <= 0 || first.height <= 0 || media.text.includes(dimensions)) {
    return lead;
  }
  const count = media.images.length > 1 ? `${media.images.length} images, ` : "";
  return `${lead} ${count}${dimensions}`;
}
function hasImageContent(message) {
  return message.content.some((block) => block.type === "image");
}
var REQUEST_IMAGE_MAX_BASE64_BYTES = 32 * 1024 * 1024;
var REQUEST_IMAGE_MAX_COUNT = 60;
var REQUEST_IMAGE_BYTE_QUANTUM = 16 * 1024 * 1024;
var REQUEST_IMAGE_COUNT_QUANTUM = 30;
var REQUEST_IMAGE_RETRY_MAX_BASE64_BYTES = 8 * 1024 * 1024;
var REQUEST_IMAGE_RETRY_MAX_COUNT = 12;
var REQUEST_IMAGE_RETRY_BYTE_QUANTUM = 8 * 1024 * 1024;
var REQUEST_IMAGE_RETRY_COUNT_QUANTUM = 12;
var REQUEST_IMAGE_BUDGETS = [
  {
    maxBytes: REQUEST_IMAGE_MAX_BASE64_BYTES,
    maxImages: REQUEST_IMAGE_MAX_COUNT,
    byteQuantum: REQUEST_IMAGE_BYTE_QUANTUM,
    countQuantum: REQUEST_IMAGE_COUNT_QUANTUM
  },
  {
    maxBytes: REQUEST_IMAGE_RETRY_MAX_BASE64_BYTES,
    maxImages: REQUEST_IMAGE_RETRY_MAX_COUNT,
    byteQuantum: REQUEST_IMAGE_RETRY_BYTE_QUANTUM,
    countQuantum: REQUEST_IMAGE_RETRY_COUNT_QUANTUM
  }
];
var ENGINE_IMAGE_POLICY = { projectOffloadedImages, requiredImageOffload };
function imageOffloadRequired(missing, reason = "budget") {
  const options = { offloadImages: missing };
  return new LlmError6(
    reason === "cache" ? `commandcode cache-aware image history: ${missing} already-seen oldest image occurrence(s) must be offloaded before replay.` : `commandcode request images exceed the route budget; ${missing} more oldest occurrence(s) must be offloaded.`,
    IMAGE_OFFLOAD_REQUIRED_CODE,
    options
  );
}
function coreBudget(budget) {
  return { representation: "base64", ...budget };
}
var imageVersionBytes = (block) => block.attachment.bytes;
function projectSurfaceBudget(options, policy, budget) {
  const marked = policy.projectOffloadedImages(options.messages, (ref) => offloadedImageText(ref));
  const messages = marked === options.messages ? options.messages : [...marked];
  return {
    options: messages === options.messages ? options : { ...options, messages },
    budgetMissing: policy.requiredImageOffload(messages, coreBudget(budget), imageVersionBytes)
  };
}
function withSurfaceOffload(options, policy, budget, cacheOffloadModel) {
  const projected = projectSurfaceBudget(options, policy, budget);
  const cacheMissing = cacheOffloadModel === void 0 ? 0 : seenImageOffloadCount(projected.options.messages, cacheOffloadModel);
  const missing = Math.max(projected.budgetMissing, cacheMissing);
  if (missing > 0) throw imageOffloadRequired(missing, cacheMissing > projected.budgetMissing ? "cache" : "budget");
  return projected.options;
}
function seenImageOffloadCount(messages, model) {
  let lastAnswer = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "assistant" && message.source.kind === "model" && message.source.provider === "commandcode" && message.source.model === model) lastAnswer = index;
  }
  if (lastAnswer < 0) return 0;
  let count = 0;
  for (let index = 0; index < lastAnswer; index++) {
    const message = messages[index];
    if (message.role !== "user" && message.role !== "tool" || message.id === void 0) continue;
    for (const block of message.content) {
      if (block.type === "image") count++;
    }
  }
  return count;
}
async function readRequestImage(attachments, ref) {
  return attachments.readImageRequest(ref, requestImageTarget(ref));
}
function requestImages(attachments, signal, timing) {
  const cache = /* @__PURE__ */ new Map();
  const read = (ref) => {
    signal?.throwIfAborted();
    const key = JSON.stringify([ref.attachmentId, requestImageTarget(ref)]);
    let pending = cache.get(key);
    if (!pending) {
      pending = readRequestImage(attachments, ref);
      cache.set(key, pending);
    }
    return pending;
  };
  read.prepare = async (refs) => {
    if (refs.length === 0) return;
    const finishImages = timing.phase("images");
    let cursor = 0;
    try {
      const workers = Array.from({ length: Math.min(4, refs.length) }, async () => {
        while (cursor < refs.length) {
          signal?.throwIfAborted();
          await read(refs[cursor++]);
        }
      });
      const results = await Promise.allSettled(workers);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    } finally {
      finishImages();
    }
  };
  return read;
}
function priceRequestImage(block, model, imageCapable) {
  const ref = block.attachment;
  if (!imageCapable) return { visualTokens: 0, text: textOnlyImageText(ref) };
  if (block.offloaded === true) return { visualTokens: 0, text: offloadedImageText(ref) };
  const target = requestImageTarget(ref);
  return { visualTokens: commandCodeImageTokens(model, target.width, target.height), text: "" };
}
var encodedRequestImages = /* @__PURE__ */ new WeakMap();
function encodedRequestImage(version) {
  let encoded = encodedRequestImages.get(version);
  if (encoded === void 0) {
    const base64 = Buffer.from(version.data).toString("base64");
    encoded = { base64, dataUrl: `data:${version.mediaType};base64,${base64}` };
    encodedRequestImages.set(version, encoded);
  }
  return encoded;
}
async function imageToCommandCode(ref, readImage) {
  const version = await readImage(ref);
  return {
    type: "image",
    image: encodedRequestImage(version).dataUrl,
    mimeType: version.mediaType
  };
}
function messagesSignatureAt(message, position) {
  const replay = message.source?.replayState;
  if (!isRecord(replay) || !Array.isArray(replay.blocks)) return void 0;
  const entry = replay.blocks[position];
  return isRecord(entry) ? stringValue(entry.signature) : void 0;
}
async function convertMessages(messages, readImage, codec) {
  const out = [];
  const { ids: paired, names: toolNames } = pairedToolCalls(messages);
  if (readImage?.prepare) {
    const refs = [];
    for (const message of messages) {
      const result = toolResultOf(message);
      if (message.role === "user" && !result) {
        for (const block of message.content) if (block.type === "image") refs.push(block.attachment);
      } else if (result && paired.has(result.toolCallId)) refs.push(...toolResultMedia(result).images);
    }
    await readImage.prepare(refs);
  }
  const wireIds = wireToolCallIds(paired);
  const pendingImages = [];
  const flushPendingImages = () => {
    for (const message of pendingImages) out.push(message);
    pendingImages.length = 0;
  };
  const encodeImage = (ref) => {
    if (!readImage) {
      throw new LlmError6("Image input requires the durable attachment service", "UNSUPPORTED_CONTENT");
    }
    return codec.encodeImage(ref, readImage);
  };
  for (const message of messages) {
    if (message.role === "system") continue;
    const result = toolResultOf(message);
    if (message.role === "user" && !result) {
      flushPendingImages();
      const parts = [];
      for (const block of message.content) {
        if (block.type === "text") parts.push({ type: "text", text: block.text });
        if (block.type === "image") parts.push(await encodeImage(block.attachment));
      }
      if (parts.length > 0) out.push(codec.encodeUser(parts));
      continue;
    }
    if (message.role === "assistant") {
      flushPendingImages();
      const assistant = codec.encodeAssistant(message, paired, wireIds);
      if (assistant !== void 0) out.push(assistant);
      continue;
    }
    if (!result || !paired.has(result.toolCallId)) continue;
    const media = toolResultMedia(result);
    const wireId = wireIds.get(result.toolCallId) ?? result.toolCallId;
    out.push(await codec.encodeTool(result, media, wireId, toolNames.get(result.toolCallId) || "unknown", readImage));
    if (!codec.carriesToolResultMedia && media.images.length > 0) {
      const carried = [{ type: "text", text: toolResultImageNote(media, wireId) }];
      for (const attachment of media.images) carried.push(await encodeImage(attachment));
      pendingImages.push(codec.encodeUser(carried));
    }
  }
  flushPendingImages();
  return out;
}
var ccMessageCodec = {
  carriesToolResultMedia: false,
  encodeImage: imageToCommandCode,
  encodeUser: (parts) => ({ role: "user", content: parts }),
  encodeAssistant: (message, paired, wireIds) => {
    const parts = [];
    for (const block of message.content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "reasoning") parts.push({ type: "reasoning", text: block.text });
      else if (block.type === "tool-call" && paired.has(block.id)) {
        parts.push({
          type: "tool-call",
          toolCallId: wireIds.get(block.id) ?? block.id,
          toolName: block.name,
          input: recordOrEmpty(block.arguments)
        });
      }
    }
    return parts.length > 0 ? { role: "assistant", content: parts } : void 0;
  },
  encodeTool: (result, media, wireId, toolName) => ({
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: wireId,
      toolName,
      output: result.isError ? { type: "error-text", value: toolResultTextForWire(media) } : { type: "text", value: toolResultTextForWire(media) }
    }]
  })
};
async function messagesToCC(messages, readImage) {
  return convertMessages(messages, readImage, ccMessageCodec);
}
async function imageToOpenAI(ref, readImage) {
  const version = await readImage(ref);
  return {
    type: "image_url",
    image_url: {
      url: encodedRequestImage(version).dataUrl
    }
  };
}
var openAiMessageCodec = {
  carriesToolResultMedia: false,
  encodeImage: imageToOpenAI,
  encodeUser: (parts) => {
    const hasImage = parts.some((part) => part.type === "image_url");
    return !hasImage && parts.length === 1 ? { role: "user", content: parts[0].text } : { role: "user", content: parts };
  },
  encodeAssistant: (message, paired, wireIds) => {
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
    const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
    const toolCalls = message.content.filter((block) => block.type === "tool-call" && paired.has(block.id)).map((block) => ({
      id: wireIds.get(block.id) ?? block.id,
      type: "function",
      function: { name: block.name, arguments: block.arguments }
    }));
    if (text === "" && reasoning === "" && toolCalls.length === 0) return void 0;
    const assistant = {
      role: "assistant",
      content: text !== "" ? text : toolCalls.length > 0 ? null : ""
    };
    if (reasoning !== "") assistant.reasoning_content = reasoning;
    if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
    return assistant;
  },
  encodeTool: (_result, media, wireId) => ({
    role: "tool",
    tool_call_id: wireId,
    content: toolResultTextForWire(media)
  })
};
async function messagesToOpenAI(messages, readImage) {
  return convertMessages(messages, readImage, openAiMessageCodec);
}
async function imageToMessages(ref, readImage) {
  const version = await readImage(ref);
  return {
    type: "image",
    source: { type: "base64", media_type: version.mediaType, data: encodedRequestImage(version).base64 }
  };
}
function parseToolArguments(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
var messagesMessageCodec = {
  carriesToolResultMedia: true,
  encodeImage: imageToMessages,
  encodeUser: (parts) => ({ role: "user", content: parts }),
  encodeAssistant: (message, paired, wireIds) => {
    const parts = [];
    let position = 0;
    for (const block of message.content) {
      if (block.type === "text") {
        parts.push({ type: "text", text: block.text });
        position++;
        continue;
      }
      if (block.type === "reasoning") {
        const signature = messagesSignatureAt(message, position);
        if (signature !== void 0) {
          parts.push({ type: "thinking", thinking: block.text, signature });
        }
        position++;
        continue;
      }
      if (block.type === "tool-call" && paired.has(block.id)) {
        parts.push({
          type: "tool_use",
          id: wireIds.get(block.id) ?? block.id,
          name: block.name,
          input: parseToolArguments(block.arguments)
        });
        position++;
      }
    }
    return parts.length > 0 ? { role: "assistant", content: parts } : void 0;
  },
  encodeTool: async (result, media, wireId, _toolName, readImage) => {
    const content = [];
    if (readImage) {
      for (const attachment of media.images) content.push(await imageToMessages(attachment, readImage));
    }
    content.push({ type: "text", text: toolResultTextForWire(media) });
    const toolResult = { type: "tool_result", tool_use_id: wireId, content };
    if (result.isError) toolResult.is_error = true;
    return { role: "user", content: [toolResult] };
  }
};
async function messagesToMessages(messages, readImage) {
  return convertMessages(messages, readImage, messagesMessageCodec);
}
var USAGE_ENDPOINT_COUNT = 4;
function parseUsageTotals(usage) {
  if (usage === void 0) return void 0;
  const result = {
    totalCount: numberValue(usage.totalCount) ?? 0,
    totalCost: numberValue(usage.totalCost) ?? 0,
    successRate: numberValue(usage.successRate) ?? 0,
    completedCount: numberValue(usage.completedCount) ?? 0,
    failedCount: numberValue(usage.failedCount) ?? 0,
    totalTokensIn: numberValue(usage.totalTokensIn) ?? 0,
    totalTokensOut: numberValue(usage.totalTokensOut) ?? 0,
    totalCredits: numberValue(usage.totalCredits) ?? 0,
    // 未上报统计口径不能默认写成账期，客户端必须明确显示周期未确认。
    periodBasis: stringValue(usage.periodBasis) ?? "unreported"
  };
  const start = periodTimestampValue(usage.periodStart);
  if (start > 0 && Number.isFinite(new Date(start).getTime())) result.periodStart = start;
  return result;
}
function parseWindowLimit(value) {
  const block = isRecord(value) ? value : void 0;
  if (block === void 0) return void 0;
  return {
    used: numberValue(block.used) ?? 0,
    cap: numberValue(block.cap) ?? 0,
    exceeded: block.exceeded === true,
    resetAt: numberValue(block.resetAt) ?? 0
  };
}
function windowVerdict(windows, now = Date.now()) {
  let reported = false;
  let exceeded = false;
  let resetAt = 0;
  for (const window of windows) {
    if (window === void 0) continue;
    reported = true;
    if (!window.exceeded) continue;
    exceeded = true;
    if (window.resetAt > 0 && window.resetAt - now <= MAX_TRUSTED_RESET_MS) {
      resetAt = Math.max(resetAt, window.resetAt);
    }
  }
  if (!reported) return void 0;
  return { exceeded, resetAt: exceeded ? resetAt : 0 };
}
function parseCreditLimits(credits) {
  if (credits === void 0) return void 0;
  const creditsData = isRecord(credits.credits) ? credits.credits : void 0;
  const windowLimits = isRecord(credits.windowLimits) ? credits.windowLimits : void 0;
  const fiveHour = windowLimits !== void 0 && isRecord(windowLimits.fiveHour) ? windowLimits.fiveHour : void 0;
  const weekly = windowLimits !== void 0 && isRecord(windowLimits.weekly) ? windowLimits.weekly : void 0;
  if (creditsData === void 0 && fiveHour === void 0 && weekly === void 0) return void 0;
  const parsed = {
    monthlyCredits: numberValue(creditsData?.monthlyCredits) ?? 0,
    purchasedCredits: numberValue(creditsData?.purchasedCredits) ?? 0,
    freeCredits: numberValue(creditsData?.freeCredits) ?? 0,
    // Recorded separately from the scalar: the panel must not report an
    // omitted balance as a consumed one.
    monthlyReported: numberValue(creditsData?.monthlyCredits) !== void 0,
    purchasedReported: numberValue(creditsData?.purchasedCredits) !== void 0,
    freeReported: numberValue(creditsData?.freeCredits) !== void 0
  };
  const fiveHourLimit = parseWindowLimit(fiveHour);
  const weeklyLimit = parseWindowLimit(weekly);
  if (fiveHourLimit !== void 0) parsed.fiveHour = fiveHourLimit;
  if (weeklyLimit !== void 0) parsed.weekly = weeklyLimit;
  return parsed;
}
function parseAccountIdentity(whoami) {
  const whoamiData = whoami !== void 0 && isRecord(whoami.user) ? whoami.user : void 0;
  const orgData = whoami !== void 0 && isRecord(whoami.org) ? whoami.org : void 0;
  return {
    account: whoamiData === void 0 ? void 0 : {
      id: stringValue(whoamiData.id) ?? "",
      name: stringValue(whoamiData.name) ?? "",
      userName: stringValue(whoamiData.userName) ?? ""
    },
    orgId: orgData === void 0 ? void 0 : stringValue(orgData.id)
  };
}
var JSON_READ_ERROR_NAMES = /* @__PURE__ */ new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError"]);
var JSON_READ_ERROR_CODES = /* @__PURE__ */ new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_INVALID_STATE",
  "UND_ERR_SOCKET",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_ABORTED",
  "Z_DATA_ERROR",
  "Z_BUF_ERROR"
]);
var JSON_CONTENT_TYPES = /* @__PURE__ */ new Set([
  "application/json",
  "application/problem+json",
  "text/html",
  "text/plain",
  "application/octet-stream"
]);
var JSON_CONTENT_ENCODINGS = /* @__PURE__ */ new Set(["identity", "gzip", "x-gzip", "deflate", "br", "zstd"]);
function jsonReadErrorIdentifiers(error) {
  const identifiers = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  let current = error;
  for (let depth = 0; depth < 4 && isRecord(current) && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current.name === "string" && JSON_READ_ERROR_NAMES.has(current.name)) identifiers.add(current.name);
    if (typeof current.code === "string" && JSON_READ_ERROR_CODES.has(current.code)) identifiers.add(current.code);
    current = current.cause;
  }
  return [...identifiers];
}
function jsonResponseMetadata(response) {
  const metadata = [];
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType) metadata.push(`内容类型：${JSON_CONTENT_TYPES.has(contentType) ? contentType : "其他"}`);
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding) metadata.push(`内容编码：${JSON_CONTENT_ENCODINGS.has(encoding) ? encoding : "其他"}`);
  return metadata;
}
function jsonResponseFailureDetail(response, failure) {
  let detail;
  if (failure.stage === "read") {
    const reason = failure.timedOut ? "读取响应正文超时" : "响应正文读取中断";
    detail = `${reason}${failure.identifiers.length === 0 ? "" : `（${failure.identifiers.join(" / ")}）`}`;
  } else if (failure.stage === "parse") {
    detail = "响应正文不是有效的 JSON（结构化数据解析失败；SyntaxError）";
  } else {
    detail = `响应 JSON 顶层应为对象，实际为${failure.shape}`;
  }
  const metadata = jsonResponseMetadata(response);
  return `${detail}${metadata.length === 0 ? "" : `；${metadata.join("；")}`}`;
}
function classifyTotalFailure(failures, failed) {
  if (failures.length !== USAGE_ENDPOINT_COUNT) return void 0;
  if (failed.every((item) => item.kind === "http" && item.status === 401)) {
    return "invalid-key";
  }
  if (failed.every((item) => item.kind === "http" && item.status >= 500)) {
    return "service-unavailable";
  }
  if (failed.every((item) => item.kind === "invalid-response")) return "invalid-response";
  if (failed.every((item) => item.kind === "transport")) return "network";
  return void 0;
}
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var THREAD_ID_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
function cliThreadId(sessionId) {
  if (!sessionId) return randomUUID3();
  if (UUID_PATTERN.test(sessionId)) return sessionId;
  const digest = createHash("sha1").update(THREAD_ID_NAMESPACE).update("dsh-commandcode-provider/session/").update(sessionId).digest();
  digest[6] = digest[6] & 15 | 80;
  digest[8] = digest[8] & 63 | 128;
  const hex = digest.toString("hex", 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function cliSystem(systemText) {
  if (!systemText) return "";
  return [{
    type: "text",
    text: systemText,
    cache_control: { type: "ephemeral" }
  }];
}
var EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" };
var CACHEABLE_BLOCK_TYPES = /* @__PURE__ */ new Set(["text", "image", "tool_result"]);
function markLastUserCacheControl(messages) {
  const last = messages[messages.length - 1];
  if (!isRecord(last) || last.role !== "user" || !Array.isArray(last.content)) return;
  const lastBlock = last.content[last.content.length - 1];
  if (isRecord(lastBlock) && typeof lastBlock.type === "string" && CACHEABLE_BLOCK_TYPES.has(lastBlock.type)) {
    lastBlock.cache_control = EPHEMERAL_CACHE_CONTROL;
  }
}
function temperatureField(options) {
  if (pinsTemperature(options.model)) return {};
  return { temperature: options.temperature ?? 0.3 };
}
async function buildCliBody(options, connection, facts) {
  return {
    config: {
      workingDir: connection.workingDir,
      date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
      environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
      structure: [],
      isGitRepo: false,
      currentBranch: "",
      mainBranch: "",
      gitStatus: "",
      recentCommits: []
    },
    memory: null,
    taste: null,
    skills: null,
    // The official CLI's `toWirePermissionMode()` normalizes an absent/default
    // permission mode to "standard" before it reaches the wire (confirmed by a
    // live-service probe: both "standard" and "default" are accepted enum
    // members, and the CLI's own internal default is "default", not
    // "standard" — the normalization step is what turns it into this). Sent
    // for request-shape parity with the real client; not a cache fix (see
    // docs/issue-64-cache-review.md's "root-cause boundary" section, which
    // already tested this exact value on this transport and excluded it as
    // the cause).
    permissionMode: "standard",
    params: {
      model: options.model,
      messages: await messagesToCC(options.messages, facts.readImage),
      tools: (options.tools ?? []).map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        input_schema: toolParametersSchema(tool.parameters)
      })),
      system: cliSystem(facts.systemText),
      // Omitted entirely when the user asked for it (issue #74): an absent
      // field leaves the per-turn output size to the platform, which is the
      // only way to stop the passive ceiling from cutting an answer short.
      ...facts.omitMaxTokens ? {} : { max_tokens: facts.maxTokens },
      ...temperatureField(options),
      stream: true,
      ...facts.reasoningEffort ? { reasoning_effort: facts.reasoningEffort } : {}
    },
    threadId: cliThreadId(options.sessionId)
  };
}
async function buildOpenAIBody(options, facts) {
  const openAiMessages = [
    ...facts.systemText ? [{ role: "system", content: facts.systemText }] : [],
    ...await messagesToOpenAI(options.messages, facts.readImage)
  ];
  const openAiTools = (options.tools ?? []).map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParametersSchema(tool.parameters)
    }
  }));
  return {
    model: options.model,
    messages: openAiMessages,
    ...openAiTools.length > 0 ? { tools: openAiTools } : {},
    ...facts.omitMaxTokens ? {} : { max_tokens: facts.maxTokens },
    ...temperatureField(options),
    stream: true,
    ...facts.reasoningEffort ? { reasoning_effort: facts.reasoningEffort } : {}
  };
}
async function buildMessagesBody(options, facts) {
  const body = {
    model: options.model,
    // Always sent, even under `maxOutputTokens: 0` (issue #74): this endpoint
    // requires the field and refuses a body without it
    // (`Invalid input: expected number, received undefined at max_tokens`), so
    // omitting it would not lengthen an answer — it would make the whole Claude
    // family unusable. `omitOutputTokens()` keeps the flag false for this
    // transport; the derived budget stands.
    max_tokens: facts.maxTokens,
    stream: true,
    messages: await messagesToMessages(options.messages, facts.readImage)
  };
  if (facts.selectableEffort) body.thinking = { type: "adaptive" };
  if (facts.systemText) {
    body.system = [{
      type: "text",
      text: facts.systemText,
      cache_control: EPHEMERAL_CACHE_CONTROL
    }];
  }
  if (facts.reasoningEffort) body.output_config = { effort: facts.reasoningEffort };
  const tools = (options.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    // The gateway rejects a tool whose root schema is not `type: 'object'`
    // (`tools.0.custom.input_schema.type: Field required`), so the same
    // normalization the other transports use applies here.
    input_schema: toolParametersSchema(tool.parameters)
  }));
  if (tools.length > 0) {
    tools[tools.length - 1].cache_control = EPHEMERAL_CACHE_CONTROL;
    body.tools = tools;
  }
  markLastUserCacheControl(body.messages);
  return body;
}
function assignMaxTokens(body, target, maxTokens) {
  if (target === "cli") recordOrEmpty(body.params).max_tokens = maxTokens;
  else body.max_tokens = maxTokens;
}
function protocolEndpoint(protocol, apiBase) {
  if (protocol === "cli") return `${apiBase}/alpha/generate`;
  return protocol === "messages" ? `${apiBase}/provider/v1/messages` : `${apiBase}/provider/v1/chat/completions`;
}
async function readGenerateErrorBody(response, abort, timeoutMs) {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  const limit = 64 * 1024;
  let removeAbort = () => void 0;
  const stopped = new Promise((resolve) => {
    if (abort.signal.aborted) resolve(void 0);
    else abort.signal.addEventListener("abort", onAbort, { once: true });
    function onAbort() {
      resolve(void 0);
    }
    removeAbort = () => abort.signal.removeEventListener("abort", onAbort);
  });
  const timer = setTimeout(() => abort.abort(), Math.min(timeoutMs, 3e4));
  try {
    while (bytes < limit) {
      const read = await Promise.race([reader.read(), stopped]);
      if (read === void 0 || read.done) break;
      const remaining = limit - bytes;
      text += decoder.decode(read.value.subarray(0, remaining), { stream: true });
      bytes += read.value.byteLength;
    }
    return text + decoder.decode();
  } catch {
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    removeAbort();
    void reader.cancel().catch(() => void 0);
    reader.releaseLock();
  }
}
async function connectGenerate(deps, key, protocol, serializedBody) {
  const { options, connection, fetchImpl } = deps;
  const connectAbort = new AbortController();
  let connectTimedOut = false;
  const endpoint = protocolEndpoint(protocol, connection.apiBase);
  const connectTimer = setTimeout(() => {
    connectTimedOut = true;
    connectAbort.abort(
      new DOMException(
        `Command Code API request to ${endpoint} did not respond within ${connection.requestTimeoutMs}ms`,
        "TimeoutError"
      )
    );
  }, connection.requestTimeoutMs);
  const onCallerAbort = () => {
    connectAbort.abort(options.signal?.reason);
  };
  if (options.signal) {
    if (options.signal.aborted) {
      onCallerAbort();
    } else {
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }
  const cleanup = () => {
    clearTimeout(connectTimer);
    if (options.signal) {
      options.signal.removeEventListener("abort", onCallerAbort);
    }
  };
  let response;
  const zdr = connection.zdr === true;
  const sharedHeaders = {
    "Content-Type": "application/json",
    ...IDENTITY_ENCODING_HEADER,
    Authorization: `Bearer ${key}`,
    ...zdr ? { "x-cmd-zdr": "1" } : {},
    ...attributionHeaders()
  };
  const headers = protocol === "cli" ? {
    ...sharedHeaders,
    "x-command-code-version": COMMAND_CODE_CLI_VERSION,
    "x-cli-environment": "production",
    "x-project-slug": projectSlugFromPath(connection.workingDir),
    "x-taste-learning": "false",
    "x-co-flag": "false"
  } : {
    ...sharedHeaders,
    Accept: "text/event-stream"
    // Deliberately no x-command-code-version / x-cli-environment on either
    // documented Provider API surface: those identify the CLI transport,
    // not a public API client. ZDR is the one business header both share.
  };
  const finishHeaders = deps.timing.attempt(protocol, Buffer.byteLength(serializedBody));
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: serializedBody,
      signal: connectAbort.signal
    });
    finishHeaders(response.status);
    clearTimeout(connectTimer);
  } catch (error) {
    finishHeaders();
    cleanup();
    if (options.signal?.aborted) {
      throw error;
    }
    if (connectTimedOut || error instanceof DOMException && error.name === "TimeoutError") {
      throw headersTimeoutError({
        protocol,
        endpoint,
        body: serializedBody,
        timeoutMs: connection.requestTimeoutMs,
        cause: error
      });
    }
    throw bilingual(
      "TRANSPORT",
      `Command Code API request to ${endpoint} failed: ${errorChain2(error)}`,
      "Command Code API 请求连接失败——通常是网络或代理问题，请检查网络或代理设置后重试",
      { cause: error }
    );
  }
  deps.onResponse(response);
  if (!response.ok) {
    let errText;
    try {
      errText = await readGenerateErrorBody(response, connectAbort, connection.requestTimeoutMs);
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("已取消请求", "AbortError");
    } finally {
      cleanup();
    }
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    return retryAfterMs === void 0 ? { status: response.status, errText } : { status: response.status, errText, retryAfterMs };
  }
  return { response, cleanup };
}
var CommandCodeAdapter = class _CommandCodeAdapter extends LlmAdapter {
  constructor(deps) {
    super();
    this.deps = deps;
    this.fetchImpl = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.resolveAttachments = deps.resolveAttachments;
    this.surfaceOffload = deps.imageOffload ?? ENGINE_IMAGE_POLICY;
  }
  deps;
  gatewayFacts = new GatewayFacts(async (source) => {
    const { status, record } = await this.fetchJson(
      `${source.apiBase}/provider/v1/models`,
      { accept: "application/json", ...IDENTITY_ENCODING_HEADER, ...attributionHeaders() },
      MODELS_TIMEOUT_MS
    );
    if (status < 200 || status >= 300) throw new Error(`models endpoint returned ${status}`);
    return record;
  });
  fetchImpl;
  resolveAttachments;
  /**
   * The durable-offload contract, resolved once (tests may inject a stub). The
   * contract cannot change while the process runs.
   */
  surfaceOffload;
  // Billing facts are per gateway and account: a custom gateway can give the
  // same key a different tier. The key remains process-local and is never logged. Entries are
  // small and bounded by the account count in practice; a changed key simply
  // starts a fresh entry while the orphaned one goes cold (no eviction —
  // transience is intentional, persistence would serve stale tiers).
  billingAccess = /* @__PURE__ */ new Map();
  billingAccessInflight = /* @__PURE__ */ new Map();
  /**
   * Successful account-endpoint responses, keyed by gateway + key + exact URL.
   *
   * The settings card and the picker's advisory plan filter ask the SAME three
   * endpoints about the SAME account (`/alpha/whoami`, then credits and
   * subscriptions in parallel). Here that is four round trips per surface for
   * two answers — and the card refreshes on a timer, so the picker keeps paying
   * for rows it already has. Sharing the raw responses removes the duplicate
   * without either surface having to know about the other: whoever asks second
   * within {@link ACCOUNT_FACTS_TTL_MS} reads the same record instead of the
   * wire.
   *
   * Only SUCCESSFUL records are kept. A failure must be retried rather than
   * replayed, or an endpoint that recovered a second ago would keep reporting
   * yesterday's outage — and the usage report's per-endpoint `failures` and
   * {@link classifyTotalFailure} verdict would describe a request this process
   * never made.
   */
  accountJson = /* @__PURE__ */ new Map();
  // Protocol preference is per gateway and account: the Go plan is the only plan without
  // Provider API access, and that fact is independent of model. A negative
  // result (provider API rejected this key with upgrade_required) is cached so
  // every request does not pay the double TTFT of probing then falling back.
  // Same bounded-by-account-count note as above: no eviction by design.
  protocolCache = /* @__PURE__ */ new Map();
  /** Namespace account-derived facts by gateway without exposing the key. */
  accountCacheKey(apiBase, apiKey) {
    return JSON.stringify([apiBase, apiKey]);
  }
  /**
   * Consecutive header timeouts for the last request shape, counted ACROSS
   * `stream()` calls: dsh-llm-retry re-invokes this same instance, so this is
   * the only place a streak can live. Keyed by `sessionId` (not by `agent`:
   * `GenerateOptions` carries no agent reference, only `sessionId`) so
   * concurrent sessions on this one shared adapter instance cannot clear or
   * inflate each other's count. A call with no `sessionId` (a one-shot,
   * session-less caller) falls back to {@link GLOBAL_HEADER_TIMEOUT_KEY},
   * matching the old single-slot behavior for exactly that case. Bounded by
   * {@link MAX_HEADER_TIMEOUT_STREAK_ENTRIES} with FIFO eviction (`Map`
   * preserves insertion order) since the key space is per-session rather than
   * per-account/model, so it is not naturally small like `protocolCache`.
   */
  headerTimeoutStreaks = /* @__PURE__ */ new Map();
  static MAX_HEADER_TIMEOUT_STREAK_ENTRIES = 200;
  /**
   * Grade one failed attempt: a headers timeout that repeats on an unchanged
   * payload eventually leaves the retryable whitelist.
   *
   * `providerRetryPolicy()` cannot express this itself — dsh-llm's
   * `NormalRetryPolicyConfig` carries one `maxRetries` for every listed code.
   * Escalating here stops repeated identical header timeouts with a specific
   * diagnosis; the agent listener separately caps ordinary transient errors.
   *
   * @returns the error to surface: unchanged for any other failure, the
   * original timeout below the threshold, and a terminal one at it.
   */
  gradeHeaderTimeout(error, protocol, body, timeoutMs, sessionId, sent) {
    const timedOut = error instanceof LlmError6 && error.code === "TIMEOUT";
    if (!timedOut) return error;
    const key = sessionId ?? GLOBAL_HEADER_TIMEOUT_KEY;
    const fingerprint = `${protocol}:${sent === void 0 ? fingerprintValue(body).sha256 : sha256Hex(sent)}`;
    const previous = this.headerTimeoutStreaks.get(key);
    const count = previous?.fingerprint === fingerprint ? previous.count + 1 : 1;
    if (previous === void 0) {
      if (this.headerTimeoutStreaks.size >= _CommandCodeAdapter.MAX_HEADER_TIMEOUT_STREAK_ENTRIES) {
        const oldest = this.headerTimeoutStreaks.keys().next().value;
        if (oldest !== void 0) this.headerTimeoutStreaks.delete(oldest);
      }
    } else {
      this.headerTimeoutStreaks.delete(key);
    }
    this.headerTimeoutStreaks.set(key, { fingerprint, count });
    if (count < MAX_CONSECUTIVE_HEADER_TIMEOUTS) return error;
    this.headerTimeoutStreaks.delete(key);
    return bilingual(
      "PROVIDER_HTTP_ERROR",
      `Command Code API stopped retrying: the gateway returned no response headers on ${count} consecutive attempts at the same request, each after the full ${timeoutMs}ms budget, so this is not a network blip — it is provider queueing, a Go-plan capacity limit, or a network/proxy path problem. Resending the identical payload again is unlikely to help; wait for the provider to recover, or switch model or account.`,
      `Command Code API 已停止重试：同一请求连续 ${count} 次在 ${timeoutMs} 毫秒内都没有收到任何响应头，这不是网络抖动，而是服务商排队、Go 套餐容量限制或网络/代理链路问题。继续原样重发同一个请求通常无济于事——可以等服务商恢复，或换模型/换账号。`
    );
  }
  /**
   * Display metadata for the picker's provider group header. The base class
   * returns the raw route id (`commandcode`, all lowercase) as the name, which
   * is what the model selector shows as this group's sticky title; return the
   * proper display name instead, matching the Models settings page card (the
   * configurable-provider `displayName`). The id must stay equal to the route.
   */
  providerInfo(provider) {
    return { id: provider, name: "Command Code" };
  }
  /**
   * The official executor owns backoff and provider reset waits. Its high
   * route-wide cap lets a confirmed `RATE_LIMIT` window recover in-session;
   * our request-error listener limits `SERVER`/`TIMEOUT`/`EMPTY_RESPONSE`/
   * `THROTTLED` to three retries and `TRANSPORT` to its separate budget.
   * Waits double from 500 ms and cap at 15 minutes (±10% jitter). Permanent failures
   * (an invalid key's `INVALID_CREDENTIAL`, `UNSUPPORTED_CONTENT`, plan
   * rejections) are absent from the whitelist and surface immediately instead
   * of looping. Waits the pool/adapter attach as `providerRetryAfterMs` are
   * honored verbatim at or below the 15-minute cap and never attached above it
   * (in normal mode a longer attached wait makes the executor abandon the
   * retry outright — see RETRY_MAX_DELAY_MS).
   *
   * Captured once at route registration (dsh-llm snapshots this value), so a
   * future config knob for it would apply on profile restart, not per request.
   */
  providerRetryPolicy(_provider) {
    return resolveRetryPolicy(
      {
        mode: "normal",
        maxRetries: 1e3,
        retryableCodes: ["EMPTY_RESPONSE", "REASONING_LIMIT", "RATE_LIMIT", THROTTLED_CODE, "SERVER", "TIMEOUT", "TRANSPORT"],
        backoff: { initialDelayMs: 500, maxDelayMs: RETRY_MAX_DELAY_MS, jitterRatio: 0.1 }
      },
      "llm-commandcode: retryPolicy"
    );
  }
  /**
   * Visual-token pricing for one exact model route (see `./image-tokens.ts`).
   *
   * Without this the token meter prices EVERY image with its structural
   * heuristic — a handful of tokens for a full screenshot — so an image-heavy
   * session reports far less context than it is actually carrying. The price is
   * computed at the dimensions this route would send (the same request target
   * `readImageRequest` encodes to), so the estimate tracks the wire rather than
   * the stored original. One price per occurrence, in order, is a hard
   * requirement — the meter throws when the counts differ.
   */
  imageRequestPricing(_provider, model) {
    const imageCapable = this.gatewayFacts.knownModel(this.deps.options(), model)?.image ?? KNOWN_IMAGE_MODELS.has(model);
    return {
      priceImages: (images) => images.map((image) => priceRequestImage(image, model, imageCapable))
    };
  }
  /**
   * The dimensions and byte target this route actually puts on the wire.
   *
   * The base default answers with the NORMALIZED original (`image.width`,
   * `image.height`, `image.bytes`), which is right only for an adapter that
   * does not resize. This route always re-encodes through
   * `readImageRequest(ref, requestImageTarget(ref))` — long edge 1568, encoded
   * bytes capped at 1 MiB — so the default would over-report both dimensions
   * and bytes for every image, most visibly for Retina screenshots.
   *
   * `imageRequestPricing` above already prices at this same target; exposing it
   * here keeps the harness's own readers (the CUA screenshot path calls
   * `ctx.llm.imageRequestTarget`) consistent with what the gateway receives.
   * @param _provider - registered provider route; one route per adapter here.
   * @param _model - exact model id; the target is model-independent on this route.
   * @param image - normalized attachment whose request projection is resolved.
   * @returns the same target `readImageRequest` encodes to, before base64 expansion.
   */
  imageRequestTarget(_provider, _model, image) {
    return requestImageTarget(image);
  }
  /**
   * List the models the picker (or a settings-page editor) may offer.
   *
   * @param opts.unfiltered - serve the whole catalog regardless of plan/visibility
   *   filters (the settings page's model editors).
   * @param opts.catalogNames - return the upstream catalog name verbatim, with
   *   neither the ` (CC)` marker nor a `modelNames` override. The settings-page
   *   catalog endpoint and the model-analytics reader need the ORIGINAL name for
   *   their dropdowns/reports, so the custom display name stays confined to the
   *   model picker (issue #121). Optional so the host's `_provider`-only call
   *   keeps its shape.
   */
  async listModels(provider, opts) {
    const connection = { ...this.deps.options() };
    const cached = this.gatewayFacts.loaded(connection);
    const catalog = cached ?? await this.gatewayFacts.refresh(connection);
    if (cached !== void 0) {
      void this.gatewayFacts.refresh(connection).catch(() => void 0);
    }
    const toInfo = (model) => {
      const vision = model.image ?? KNOWN_IMAGE_MODELS.has(model.id);
      const badge = modelBadge(model.id);
      return {
        provider,
        id: model.id,
        // 显示名只覆盖模型选择器：id、请求体与所有按 id 的快照都不动
        //（issue #121）。设置页目录与模型分析要目录原名（catalogNames），
        // 排序已在 map 之前按目录原名完成。
        name: opts?.catalogNames === true ? model.name : effectiveModelName(model.name, model.id, connection),
        // The picker renders `description` under the model name: plan tier,
        // active deal, Image marker for Vision models, and context window —
        // the CUSTOM one when a context-length override applies (issue #86).
        description: capabilityDescription(model.id, effectiveContextWindow(model.contextWindow, model.id, connection)),
        inputModalities: vision ? ["text", "image"] : ["text"],
        // The composer model selector renders `LlmModelInfo.badge` as a Tag
        // beside the name (before it in the trigger, after it in menu rows);
        // engines from 0.2.1-rc.4 read it, older ones simply ignore the field.
        // Only promo markers go here — plan/peak/Image/context stay in the
        // description, which those same older engines also render.
        ...badge === void 0 ? {} : { badge }
      };
    };
    if (opts?.unfiltered === true) return [...catalog].sort(compareByPlan).map(toInfo);
    const accesses = connection.filterModelsByPlan === false ? void 0 : await this.loadPoolBillingAccess(connection);
    const visible = connection.visibleModels;
    const allow = Array.isArray(visible) ? visible.filter((id) => typeof id === "string" && id !== "") : [];
    const overrides = connection.modelVisibility;
    return catalog.filter((model) => modelVisibleForAnyAccount(model.id, accesses)).filter((model) => modelIsVisible(model.id, allow, overrides)).sort(compareByPlan).map(toInfo);
  }
  /**
   * The per-model allowance bracket this account POOL falls into, or undefined
   * when there is nothing honest to show.
   *
   * The pricing page publishes per-model monthly allowances for Go, GOAT and
   * Pro. A pool whose highest plan is Provider,
   * Max or Ultra gets undefined rather than a neighbouring tier's figure. Taking
   * the HIGHEST tier matches the question the picker already answers for a pool
   * (see `modelVisibleForAnyAccount`): what the user can reach, not what the one
   * account serving this request happens to be. The fail-open shape is the same
   * too — an unreachable billing endpoint yields undefined, which hides the
   * allowance instead of inventing one.
   */
  async allowanceTier() {
    const accesses = await this.loadPoolBillingAccess();
    if (accesses === void 0) return void 0;
    let highest;
    for (const access of accesses) {
      const weight = access?.tierWeight;
      if (weight === void 0) continue;
      if (highest === void 0 || weight > highest) highest = weight;
    }
    return allowanceTierForWeight(highest);
  }
  async resolveModel(provider, model, signal) {
    const connection = { ...this.deps.options() };
    const entry = this.gatewayFacts.knownModel(connection, model) ?? (await this.gatewayFacts.refresh(connection, signal)).find((m) => m.id === model);
    const efforts = entry?.reasoningEfforts ?? KNOWN_EFFORTS[model];
    const vision = entry?.image ?? KNOWN_IMAGE_MODELS.has(model);
    const contextWindow = entry === void 0 ? void 0 : effectiveContextWindow(entry.contextWindow, model, connection);
    return {
      provider,
      id: model,
      name: effectiveModelName(entry?.name, model, connection),
      description: capabilityDescription(model, contextWindow),
      inputModalities: vision ? ["text", "image"] : ["text"],
      // Both Command Code transports send the complete active tool declaration
      // list on every request. They do not need a provider-native deferred
      // tool marker, but they can still consume the rc.2 harness projection:
      // `tool-addition` messages are ignored by the wire converters and the
      // projected `options.tools` already contains the newly active schema.
      // Advertising addition-only lets dsh keep one conversation/request
      // series when a plugin enables a tool mid-session; removals are handled
      // by omission from that active list, not by a removal event.
      toolUpdate: "addition-only",
      ...entry !== void 0 && contextWindow !== void 0 ? {
        context: { contextWindow },
        // 用有效窗口重新计算，调大时解除旧目录窗口限制；模型输出上限与网关总上限仍有效。
        // 用户输出预算（issue #74）同样压低这里宣告的默认值，让宿主在未显式
        // 指定时也按用户上限请求；`0` 是省略哨兵，不改变宣告值。
        defaultMaxTokens: applyMaxOutputTokens(
          Math.min(catalogModelMaxTokens(connection.apiBase, entry, contextWindow), DEFAULT_GENERATE_MAX_TOKENS),
          connection.maxOutputTokens
        )
      } : {},
      // Omit `reasoning` entirely for models without known effort support:
      // the harness then treats the model as having no selectable efforts.
      ...efforts ? {
        reasoning: {
          efforts: efforts.map((effort) => ({
            id: ReasoningEffortId(effort),
            name: effort
          }))
        }
      } : {}
    };
  }
  /**
   * Resolve and validate the key one account-endpoint call will use.
   *
   * Every account endpoint runs the chat path's own plugin-local API-key check,
   * or a key carrying a character no HTTP header can hold throws inside `fetch`
   * BEFORE any I/O — once per endpoint — and the report reads as "the network is
   * down". The credential reference is read structurally: it belongs to the
   * host's resolved options, not to this adapter's connection type, and it only
   * names the key in the rejection message.
   *
   * Separate from {@link accountHeadersFor} so a caller that also needs to key a
   * cache by the same identity does not have to resolve the key twice.
   */
  async usableAccountKey(apiKey) {
    const connection = this.deps.options();
    const raw = apiKey ?? await this.deps.resolveApiKey(connection);
    const named = connection.apiKeyEnv;
    const ref = typeof named === "string" && named !== "" ? named : "the stored credential";
    return assertUsableApiKey(raw, "llm-commandcode", ref);
  }
  /** The headers every authenticated account endpoint shares. */
  async accountHeaders(apiKey) {
    return this.accountHeadersFor(await this.usableAccountKey(apiKey));
  }
  /** Headers for an already-validated key; see {@link usableAccountKey}. */
  accountHeadersFor(key) {
    return {
      Authorization: `Bearer ${key}`,
      ...IDENTITY_ENCODING_HEADER,
      "x-command-code-version": COMMAND_CODE_CLI_VERSION,
      "x-cli-environment": "production",
      ...attributionHeaders()
    };
  }
  /**
   * Fetch one JSON GET and return its HTTP status with a parsed record. The
   * catalog, billing probe, and usage report each apply their own failure
   * policy. Non-2xx and unusable bodies come back without a record; only
   * a failure before receiving the response propagates to the caller.
   * 正文读取、JSON 解析与顶层结构分别诊断，不能把已收到响应后的断流当成格式错误。
   *
   * `timeoutMs` is the caller's budget, unless it provides its own signal.
   * The usage report passes the connection's request budget rather than the
   * catalog/picker's shorter default.
   */
  async fetchJson(url, headers, timeoutMs = MODELS_TIMEOUT_MS, signal) {
    const requestSignal = signal ?? AbortSignal.timeout(timeoutMs);
    const response = await this.fetchImpl(url, {
      headers,
      // A hung account endpoint must not stall the picker / usage card forever.
      signal: requestSignal
    });
    if (!response.ok) return { status: response.status };
    let text;
    try {
      text = await response.text();
    } catch (error) {
      const identifiers = jsonReadErrorIdentifiers(error);
      if (requestSignal.aborted) {
        for (const identifier of jsonReadErrorIdentifiers(requestSignal.reason)) {
          if (!identifiers.includes(identifier)) identifiers.push(identifier);
        }
      }
      const timedOut = identifiers.includes("TimeoutError") || identifiers.includes("ETIMEDOUT") || identifiers.includes("UND_ERR_BODY_TIMEOUT");
      return {
        status: response.status,
        responseFailure: jsonResponseFailureDetail(response, { stage: "read", identifiers, timedOut })
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        status: response.status,
        // JSON.parse 的原异常会回显正文片段；只保留解析阶段与固定异常名。
        responseFailure: jsonResponseFailureDetail(response, { stage: "parse" })
      };
    }
    if (isRecord(parsed)) return { status: response.status, record: parsed };
    const shape = parsed === null ? "空值" : Array.isArray(parsed) ? "数组" : typeof parsed === "string" ? "字符串" : typeof parsed === "number" ? "数字" : "布尔值";
    return {
      status: response.status,
      responseFailure: jsonResponseFailureDetail(response, { stage: "shape", shape })
    };
  }
  /**
   * Every account's billing facts behind the picker's plan filter, in the
   * pool's rotation order and cached per key for {@link BILLING_ACCESS_TTL_MS}
   * (so the extra accounts cost their three requests once per TTL, not once
   * per picker load). `undefined` means the filter cannot be evaluated at all
   * — no key resolved — which {@link modelVisibleForAnyAccount} reads as
   * "show everything".
   */
  async loadPoolBillingAccess(connection = { ...this.deps.options() }) {
    const keys = await this.poolAccountKeys(connection);
    if (keys.length === 0) return void 0;
    const apiBase = connection.apiBase;
    return Promise.all(keys.map((key) => this.loadBillingAccessForKey(apiBase, key)));
  }
  /**
   * The API keys the picker's plan filter must consult: every account the host
   * can serve from, in rotation order, when the host exposes one. A host
   * without a pool (or without the seam) reports just the key that would serve
   * this request — exactly the pre-pool behaviour.
   */
  async poolAccountKeys(connection) {
    try {
      const keys = await this.deps.resolveAccountKeys?.(connection);
      const usable = (keys ?? []).filter((key) => typeof key === "string" && key !== "");
      if (usable.length > 0) return usable;
    } catch {
    }
    try {
      return [await this.deps.resolveApiKey(connection)];
    } catch {
      return [];
    }
  }
  /**
   * One account's billing facts, cached for {@link BILLING_ACCESS_TTL_MS} and
   * shared across concurrent callers. `undefined` means "unknown — show
   * everything" (fail-open).
   */
  async loadBillingAccessForKey(apiBase, apiKey) {
    const cacheKey = this.accountCacheKey(apiBase, apiKey);
    const cached = this.billingAccess.get(cacheKey);
    if (cached !== void 0 && Date.now() - cached.at < BILLING_ACCESS_TTL_MS) return cached.value;
    const existing = this.billingAccessInflight.get(cacheKey);
    if (existing !== void 0) return existing;
    const inflight = this.fetchBillingAccess(apiBase, apiKey).then((value) => {
      this.billingAccess.set(cacheKey, { value, at: Date.now() });
      return value;
    }).finally(() => {
      this.billingAccessInflight.delete(cacheKey);
    });
    this.billingAccessInflight.set(cacheKey, inflight);
    return inflight;
  }
  /**
   * One account-endpoint GET, served from {@link accountJson} when `share` and
   * the same URL answered successfully within {@link ACCOUNT_FACTS_TTL_MS}.
   *
   * `timeoutMs` is the CALLER's budget; a cache hit spends none of it. Failures
   * are never cached, so this can only ever save a request that would have
   * re-read an answer this process already had.
   *
   * `share: false` marks a VOLATILE endpoint — one whose answer is the number
   * the user is actually looking at, and which must therefore never be replayed
   * from an earlier request. The usage card's summary is exactly that: its
   * headline counts and cost are the reason the card exists, and stamping a
   * cached copy with the current time would misreport when they were read.
   * Identity and billing facts are the opposite: a plan tier or an org id that
   * is 30 s old is still the truth, and those are what the picker duplicates.
   *
   * `retryOnce` adds ONE more GET after a fast failure — a transport drop or a
   * 5xx. The account report has no retry/rotation chain of its own (unlike the
   * chat path), so a single blip used to become a permanent-looking
   * "部分端点数据不可用" note on the settings card. A TIMEOUT is deliberately not
   * retried: the first attempt already spent the caller's whole budget (up to
   * `requestTimeoutMs`), and re-sending would only double a hang the user is
   * already staring at. 4xx is not retried either — an expired key or a bad
   * `since` answers the same way the second time. The picker's fail-open reads
   * keep the old single-attempt behaviour: they are advisory and a retry there
   * would only slow the model list down.
   */
  async accountJsonGet(apiBase, apiKey, path, timeoutMs, share = true, retryOnce = false) {
    const cacheKey = JSON.stringify([apiBase, apiKey, path]);
    if (share) {
      const hit = this.accountJson.get(cacheKey);
      if (hit !== void 0 && Date.now() - hit.at < ACCOUNT_FACTS_TTL_MS) {
        return { status: 200, record: hit.record };
      }
    }
    const url = `${apiBase}${path}`;
    const headers = this.accountHeadersFor(apiKey);
    const fetchOnce = () => this.fetchJson(url, headers, timeoutMs);
    let answer;
    try {
      answer = await fetchOnce();
    } catch (error) {
      if (!retryOnce || isRequestTimeout(error)) throw error;
      await accountRetryDelay();
      answer = await fetchOnce();
    }
    if (retryOnce && answer.record === void 0 && answer.status >= 500) {
      await accountRetryDelay();
      answer = await fetchOnce();
    }
    if (share && answer.record !== void 0) {
      this.accountJson.set(cacheKey, { record: answer.record, at: Date.now() });
    }
    return answer;
  }
  /**
   * The billing facts behind the picker's plan filter, mirroring the CLI's
   * `createBilling` flow: whoami yields the org id, then the subscriptions
   * and credits endpoints answer in parallel. The plan id is honored only
   * when the subscription reports an active-ish status (the CLI's rule); when
   * the subscriptions endpoint fails entirely, `credits.planId` is the
   * fallback (the CLI stamps plan identity from it too). Any failure resolves
   * to `undefined` (fail-open) rather than breaking the picker.
   */
  async fetchBillingAccess(apiBase, apiKey) {
    try {
      const key = await this.usableAccountKey(apiKey);
      const getJson = async (path) => (await this.accountJsonGet(apiBase, key, path, MODELS_TIMEOUT_MS)).record;
      const whoami = await getJson("/alpha/whoami");
      const orgData = whoami && isRecord(whoami.org) ? whoami.org : void 0;
      const orgId = orgData === void 0 ? void 0 : stringValue(orgData.id);
      const [subscription, credits] = await Promise.all([
        getJson(orgId === void 0 ? "/alpha/billing/subscriptions" : `/alpha/billing/subscriptions?orgId=${encodeURIComponent(orgId)}`),
        getJson("/alpha/billing/credits")
      ]);
      const subData = subscription && isRecord(subscription.data) ? subscription.data : void 0;
      const creditsData = credits && isRecord(credits.credits) ? credits.credits : void 0;
      if (subData === void 0 && creditsData === void 0) return void 0;
      let planId;
      if (subData !== void 0) {
        const status = stringValue(subData.status);
        if (status !== void 0 && ACTIVE_SUBSCRIPTION_STATUSES.has(status)) planId = stringValue(subData.planId);
      } else {
        planId = stringValue(creditsData?.planId);
      }
      return {
        tierWeight: planId === void 0 ? void 0 : subscriptionPlanInfo(planId)?.tierWeight,
        onDemandCredits: (numberValue(creditsData?.purchasedCredits) ?? 0) + (numberValue(creditsData?.freeCredits) ?? 0)
      };
    } catch {
      return void 0;
    }
  }
  /** Fresh cached billing tier weight for a key, or undefined when not known. */
  cachedBillingTierWeight(apiBase, apiKey) {
    const hit = this.billingAccess.get(this.accountCacheKey(apiBase, apiKey));
    if (hit === void 0 || Date.now() - hit.at >= BILLING_ACCESS_TTL_MS) return void 0;
    return hit.value?.tierWeight;
  }
  /** Cached protocol decision for a key, or undefined when expired/unknown. */
  cachedProtocol(apiBase, apiKey) {
    const hit = this.protocolCache.get(this.accountCacheKey(apiBase, apiKey));
    if (hit === void 0 || Date.now() - hit.at >= PROTOCOL_CACHE_TTL_MS) return void 0;
    return hit.protocol;
  }
  rememberProtocol(apiBase, apiKey, protocol) {
    this.protocolCache.set(this.accountCacheKey(apiBase, apiKey), { protocol, at: Date.now() });
  }
  /**
   * True when the catalog routes `model` to `/provider/v1/messages`.
   *
   * The catalog's own `supported_endpoints` is authoritative (it is what
   * upstream publishes per model); `requiresMessagesEndpoint()` — the
   * `claude-*` prefix rule — is the fallback for a catalog entry that carries
   * no route list, which is the shape every pre-1.55 cache file has.
   */
  routesToMessages(model, entry) {
    if (entry !== void 0 && entry.supportedEndpoints.length > 0) {
      return entry.supportedEndpoints.includes("/messages");
    }
    return requiresMessagesEndpoint(model);
  }
  /**
   * Choose the initial protocol for one request.
   *
   * Models the Provider API serves only through `/provider/v1/messages` (the
   * Claude family) take the Messages transport on any tier and even under a
   * forced `'openai'` preference: that option is documented as "prefer the
   * Provider API, still fall back", and the 400 these models answer with on
   * Chat Completions (`Model "<id>" must be called via /provider/v1/messages`)
   * is a hard refusal, not a preference to honour.
   *
   * That decision is deliberately NOT written to `protocolCache`, which is
   * keyed by gateway and API key: it depends on the model, not just the account, so
   * remembering it would pin the whole ACCOUNT to one transport and drag
   * every other model along (issue #46).
   *
   * Otherwise a fresh protocol cache entry wins, then a cached (not
   * network-fetched) billing tier of Go — the one plan without Provider API
   * access. Unknown accounts default to Chat Completions and fall back to the
   * CLI transport only after an `upgrade_required` rejection.
   */
  resolveProtocol(connection, apiKey, model, entry) {
    const { apiBase, protocol: forced } = connection;
    if (forced === "cli") return forced;
    if (forced === "messages" && !this.routesToMessages(model, entry)) throw new LlmError6("Model does not support Messages protocol", "UNSUPPORTED_CONTENT");
    if (this.routesToMessages(model, entry)) return "messages";
    if (forced === "openai") return forced;
    const cached = this.cachedProtocol(apiBase, apiKey);
    if (cached !== void 0) return cached;
    if (this.cachedBillingTierWeight(apiBase, apiKey) === GO_TIER_WEIGHT) {
      this.rememberProtocol(apiBase, apiKey, "cli");
      return "cli";
    }
    return "openai";
  }
  /**
   * Fetch account, usage, credit, and subscription state from the Command
   * Code account endpoints (`/alpha/whoami`, `/alpha/usage/summary`,
   * `/alpha/billing/credits`, `/alpha/billing/subscriptions`).
   * Each endpoint degrades independently: a failed one lands in `failures`
   * while the rest still report, so a transient outage never blanks the whole
   * view. Requires a usable API key (throws `MISSING_CREDENTIAL` otherwise).
   * Pass `apiKey` to report on a specific account of a multi-account pool;
   * the default resolves the currently active account.
   *
   * Two failure modes are NOT "the network is down", and the report must say
   * so rather than let {@link classifyTotalFailure} blame the connection: a
   * key that no HTTP header can carry (a stray newline from a paste, a
   * full-width character) makes `fetch` throw a `TypeError` before any I/O,
   * for every endpoint at once, so this path runs the same local check too and
   * answers `blocked: 'invalid-key'`; and the four endpoints get the SAME
   * per-request budget as a chat call (`connection.requestTimeoutMs`, default
   * 60 s), not the catalog's 10 s probe budget, because on a slow link a 10 s
   * cap made every account query time out while chat kept working.
   */
  async getUsage(apiKey, capturedConnection) {
    const connection = capturedConnection ?? { ...this.deps.options() };
    const base = connection.apiBase;
    let key;
    try {
      key = await this.usableAccountKey(apiKey);
    } catch (error) {
      if (error instanceof LlmError6 && error.code === "INVALID_CREDENTIAL") {
        return { failures: [error.message], blocked: "invalid-key" };
      }
      throw error;
    }
    const failures = [];
    const failed = [];
    const getJson = async (path, share = true) => {
      try {
        const { status, record, responseFailure } = await this.accountJsonGet(
          base,
          key,
          path,
          connection.requestTimeoutMs,
          share,
          true
        );
        if (record === void 0) {
          failures.push(`${path}: HTTP ${status}${responseFailure ? `；${responseFailure}` : ""}`);
          failed.push(responseFailure ? { kind: "invalid-response", status } : { kind: "http", status });
          return void 0;
        }
        return record;
      } catch (error) {
        const reason = transportFailureReason(error);
        const origin = httpOrigin(base);
        failures.push(`${path}: ${readableErrorText(error)}${reason === void 0 ? "" : `；${reason}`}${origin === void 0 ? "" : `；目标 ${origin}`}`);
        failed.push({ kind: "transport" });
        return void 0;
      }
    };
    const report = { failures };
    const whoami = await getJson("/alpha/whoami");
    const { account, orgId } = parseAccountIdentity(whoami);
    if (account !== void 0) report.account = account;
    const scopedPath = (path, since2) => {
      const params = new URLSearchParams();
      if (orgId !== void 0) params.set("orgId", orgId);
      if (since2 !== void 0) params.set("since", since2);
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    };
    const [credits, subscription] = await Promise.all([
      getJson(scopedPath("/alpha/billing/credits")),
      getJson(scopedPath("/alpha/billing/subscriptions"))
    ]);
    const subData = subscription !== void 0 && isRecord(subscription.data) ? subscription.data : void 0;
    const rawStart = subData?.currentPeriodStart;
    const periodStart = periodTimestampValue(rawStart);
    const validStart = periodStart > 0 && Number.isFinite(new Date(periodStart).getTime());
    const since = validStart ? String(rawStart) : void 0;
    const usage = await getJson(scopedPath("/alpha/usage/summary", since), false);
    const totals = parseUsageTotals(usage);
    if (totals !== void 0) report.usage = totals;
    const limits = parseCreditLimits(credits);
    if (limits !== void 0) report.credits = limits;
    const creditsData = credits !== void 0 && isRecord(credits.credits) ? credits.credits : void 0;
    const planId = stringValue(subData?.planId) ?? stringValue(creditsData?.planId);
    if (subData !== void 0 || planId !== void 0) {
      const info = planId === void 0 ? void 0 : subscriptionPlanInfo(planId);
      report.plan = {
        planId: planId ?? "",
        name: info?.name ?? planId ?? "",
        status: stringValue(subData?.status) ?? "",
        monthlyCredits: info?.monthlyCredits ?? null,
        currentPeriodEnd: periodTimestampValue(subData?.currentPeriodEnd)
      };
      if (validStart) report.plan.currentPeriodStart = periodStart;
    }
    const blocked = classifyTotalFailure(failures, failed);
    if (blocked !== void 0) report.blocked = blocked;
    return report;
  }
  /**
   * Probe one account's real usage windows from `/alpha/billing/credits`. The
   * multi-account pool calls this when every account is marked exhausted: an
   * account whose windows no longer report `exceeded` is revived, and the
   * `resetAt` values feed the "earliest reset" error message.
   *
   * BOTH windows the endpoint publishes are read, not just `fiveHour`. An
   * account can have an open five-hour window and an exhausted WEEKLY quota at
   * the same time (the two are metered separately), and reading only the
   * shorter one revived such an account as "usable" — the pool then handed it
   * out, the provider rejected the request again, and the next all-marked pass
   * revived it once more (issue #51's follow-up: "切到一个不可用账号").
   * `exceeded` is therefore true when ANY published window is exceeded, and
   * `resetAt` is the LATEST reset among the exceeded ones — the binding
   * constraint, because a clear five-hour window buys nothing while the weekly
   * quota is spent.
   *
   * Returns `undefined` when the probe itself failed (transport, non-200, or a
   * payload with no window limits at all) — a failed probe never changes pool
   * state. The credit balances are deliberately NOT part of this answer: they
   * carry no reset time, and the server remains the final gate on them.
   */
  async probeWindowLimits(apiKey, connection = { ...this.deps.options() }) {
    try {
      const { record: parsed } = await this.fetchJson(
        `${connection.apiBase}/alpha/billing/credits`,
        await this.accountHeaders(apiKey)
      );
      if (parsed === void 0) return void 0;
      const windowLimits = isRecord(parsed.windowLimits) ? parsed.windowLimits : void 0;
      if (windowLimits === void 0) return void 0;
      return windowVerdict([windowLimits.fiveHour, windowLimits.weekly].map((raw) => isRecord(raw) ? parseWindowLimit(raw) : void 0));
    } catch {
      return void 0;
    }
  }
  stream(options) {
    const connection = Object.freeze({ ...this.deps.options() });
    const facts = {
      connection,
      // 同时捕获目录状态；旧迭代器消费不能重新绑定并撤销新来源的刷新。
      catalog: this.gatewayFacts.snapshot(connection),
      fallbackLimit: modelOutputTokenLimit(connection.apiBase, options.model)
    };
    return ownedResponseStream(options.signal, (signal) => this.streamWithTiming(options, signal, facts));
  }
  async *streamWithTiming(options, signal, facts) {
    const timing = openRequestTiming(options.model, this.deps.onRequestTiming);
    let outcome = "cancelled";
    let errorCode;
    try {
      for await (const chunk of this.streamRequest({ ...options, signal }, timing, facts)) {
        if (chunk.type === "text-delta" || chunk.type === "reasoning-delta" || chunk.type === "tool-call-delta") {
          timing.first("firstContentMs");
        }
        if (chunk.type === "finish") outcome = "finished";
        yield chunk;
      }
    } catch (error) {
      outcome = options.signal?.aborted ? "aborted" : signal.aborted ? "cancelled" : "error";
      if (outcome !== "cancelled") errorCode = error instanceof LlmError6 ? error.code : "unknown";
      throw error;
    } finally {
      await timing.close(outcome, errorCode);
    }
  }
  /**
   * One turn, with at most one output-ceiling downshift.
   *
   * The ceiling a model accepts is not published anywhere the request can be
   * built from (see `modelOutputTokenLimit`), and the endpoint states it only
   * by refusing. That refusal is worth one retry rather than a failed turn: the
   * harness's own recovery for it — compact the context — cannot help, because
   * nothing about the context is wrong, and resending the identical request
   * would be refused identically (issue #71). Reading the stated ceiling off
   * the rejection turns one wasted turn into one, for good: it is recorded
   * process-wide, so the next request for this model is built correctly
   * without spending the round trip again.
   *
   * Only BEFORE the first chunk reaches the host. Once a delta has been
   * delivered the answer is already partly on screen, and a second request
   * would duplicate it — so from that point the error stands and says what is
   * actually wrong. One downshift per turn, and a second refusal surfaces.
   */
  async *streamRequest(options, timing, facts) {
    options.signal?.throwIfAborted();
    const { connection } = facts;
    const catalog = await facts.catalog;
    options.signal?.throwIfAborted();
    const modelEntry = catalog.find((row) => row.id === options.model);
    const modelMax = modelEntry === void 0 ? facts.fallbackLimit : catalogModelMaxTokens(
      connection.apiBase,
      modelEntry,
      effectiveContextWindow(modelEntry.contextWindow, options.model, connection)
    );
    const initialMax = applyMaxOutputTokens(
      Math.min(options.maxTokens ?? Infinity, modelMax, DEFAULT_GENERATE_MAX_TOKENS),
      connection.maxOutputTokens
    );
    const budget = { max: initialMax, sent: initialMax };
    for (let attempt = 0; ; attempt++) {
      let delivered = false;
      try {
        for await (const chunk of this.streamAttempt(options, timing, connection, modelEntry, budget)) {
          delivered = true;
          yield chunk;
        }
        return;
      } catch (error) {
        const ceiling = delivered ? void 0 : outputCeilingRefusal(connection.apiBase, options.model, budget.sent, error);
        if (attempt > 0 || ceiling === void 0) throw error;
        budget.max = Math.min(budget.max, ceiling);
      }
    }
  }
  async *streamAttempt(options, timing, connection, modelEntry, budget) {
    options.signal?.throwIfAborted();
    if (options.stop?.length) {
      throw new LlmError6("Command Code adapter does not support stop sequences", "UNSUPPORTED_OPTION");
    }
    const hasImages = options.messages.some(hasImageContent);
    let readImage;
    if (hasImages) {
      if (!(modelEntry?.image ?? KNOWN_IMAGE_MODELS.has(options.model))) {
        throw new LlmError6(
          `Command Code model "${options.model}" does not support image input; switch to a Vision-capable model (see the model registry)`,
          "UNSUPPORTED_CONTENT"
        );
      }
      const attachments = this.resolveAttachments?.();
      if (attachments === void 0) {
        throw new LlmError6(
          "Command Code image input requires the durable attachment service",
          "UNSUPPORTED_CONTENT"
        );
      }
      readImage = requestImages(attachments, options.signal, timing);
    }
    let maxTokens = Math.min(budget.max, learnedOutputLimit(connection.apiBase, options.model));
    const builtMaxTokens = maxTokens;
    const supported = modelEntry?.reasoningEfforts ?? KNOWN_EFFORTS[options.model];
    const effort = options.purpose === "session-title" && supported?.includes("off") ? "off" : options.reasoningEffort;
    const declared = effort !== void 0 && supported?.includes(effort) ? effort : void 0;
    const reasoningEffort = effort === "off" && declared === void 0 ? void 0 : declared;
    const systemText = [
      options.system ?? "",
      ...options.messages.filter((m) => m.role === "system").map((m) => m.content.map(blockText).filter(Boolean).join("\n"))
    ].filter(Boolean).join("\n\n");
    const projected = projectSurfaceBudget(options, this.surfaceOffload, REQUEST_IMAGE_BUDGETS[0]);
    let requestOptions = projected.options;
    const buildBody = async (target) => {
      const finishBody = timing.phase("body");
      try {
        const omitMaxTokens = omitOutputTokens(connection.maxOutputTokens, target, options.maxTokens);
        const facts = {
          maxTokens,
          omitMaxTokens,
          reasoningEffort,
          // Reuse the lookup `stream()` already did: a model with no effort
          // levels offers nothing for the thinking switch to control.
          selectableEffort: supported !== void 0 && supported.length > 0,
          systemText,
          readImage
        };
        const built = target === "cli" ? await buildCliBody(requestOptions, connection, facts) : target === "messages" ? await buildMessagesBody(requestOptions, facts) : await buildOpenAIBody(requestOptions, facts);
        return built;
      } finally {
        finishBody();
      }
    };
    const provisionalProtocol = connection.protocol === "cli" ? "cli" : this.routesToMessages(options.model, modelEntry) ? "messages" : "openai";
    const finishCredentials = timing.phase("credentials");
    const credentials = this.deps.resolveApiKey(connection, options.model);
    void credentials.catch(() => void 0);
    const provisionalBody = connection.offloadSeenImagesForCache === true || projected.budgetMissing > 0 ? void 0 : buildBody(provisionalProtocol);
    void provisionalBody?.catch(() => void 0);
    let apiKey;
    try {
      apiKey = await credentials;
    } finally {
      finishCredentials();
    }
    options.signal?.throwIfAborted();
    maxTokens = Math.min(budget.max, learnedOutputLimit(connection.apiBase, options.model));
    let protocol = this.resolveProtocol(connection, apiKey, options.model, modelEntry);
    const cacheMissing = protocol === "cli" && connection.offloadSeenImagesForCache === true ? seenImageOffloadCount(requestOptions.messages, options.model) : 0;
    const missing = Math.max(projected.budgetMissing, cacheMissing);
    if (missing > 0) {
      throw imageOffloadRequired(missing, cacheMissing > projected.budgetMissing ? "cache" : "budget");
    }
    let messagesPermissionRejection;
    let body = provisionalBody !== void 0 && protocol === provisionalProtocol ? await provisionalBody : await buildBody(protocol);
    if (maxTokens !== builtMaxTokens) {
      budget.max = Math.min(budget.max, maxTokens);
      if (!omitOutputTokens(connection.maxOutputTokens, protocol, options.maxTokens)) {
        assignMaxTokens(body, protocol, maxTokens);
      }
    }
    const serializedBodies = /* @__PURE__ */ new WeakMap();
    const trace = openStreamTrace(`${options.provider}/${options.model}`);
    const tried = /* @__PURE__ */ new Set();
    let attemptNumber = 0;
    let responseMetadata = { protocol, headers: {} };
    const connectDeps = {
      options,
      connection,
      fetchImpl: this.fetchImpl,
      timing,
      onResponse: (response2) => {
        this.headerTimeoutStreaks.delete(options.sessionId ?? GLOBAL_HEADER_TIMEOUT_KEY);
        responseMetadata = { protocol, headers: responseIdentifiers(response2.headers) };
        trace.record("response", {
          protocol,
          endpoint: protocolEndpoint(protocol, connection.apiBase),
          status: response2.status,
          attempt: attemptNumber,
          accountsTried: tried.size,
          maxTokens,
          ...reasoningEffort === void 0 ? {} : { reasoningEffort },
          headers: responseMetadata.headers
        });
      }
    };
    let connected;
    try {
      for (; ; ) {
        tried.add(apiKey);
        attemptNumber++;
        responseMetadata = { protocol, headers: {} };
        const lower = Math.min(maxTokens, learnedOutputLimit(connection.apiBase, options.model));
        if (lower < maxTokens) {
          maxTokens = lower;
          budget.max = Math.min(budget.max, lower);
          if (!omitOutputTokens(connection.maxOutputTokens, protocol, options.maxTokens)) assignMaxTokens(body, protocol, lower);
          serializedBodies.delete(body);
        }
        budget.sent = maxTokens;
        if (trace.enabled) trace.record("request", {
          attempt: attemptNumber,
          sessionId: options.sessionId,
          ...requestFingerprint(protocol, body)
        });
        let serialized = serializedBodies.get(body);
        if (serialized === void 0) {
          const finishSerialization = timing.phase("serialization");
          try {
            serialized = JSON.stringify(body, (_key, value) => sanitizeSurrogates(value));
          } finally {
            finishSerialization();
          }
          serializedBodies.set(body, serialized);
        }
        const attempt = await connectGenerate(connectDeps, apiKey, protocol, serialized);
        if ("response" in attempt) {
          connected = attempt;
          break;
        }
        const providerError2 = parseProviderError(attempt.errText);
        const messagesPermissionDenied = protocol === "messages" && isMessagesPermissionRejection(attempt.status, providerError2);
        if (protocol !== "cli" && (messagesPermissionDenied || isUpgradeRequiredError(attempt.status, attempt.errText, providerError2))) {
          const wasMessages = protocol === "messages";
          if (messagesPermissionDenied) {
            messagesPermissionRejection = providerError2.code ?? providerError2.type;
          }
          protocol = "cli";
          if (!wasMessages) this.rememberProtocol(connection.apiBase, apiKey, "cli");
          requestOptions = withSurfaceOffload(
            options,
            this.surfaceOffload,
            REQUEST_IMAGE_BUDGETS[0],
            connection.offloadSeenImagesForCache === true ? options.model : void 0
          );
          body = await buildBody("cli");
          continue;
        }
        if (attempt.status === 413 && REQUEST_IMAGE_BUDGETS.length > 1) {
          const missing2 = this.surfaceOffload.requiredImageOffload(
            requestOptions.messages,
            coreBudget(REQUEST_IMAGE_BUDGETS[1]),
            imageVersionBytes
          );
          if (missing2 > 0) throw imageOffloadRequired(missing2);
        }
        const rotate = this.deps.rotateApiKey;
        const rejection = classifyAccountRejection(attempt.status, attempt.errText, providerError2);
        if (rejection !== void 0 && rotate !== void 0 && options.signal?.aborted !== true && tried.size < MAX_ACCOUNT_ROTATIONS) {
          const next = await rotate(apiKey, rejection.reason, connection, options.model, {
            tried: [...tried],
            ...rejection.resetAtMs !== void 0 && { resetAtMs: rejection.resetAtMs }
          });
          if (next !== void 0 && !tried.has(next)) {
            apiKey = next;
            messagesPermissionRejection = void 0;
            const nextProtocol = this.resolveProtocol(connection, apiKey, options.model, modelEntry);
            if (nextProtocol !== protocol) {
              protocol = nextProtocol;
              requestOptions = withSurfaceOffload(
                options,
                this.surfaceOffload,
                REQUEST_IMAGE_BUDGETS[0],
                connection.offloadSeenImagesForCache === true && protocol === "cli" ? options.model : void 0
              );
              body = await buildBody(protocol);
            }
            continue;
          }
        }
        if (rejection !== void 0 && (rejection.reason === "rate-limit" || rejection.reason === "throttled")) {
          const reset = rejection.resetAtMs;
          const wait = reset === void 0 ? attempt.retryAfterMs ?? 0 : Math.min(Math.max(1e3, reset - Date.now()), RETRY_MAX_DELAY_MS);
          const when = reset === void 0 ? void 0 : new Date(reset).toISOString();
          const window = rejection.reason === "rate-limit";
          throw bilingual(
            window ? "RATE_LIMIT" : THROTTLED_CODE,
            (window ? "llm-commandcode: the Command Code account is rate limited" : "llm-commandcode: the Command Code account is rate limited (429) — the provider did not report an exhausted usage window") + (when === void 0 ? "" : ` — the provider reports it resets at ${when}`),
            (window ? "当前 Command Code 账户已被限流" : "当前 Command Code 账户被限流（429），服务商未报告用量窗口用尽") + (when === void 0 ? "" : `，服务商给出的重置时间为 ${when}`),
            { status: attempt.status, ...wait > 0 && wait <= RETRY_MAX_DELAY_MS ? { providerRetryAfterMs: wait } : {} }
          );
        }
        throw generateHttpError(
          attempt.status,
          attempt.errText,
          attempt.retryAfterMs,
          providerError2,
          messagesPermissionRejection
        );
      }
    } catch (error) {
      trace.record("connect-error", { message: boundTraceText(errorChain2(error)), responseMetadata });
      trace.close();
      if (options.signal?.aborted) throw error;
      throw failureWithRequestId(
        this.gradeHeaderTimeout(
          error,
          protocol,
          body,
          connection.requestTimeoutMs,
          options.sessionId,
          serializedBodies.get(body)
        ),
        responseMetadata
      );
    }
    if (connected === void 0) {
      throw new LlmError6("Command Code API connection failed without a response", "TRANSPORT");
    }
    const { response, cleanup } = connected;
    yield* settleStreamResponse(response, {
      protocol,
      signal: options.signal,
      maxTokens,
      apiBase: connection.apiBase,
      streamIdleTimeoutMs: connection.streamIdleTimeoutMs,
      cleanup,
      trace,
      timing,
      responseMetadata
    });
  }
};
export {
  CommandCodeAccountPool,
  CommandCodeAdapter,
  KNOWN_EFFORTS,
  KNOWN_IMAGE_MODELS,
  KNOWN_PLANS,
  PLAN_ORDER,
  accountUsable,
  assertUsableApiKey,
  dealLabel,
  peakPricingLabel
};
