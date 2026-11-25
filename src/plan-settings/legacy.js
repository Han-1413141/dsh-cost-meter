// Older main bundles await mount(); forward them to the same editor as a fresh page.
window.__ModuleLoader__.load({ id: 'dsh-cost-meter', chunk: 'client.plan-settings.js', factory: require => ({
  mount: helpers => require.async('./client.plan-accounts.js').then(module => module.mount(helpers)),
}) })
