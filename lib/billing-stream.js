/**
 * llm/stream 计费包裹(issue #48 包装路由重复计费修复)。
 *
 * 宿主的 `llm/stream` 是一条监听器瀑布:每次 ctx.llm.stream() 都会把全部
 * 监听器按注册序串起来。modlens / vision-router 这类包装路由插件的适配器
 * 在自己 stream() 体内再次调用 ctx.llm.stream({ ..., provider: upstream })
 * ——于是同一次请求沿 `wrapper-vision → wrapper → official` 每层都完整走
 * 一遍瀑布,链尾的计费监听器每层都把 usage 记进账本(同 token 逐位相同 ×3)。
 *
 * 修复:用 AsyncLocalStorage 标记「正在计费消费的流」。外层计费包装在标记
 * 内拉取下游 chunk;下游适配器体内再发起的 ctx.llm.stream() 在同一异步上
 * 下文中同步分发瀑布,内层计费监听器读到标记即判定为嵌套调用,直接透传
 * next() 不再包一层(也就不再记账)。usage 只由最外层记一次。
 *
 * ALS 按异步上下文隔离:两个并发请求各自从无标记的根上下文进入,互不误伤。
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/** 嵌套深度标记:值恒为 1(存在即嵌套);按异步上下文隔离,并发流互不串扰。 */
const llmStreamDepth = new AsyncLocalStorage()

/**
 * 创建 llm/stream 计费监听器。
 * @param {object} deps
 * @param {(usage: object, model: string, sessionId: string, atMs: number, provider: string) => void} deps.account
 *   计费回调:流结束时以捕获的 usage 块调用(五参签名与 ledger.account 对齐,
 *   由 index.js 负责把 usage 五桶映射过去)。
 * @returns {(options: object, next: () => AsyncIterable) => AsyncIterable} 宿主监听器。
 */
export function createLlmStreamBilling({ account }) {
  return (options, next) => {
    const downstream = next()
    // 嵌套内层(包装路由在上层计费流的消费上下文中再发起的 llm/stream):
    // 外层已记账,透传下游流,不再包裹。
    if (llmStreamDepth.getStore() !== undefined) return downstream
    return (async function* costMeterStream() {
      let usage = null
      const iterator = downstream[Symbol.asyncIterator]()
      try {
        for (;;) {
          // 在深度标记内拉取下游:下游适配器(modlens 等)体内再发起的
          // ctx.llm.stream() 同步瀑布分发继承 depth=1,其监听器判定为嵌套。
          const result = await llmStreamDepth.run(1, () => iterator.next())
          if (result.done) break
          const chunk = result.value
          if (chunk !== null && chunk !== undefined && chunk.type === 'usage' && chunk.usage !== undefined) {
            usage = chunk.usage
          }
          yield chunk
        }
      } finally {
        if (usage !== null) {
          try {
            account(usage, options?.model, options?.sessionId, Date.now(), options?.provider)
          } catch (error) {
            console.warn(`[dsh-cost-meter] 计费失败: ${String(error)}`)
          }
        }
      }
    })()
  }
}
