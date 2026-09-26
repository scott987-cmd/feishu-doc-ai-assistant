import OpenAI from 'openai'

/**
 * The SDK attaches telemetry headers to every request (X-Stainless-Lang/-OS/-Arch/-Runtime/…,
 * x-stainless-retry-count, x-stainless-timeout, User-Agent). From an extension page none of them
 * is CORS-safelisted, so the browser's preflight asks the provider to allow each one — and a
 * provider whose Access-Control-Allow-Headers lists only the usual authorization/content-type
 * rejects it, which the SDK then reports as a bare "Connection error." even though chatComplete()
 * (plain fetch, llm.ts) to the very same endpoint works. `null` removes a header (the SDK's
 * defaultHeaders contract), leaving the preflight identical to chatComplete's. None of them
 * carries anything the API needs.
 */
const DROPPED_SDK_HEADERS: Record<string, null> = Object.fromEntries([
  'X-Stainless-Lang', 'X-Stainless-Package-Version', 'X-Stainless-OS', 'X-Stainless-Arch',
  'X-Stainless-Runtime', 'X-Stainless-Runtime-Version', 'X-Stainless-Retry-Count', 'X-Stainless-Timeout',
  'User-Agent',
].map((h) => [h, null]))

/**
 * OpenAI-compatible client for the side-panel callers (agent / smart fill / vision). `baseURL` must
 * already have passed assertSafeBaseUrl. `fetchImpl` is a test seam.
 */
export function createLlmClient(baseURL: string, apiKey: string, fetchImpl?: typeof fetch): OpenAI {
  return new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: DROPPED_SDK_HEADERS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}
