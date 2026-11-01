/** Preserve the native chunk/require.async contract when dsh-loader wraps load.
 * dsh-loader 1.3.5 forwards only {id, factory}, discarding chunk and require.async.
 * Use its saved registration function for our own modules; leave the shared
 * facade, other plugins, duplicate-registration errors and HMR unchanged.
 */
export function registerCostMeterClient(registration) {
  const loader = window.__ModuleLoader__
  const wrapper = loader[Symbol.for('@dsh-plugin/dsh-loader:load-wrap')]
  const load = registration.id === 'dsh-cost-meter' && loader.load === wrapper?.ours && typeof wrapper.original === 'function'
    ? wrapper.original : loader.load
  return load.call(loader, registration)
}

export function withClientRegistration(source) {
  const marker = 'window.__ModuleLoader__.load('
  if (source.split(marker).length !== 2) throw Error('Expected one cost-meter client registration')
  return source.replace(marker, () => '(' + registerCostMeterClient.toString() + ')(')
}
