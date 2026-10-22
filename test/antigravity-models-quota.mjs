import assert from 'node:assert/strict'
import { queryGatewayQuota, GATEWAY_MANAGEMENT_PATHS } from '../lib/gateway-quotas.js'
import { parseAntigravityQuota, GATEWAY_PROVIDER_ADAPTERS } from '../lib/gateway-quota-adapters.js'

// 1. Adapter requests() should omit project when project_id is 'aicode-consumers'
{
  const requestsWithConsumers = GATEWAY_PROVIDER_ADAPTERS.antigravity.requests({ projectId: 'aicode-consumers' })
  assert.equal(requestsWithConsumers.length, 3)
  assert.equal(requestsWithConsumers[0].data, undefined, 'aicode-consumers project is omitted to avoid 401')

  assert.equal(GATEWAY_PROVIDER_ADAPTERS.antigravity.requests({ project_id: ' aicode-consumers ' })[0].data, undefined)
  const requestsWithRealProject = GATEWAY_PROVIDER_ADAPTERS.antigravity.requests({ projectId: 'my-corp-project' })
  assert.equal(requestsWithRealProject.length, 3)
  assert.deepEqual(JSON.parse(requestsWithRealProject[0].data), { project: 'my-corp-project' }, 'real project is preserved')
}

// 2. parseAntigravityQuota pure parser tests with models payload
{
  const modelsPayload = {
    models: {
      'gemini-3-flash': {
        quotaInfo: {
          remainingFraction: 0.85,
          resetTime: '2026-10-22T12:00:00Z',
        },
      },
      'gemini-2.5-pro': {
        quotaInfo: {
          remainingFraction: 0.85,
          resetTime: '2026-10-22T12:00:00Z',
        },
      },
    },
  }
  modelsPayload.models['gemini-2.5-pro'].quotaInfo = { remainingFraction: 0.15, resetTime: '2026-10-22T14:00:00Z' }
  const parsedOnlyModels = parseAntigravityQuota(modelsPayload)
  assert.equal(parsedOnlyModels.windows.length, 2)
  assert.equal(parsedOnlyModels.windows[0].id, 'gemini-model:gemini-3-flash')
  assert.equal(parsedOnlyModels.windows[0].label, 'gemini-3-flash')
  assert.equal(parsedOnlyModels.windows[0].percent, 15)
  assert.equal(parsedOnlyModels.windows[0].resetsAt, '2026-10-22T12:00:00.000Z')
  assert.equal(parsedOnlyModels.windows[1].percent, 85, 'different Gemini models retain their own limits')
  assert.equal(parsedOnlyModels.windows[1].resetsAt, '2026-10-22T14:00:00.000Z')
  assert.equal(parsedOnlyModels.windows[1].scope, 'model')
  assert.deepEqual(parseAntigravityQuota({ models: Object.fromEntries(Object.entries(modelsPayload.models).reverse()) }).windows.reverse(), parsedOnlyModels.windows, 'model order does not change quota identity or values')

  // Both summary groups and models combined
  const combinedPayload = {
    groups: [
      {
        displayName: 'Claude and GPT models',
        buckets: [{ window: '5h', remainingFraction: 0.9 }],
      },
    ],
    models: modelsPayload.models,
  }

  // Not geminiOnly: both Claude/GPT and Gemini Models are included
  const parsedBoth = parseAntigravityQuota(combinedPayload, { geminiOnly: false })
  assert.equal(parsedBoth.windows.length, 3)
  assert.ok(parsedBoth.windows.some(w => w.label.includes('Claude / GPT')))
  assert.ok(parsedBoth.windows.some(w => w.label === 'gemini-3-flash'))

  // geminiOnly: true: only Gemini Models window is retained
  const parsedGeminiOnly = parseAntigravityQuota(combinedPayload, { geminiOnly: true })
  assert.equal(parsedGeminiOnly.windows.length, 2)
  assert.equal(parsedGeminiOnly.windows[0].label, 'gemini-3-flash')
  assert.equal(parsedGeminiOnly.windows[0].percent, 15)

  // When summary already has Gemini Models, models are not duplicated
  const existingGemini = {
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [{ window: '5h', remainingFraction: 0.7 }],
      },
    ],
    models: modelsPayload.models,
  }
  const parsedNoDup = parseAntigravityQuota(existingGemini)
  assert.equal(parsedNoDup.windows.length, 1)
  assert.equal(parsedNoDup.windows[0].percent, 30)
}

// 3. End-to-end gateway query with fetchAvailableModels fallback
{
  const source = {
    id: 'ag-gemini-test',
    type: 'cliproxyapi',
    enabled: true,
    display: 'both',
    baseURL: 'http://127.0.0.1:8317',
    includeProviders: ['antigravity'],
  }
  const ctx = {
    get: key => key === 'credentials' ? { resolve: async () => ({ value: 'KEY', source: 'env' }) } : undefined,
  }

  const requestedUrls = []
  const result = await queryGatewayQuota(
    ctx,
    { ...source, antigravityOnlyGemini: true },
    {
      fetchImpl: async (url, init) => {
        if (new URL(url).pathname === GATEWAY_MANAGEMENT_PATHS.authFiles) {
          return new Response(JSON.stringify({
            auth_files: [{
              auth_index: 'ag-test-idx',
              provider: 'antigravity',
              project_id: 'aicode-consumers',
            }],
          }))
        }
        assert.equal(new URL(url).pathname, GATEWAY_MANAGEMENT_PATHS.apiCall)
        const req = JSON.parse(init.body)
        requestedUrls.push(req.url)

        // Verify that aicode-consumers is not passed as project
        assert.ok(!req.data || !req.data.includes('aicode-consumers'), 'aicode-consumers must not be in data')

        if (req.url.includes('retrieveUserQuotaSummary')) {
          // Upstream returns only third-party groups
          return new Response(JSON.stringify({
            status_code: 200,
            body: JSON.stringify({
              groups: [{
                displayName: 'Claude and GPT models',
                buckets: [{ window: '5h', remainingFraction: 0.95 }],
              }],
            }),
          }))
        }

        if (req.url.includes('fetchAvailableModels')) {
          return new Response(JSON.stringify({
            status_code: 200,
            body: JSON.stringify({
              models: {
                'gemini-3.5-flash-lite': {
                  displayName: 'Gemini 3.5 Flash Lite',
                  quotaInfo: {
                    remainingFraction: 0.92,
                    resetTime: '2026-10-22T14:30:00Z',
                  },
                },
              },
            }),
          }))
        }

        return new Response(JSON.stringify({ status_code: 404, body: '{}' }))
      },
    },
  )

  assert.equal(result.status, 'ok')
  assert.equal(result.accounts[0].status, 'ok')
  assert.equal(result.accounts[0].windows.length, 1, 'geminiOnly keeps exactly the Gemini window')
  assert.equal(result.accounts[0].windows[0].label, 'Gemini 3.5 Flash Lite')
  assert.equal(result.accounts[0].windows[0].percent, 8)
  assert.ok(requestedUrls.some(u => u.includes('fetchAvailableModels')), 'fetchAvailableModels was requested')
}

// A Gemini group name without a valid bucket must still reach the models fallback.
const fallbackCase = async (cancel = false) => {
  const calls = [], controller = new AbortController()
  const result = await queryGatewayQuota({ get: key => key === 'credentials' ? { resolve: async () => ({ value: 'KEY', source: 'env' }) } : undefined },
    { id: 'fallback', type: 'cliproxyapi', enabled: true, display: 'both', baseURL: 'http://127.0.0.1:8317', includeProviders: ['antigravity'] },
    { signal: controller.signal, fetchImpl: async (url, init) => {
      if (new URL(url).pathname === GATEWAY_MANAGEMENT_PATHS.authFiles) return Response.json({ auth_files: [{ auth_index: 'idx', provider: 'antigravity', project_id: 'aicode-consumers' }] })
      const request = JSON.parse(init.body); calls.push(request.url)
      if (request.url.includes('retrieveUserQuotaSummary')) return Response.json({ status_code: 200, body: JSON.stringify({ groups: [
        { displayName: 'Gemini Models', buckets: [] }, { displayName: 'Claude and GPT models', buckets: [{ window: '5h', remainingFraction: 0.9 }] },
      ] }) })
      if (cancel) { controller.abort(); assert.equal(init.signal.aborted, true); throw controller.signal.reason }
      const count = calls.filter(url => url.includes('fetchAvailableModels')).length
      return Response.json({ status_code: 200, body: JSON.stringify({ models: { 'gemini-3-flash': { quotaInfo: { remainingFraction: count === 1 ? 2 : 0.7 } } } }) })
    } })
  return { result, calls }
}
{
  const { result, calls } = await fallbackCase()
  assert.equal(calls.filter(url => url.includes('fetchAvailableModels')).length, 2, 'invalid models data does not stop endpoint fallback')
  assert.ok(result.accounts[0].windows.some(row => row.id === 'gemini-model:gemini-3-flash' && row.percent === 30))
}
{
  const { result, calls } = await fallbackCase(true)
  assert.equal(calls.filter(url => url.includes('fetchAvailableModels')).length, 1, 'cancellation stops fallback requests')
  assert.notEqual(result.accounts[0].status, 'ok', 'a cancelled query cannot publish a successful quota')
}

console.log('[ok] Antigravity: per-model quota fallback, project suppression, validation, cancellation and geminiOnly filtering passed')
