import { getAccountByApiKey } from "./index-kv"
import { error, rateLimit } from "./util"

const CODEX_PREFIX = "/codex"
const WHAM_PREFIX = "/wham"
const DEFAULT_CODEX_CLIENT_VERSION = "0.124.0"

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId)
  return env.ACCOUNT_DO.get(id)
}

async function authAndResolve(
  req: Request,
  env: Env,
): Promise<{ accountId: string; keyId: string } | Response> {
  const auth = req.headers.get("authorization") || ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return error("missing Bearer token", 401)
  const apiKey = m[1]!.trim()

  const row = await getAccountByApiKey(env, apiKey)
  if (!row) return error("invalid api key", 401)

  return { accountId: row.account_id, keyId: row.key_id }
}

async function proxy(
  req: Request,
  env: Env,
  accountId: string,
  upstreamPath: string,
  opts: { useBody: boolean; defaultQuery?: Record<string, string> } = {
    useBody: true,
  },
): Promise<Response> {
  const stub = getStub(env, accountId)
  const tokens = await stub.ensureFreshToken().catch(() => null)
  if (!tokens) return error("token refresh failed; sign in again", 401)

  const headers = new Headers()
  headers.set("Authorization", `Bearer ${tokens.access_token}`)
  headers.set("chatgpt-account-id", tokens.account_id)
  headers.set("originator", "codex_cli_rs")
  headers.set("User-Agent", "chatfaucet")
  headers.set("OpenAI-Beta", "responses=experimental")
  headers.set("X-Proxy-Secret", env.PROXY_SECRET)

  const passThrough = [
    "content-type",
    "accept",
    "session_id",
    "x-client-request-id",
  ]
  for (const h of passThrough) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (!headers.has("content-type") && opts.useBody) {
    headers.set("content-type", "application/json")
  }
  if (!headers.has("accept")) headers.set("accept", "text/event-stream")

  const url = new URL(env.PROXY_URL)
  url.pathname = `${url.pathname.replace(/\/$/, "")}${upstreamPath}`
  const reqUrl = new URL(req.url)
  reqUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value)
  })
  for (const [key, value] of Object.entries(opts.defaultQuery ?? {})) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  }
  if (opts.useBody && req.body) {
    init.body = req.body
  }

  const upstream = await fetch(url, init)
  const respHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k === "content-encoding" || k === "content-length") return
    respHeaders.set(key, value)
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  })
}

export async function handleResponses(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const a = await authAndResolve(req, env)
  if (a instanceof Response) return a
  const limited = await rateLimit(env, req, "v1-responses", 120, 60, a.keyId)
  if (limited) return limited
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId))
  return proxy(req, env, a.accountId, `${CODEX_PREFIX}/responses`)
}

export async function handleModels(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const a = await authAndResolve(req, env)
  if (a instanceof Response) return a
  const limited = await rateLimit(env, req, "v1-models", 120, 60, a.keyId)
  if (limited) return limited
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId))
  return proxy(req, env, a.accountId, `${CODEX_PREFIX}/models`, {
    useBody: false,
    defaultQuery: { client_version: DEFAULT_CODEX_CLIENT_VERSION },
  })
}

export async function handleUsage(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const a = await authAndResolve(req, env)
  if (a instanceof Response) return a
  const limited = await rateLimit(env, req, "v1-usage", 120, 60, a.keyId)
  if (limited) return limited
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId))
  return proxy(req, env, a.accountId, `${WHAM_PREFIX}/usage`, {
    useBody: false,
  })
}
