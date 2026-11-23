/**
 * Host-local transport for the Qoder CN connector route. Mirrors
 * lib/workbuddy-transport.js: IP-literal origin guard plus node:http(s) with
 * agent:false, so DSH's global fetch proxy/dispatcher never routes this read.
 */
import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { isIP } from 'node:net'

const unbracket = hostname => hostname.startsWith('[') ? hostname.slice(1, -1) : hostname

/**
 * Validate the running DSH host origin for the connector read.
 *
 * DSH binds exactly one concrete interface literal (wildcard binds are
 * rejected), so the host's own origin is either loopback or a LAN address and
 * is never a DNS name. Accepting any IP literal lets the read follow that bind:
 * a LAN-only host serves no loopback listener. Callers pass only
 * `webServer.getOrigin()`; DNS names stay rejected so a name cannot re-resolve
 * off-host, and credentials, paths, queries, and fragments stay rejected.
 * @param {string} value Origin candidate (http or https; IP literal or localhost; no userinfo, path, query, or hash).
 * @returns {URL} The parsed origin.
 * @throws {{code:'qoderConnectUnavailable'}} When the origin is not a plain IP-literal or localhost http(s) origin.
 */
export function qoderOrigin(value) {
  let url
  try { url = new URL(value) } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash
    || !(url.hostname === 'localhost' || isIP(unbracket(url.hostname)) !== 0)) {
    throw Object.assign(new Error('qoderConnectUnavailable'), { code: 'qoderConnectUnavailable' })
  }
  return url
}

// Host-local reads must not use DSH's global fetch proxy/dispatcher. No credentials,
// redirects, or configurable remote paths; the byte limit includes the whole body.
export function fetchQoderLocal(url, { signal } = {}) {
  const origin = qoderOrigin(new URL(url).origin)
  const request = origin.protocol === 'https:' ? requestHttps : requestHttp
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
