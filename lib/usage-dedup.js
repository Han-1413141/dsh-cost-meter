/**
 * usage 指纹窗口去重(issue #76,统一收口 #48 / #70)。
 *
 * 背景:modlens 等包装路由插件会把同一份 usage 经上游 llm.stream 再转发一次
 * (#48 / #70)。#70 时代的修复是对包装层 provider 的 usage「一律丢弃、只记
 * 上游真实流」——但当整条链路都是包装型 id 时(如 modlens 转售路由
 * modlens-go-ds4f,上游不再产生独立的非包装流),唯一到达的 usage 也被丢弃,
 * 整单漏计(#76 实测:会话日志有 usage,账本 sessions=0,今日费用恒 ¥0)。
 *
 * 修复:改用指纹窗口去重。同一会话内,(model, 五桶逐位指纹) 相同的样本在
 * 窗口期(默认 10s,包装层与上游两次分发的间隔量级)内只入账一次:
 *  - 非包装样本只查「已入账的改挂样本」:命中 = 包装层先到的转发对,跳过;
 *    合法的两次同量普通调用互不去重(与旧行为一致,零回归)。
 *  - 包装样本先经 wrapperUpstreamProvider 改挂上游 id(与 modlens-wrapper-
 *    dedup-v1 历史清洗同口径),再查两个集合:命中任一即跳过(上游先到 /
 *    包装层重复分发)。
 * 两种到达顺序都恰好入账一次,且都挂在用户可见请求的语义上游 id 下。
 *
 * 代价:同会话同模型五桶逐位相同、间隔小于窗口的两次包装链调用会被合并为
 * 一次(流式 usage 含缓存读数,逐位相同概率可忽略;#48/#70 的观察也证实
 * 转发对恰是逐位相同)。窗口过期后照常入账。
 */

import { isWrapperProviderId, wrapperUpstreamProvider } from './pricing.js'

/** 与投影折叠(lib/index.js)/历史回放(lib/backfill.js)共用的窗口宽度。 */
export const USAGE_DEDUP_WINDOW_MS = 10_000

/**
 * (model, 五桶) 指纹:逐位精确比较。包装转发的双份 usage 实测逐位相同
 * (issue #48 报告「同 token 逐位相同 ×3」),无需模糊。
 */
export function usageFingerprint(model, buckets) {
  return [
    String(model ?? ''),
    buckets?.input ?? 0,
    buckets?.output ?? 0,
    buckets?.cacheRead ?? 0,
    buckets?.cacheWrite ?? 0,
    buckets?.reasoning ?? 0,
  ].join('|')
}

/**
 * 创建账本入账路径(llm/stream 钩子)用的去重器。
 * @param {{ windowMs?: number, now?: () => number, maxEntries?: number }} [options]
 *   - windowMs:指纹窗口宽度,默认 USAGE_DEDUP_WINDOW_MS。
 *   - now:时钟源(atMs 缺失/非法时兜底),测试注入用。
 *   - maxEntries:单会话单集合的容量上限(异常高频场景的内存护栏)。
 */
export function createUsageDeduper({ windowMs = USAGE_DEDUP_WINDOW_MS, now = Date.now, maxEntries = 128 } = {}) {
  // key:sessionId('' = 无会话的辅助调用)→ { plain, remapped }。
  // plain:非包装样本指纹 → 时刻;remapped:包装层改挂样本指纹 → 时刻。
  const sessions = new Map()

  const sweep = (book, t) => {
    for (const [fp, at] of book) {
      if (t - at > windowMs) book.delete(fp)
    }
  }

  // 会话条目懒裁剪:条目在窗口内必然被访问到(有活跃指纹),把窗口外彻底
  // 空掉的条目删除即可让 Map 收敛到活跃会话量级。超过阈值才扫描一次,
  // 摊薄每次入账的开销。
  const pruneIfNeeded = () => {
    if (sessions.size <= 1024) return
    for (const [key, entry] of sessions) {
      if (entry.plain.size === 0 && entry.remapped.size === 0) sessions.delete(key)
    }
  }

  return {
    /**
     * 判定一条 usage 是否入账,并登记指纹。
     * @param {string} sessionId - 会话 id(可为空串/undefined)。
     * @param {string} model - 模型 id。
     * @param {string} provider - 原始 provider(可为包装层 id;非字符串视为空)。
     * @param {object} buckets - 五桶 { input, output, cacheRead, cacheWrite, reasoning }。
     * @param {number} atMs - 请求发起时刻(epoch ms)。
     * @returns {string | null} 应入账的 provider id(包装层已改挂上游);
     *   null = 窗口内判定为重复转发,调用方应跳过入账。
     */
    admit(sessionId, model, provider, buckets, atMs) {
      const prov = typeof provider === 'string' ? provider : ''
      const wrapped = isWrapperProviderId(prov)
      const effective = wrapped ? (wrapperUpstreamProvider(prov) ?? prov) : prov
      const key = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : ''
      const t = Number.isFinite(atMs) && atMs > 0 ? atMs : now()
      const fp = usageFingerprint(model, buckets)
      let entry = sessions.get(key)
      if (entry === undefined) {
        entry = { plain: new Map(), remapped: new Map() }
        sessions.set(key, entry)
      }
      sweep(entry.plain, t)
      sweep(entry.remapped, t)
      pruneIfNeeded()
      const book = wrapped ? entry.remapped : entry.plain
      // 包装样本与普通样本、改挂样本都互斥;普通样本只与改挂样本互斥。
      if (wrapped ? (entry.plain.has(fp) || entry.remapped.has(fp)) : entry.remapped.has(fp)) {
        return null
      }
      book.set(fp, t)
      if (book.size > maxEntries) {
        // 容量护栏:淘汰最旧条目(窗口语义只关心最近的转发对)。
        let oldestFp = null
        let oldestAt = Infinity
        for (const [candidateFp, at] of book) {
          if (at < oldestAt) { oldestAt = at; oldestFp = candidateFp }
        }
        if (oldestFp !== null) book.delete(oldestFp)
      }
      return effective
    },
  }
}
