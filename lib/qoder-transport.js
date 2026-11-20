/**
 * Host-local transport for the Qoder CN connector route. Mirrors
 * lib/workbuddy-transport.js: loopback-only origin guard plus node:http with
 * agent:false, so DSH's global fetch proxy/dispatcher never routes this read.
 */
import { request } from 'node:http'

/**
 * Validate a loopback origin for the connector read.
 * @param {string} value Origin candidate (http scheme; 127.0.0.1 / [::1] / localhost; no userinfo, path, query, or hash).
 * @returns {URL} The parsed origin.
 * @throws {{code:'qoderConnectUnavailable'}} When the origin is not loopback-only http.
 */
export function qoderOrigin(value) {
  let url
  try { url = new URL(value) } catch {}
  if (!url || url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Object.assign(new Error('qoderConnectUnavailable'), { code: 'qoderConnectUnavailable' })
  }
  return url
}

// Host-local reads must not use DSH's global fetch proxy/dispatcher. No credentials,
// redirects, or configurable remote paths; the byte limit includes the whole body.
export function fetchQoderLocal(url, { signal } = {}) {
  qoderOrigin(new URL(url).origin)
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: false, signal, headers: { accept: 'application/json', 'accept-encoding': 'identity' } }, res => {
      const chunks = []; let bytes = 0
      res.on('error', reject)
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > 1024 * 1024) { res.destroy(new Error('Qoder response too large')); return }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const status = res.statusCode ?? 502
        if (status >= 300 && status < 400) { reject(new TypeError('fetch failed: redirect refused')); return }
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), {
          status, headers: { 'content-type': res.headers['content-type'] ?? '' },
        }))
      })
    })
    req.on('error', reject)
    req.setTimeout(35000, () => req.destroy(new Error('Qoder query timed out')))
    req.end()
  })
}