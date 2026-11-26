import { loadCommandCodeHostModule } from './commandcode-host-module.js'

// Use the running engine's schema and volatile wrapper. Standalone ledger tools
// and older hosts can load the plugin without the Models settings service.
const schema = await loadCommandCodeHostModule('schemastery').catch(() => null)
const z = schema?.default
const field = z?.object?.({}).default({})
export const Config = field?.volatile ? z.object({ commandcode: field.volatile() }) : undefined

export function commandCodeSettingsNamespace(ctx) {
  return ctx?.fiber?.entry?.options?.id || 'cost-meter'
}
