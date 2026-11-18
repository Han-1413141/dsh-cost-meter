/** Keep startup in one module so parallel plugin imports cannot delay the hook behind UI dependencies. */
import { installBillionAuto } from '../lib/billion-context-auto.js'

// Hold the launch observer while dependencies load. The real plugin owns the
// applied lifetime, including tools that reload lib/index.js directly.
const releaseLoading = installBillionAuto()
let plugin
try { plugin = await import(new URL('./index.js' + new URL(import.meta.url).search, import.meta.url).href) }
catch (error) { releaseLoading(); throw error }
const loadingTimer = setTimeout(releaseLoading, 0)
loadingTimer.unref?.()

export const name = 'cost-meter'
export function apply(ctx) {
  clearTimeout(loadingTimer)
  try { return plugin.apply(ctx) }
  finally { releaseLoading() }
}
