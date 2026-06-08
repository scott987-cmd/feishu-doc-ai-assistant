/**
 * Reference OAuth proxy for the 飞书文档AI助手 extension.
 *
 * WHY: Feishu's token endpoint requires the App Secret even with PKCE, so a pure
 * client can't keep it off the wire. This tiny proxy holds the secret server-side;
 * the extension POSTs only the grant material (code / refresh_token) and gets back
 * tokens. Build the extension with VITE_OAUTH_PROXY_URL pointing here and WITHOUT
 * VITE_FEISHU_APP_SECRET → the secret never ships in the .crx.
 *
 * Deploy as a Cloudflare Worker (or adapt to Vercel/Lambda/an internal service).
 * Set secrets:  FEISHU_APP_ID, FEISHU_APP_SECRET  (wrangler secret put ...).
 * For PRIVATE deployments, also set FEISHU_API_BASE (e.g. https://open.test.com/open-apis).
 *
 * Contract (what the extension sends):
 *   POST <this-url>
 *   { grant_type: "authorization_code", code, redirect_uri, client_id }
 *   { grant_type: "refresh_token", refresh_token, client_id }
 * Response: the Feishu token JSON ({ access_token, refresh_token, expires_in, ... }).
 *
 * SECURITY NOTES:
 *  - Lock CORS `Access-Control-Allow-Origin` to your extension id
 *    (chrome-extension://<id>) instead of "*".
 *  - Optionally verify client_id matches your app and rate-limit by IP.
 *  - This proxy ONLY brokers tokens; it never sees user data — the extension talks to
 *    Feishu directly with the returned user_access_token.
 */

const ALLOWED_GRANTS = new Set(['authorization_code', 'refresh_token'])

// NOTE: this is a MINIMAL reference. For production prefer ../oauth-proxy-server.mjs (adds IP
// allowlist, rate limiting, shared key, and the enterprise llm_config/policy endpoints). This
// worker is hardened to FAIL-CLOSED: it refuses code exchange unless ALLOWED_REDIRECT_URIS and a
// locked ALLOW_ORIGIN are configured — so a careless deploy is not an open token oracle.

export default {
  async fetch(request, env) {
    const ALLOW_ORIGIN = env.ALLOW_ORIGIN || '' // MUST set to chrome-extension://<your id>
    const allowedRedirects = (env.ALLOWED_REDIRECT_URIS || '').split(',').map((s) => s.trim()).filter(Boolean)
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN || 'null',
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors)
    // Fail-closed: never run as an any-origin / no-allowlist token oracle.
    if (!ALLOW_ORIGIN) return json({ error: 'misconfigured: set ALLOW_ORIGIN' }, 500, cors)
    if (!allowedRedirects.length) return json({ error: 'misconfigured: set ALLOWED_REDIRECT_URIS' }, 500, cors)
    const origin = request.headers.get('Origin') || ''
    if (origin && origin !== ALLOW_ORIGIN) return json({ error: 'origin_forbidden' }, 403, cors)

    let body
    try { body = await request.json() } catch { return json({ error: 'bad_json' }, 400, cors) }

    const grant_type = String(body.grant_type || '')
    if (!ALLOWED_GRANTS.has(grant_type)) return json({ error: 'unsupported_grant_type' }, 400, cors)
    if (env.FEISHU_APP_ID && String(body.client_id || '') !== env.FEISHU_APP_ID) return json({ error: 'client_id_forbidden' }, 403, cors)

    // Build the upstream request — the proxy injects the secret; client never sends it.
    const payload = {
      grant_type,
      client_id: env.FEISHU_APP_ID,
      client_secret: env.FEISHU_APP_SECRET,
    }
    if (grant_type === 'authorization_code') {
      const redirect_uri = String(body.redirect_uri || '')
      if (!allowedRedirects.includes(redirect_uri)) return json({ error: 'redirect_uri_forbidden' }, 400, cors)
      payload.code = String(body.code || '')
      payload.redirect_uri = redirect_uri
    } else {
      payload.refresh_token = String(body.refresh_token || '')
    }

    const apiBase = env.FEISHU_API_BASE || 'https://open.feishu.cn/open-apis'
    const upstream = await fetch(`${apiBase}/authen/v2/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await upstream.text()
    return new Response(data, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  },
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}
