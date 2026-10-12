import { API_PREFIX, type ApiErrorBody } from '@ariad/shared'

/**
 * The API client. Same origin, session cookie, JSON both ways.
 *
 * Every failure becomes an ApiError with a message written for a person, so a
 * page can show `error.message` without knowing what went wrong underneath.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Field-level problems from a 400, keyed by field path. */
  get fields(): Record<string, string> {
    if (!Array.isArray(this.details)) return {}
    const out: Record<string, string> = {}
    for (const issue of this.details as { path?: string; message?: string }[]) {
      if (issue.path && issue.message && !(issue.path in out)) out[issue.path] = issue.message
    }
    return out
  }
}

/**
 * `fetch` has no timeout of its own, and a server that accepts a connection
 * and never answers leaves a spinner turning for ever. Sending mail is the
 * slow case — a test email waits on a real SMTP conversation — so the ceiling
 * is generous; it exists to end a hang, not to hurry a request.
 */
const TIMEOUT_MS = 45_000

async function request<T>(method: string, path: string, body?: unknown, init?: { signal?: AbortSignal }): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    if (init?.signal?.aborted) throw error
    const timedOut = (error as Error)?.name === 'TimeoutError'
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'network_error',
      timedOut
        ? 'The server took too long to answer. Check that Ariad is still running, then try again.'
        : 'Could not reach the server. Check your connection and that Ariad is running.',
    )
  }

  if (response.status === 204) return undefined as T
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const envelope = (data as ApiErrorBody | null)?.error
    if (response.status === 401 && envelope?.code === 'unauthorized' && !path.startsWith('/auth/')) {
      // The session ended while the app was open. Tell whoever is listening
      // (the auth gate) so the sign-in page appears instead of a wall of errors.
      window.dispatchEvent(new Event('ariad:signed-out'))
    }
    throw new ApiError(
      response.status,
      envelope?.code ?? 'request_failed',
      envelope?.message ?? `The server answered ${response.status}.`,
      envelope?.details,
    )
  }
  return data as T
}

export const api = {
  get: <T>(path: string, init?: { signal?: AbortSignal }) => request<T>('GET', path, undefined, init),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  delete: <T = { ok: true }>(path: string) => request<T>('DELETE', path),
}

/** `?a=1&b=2` from an object, leaving out anything empty. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
