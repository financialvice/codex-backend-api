const UPSTREAM = "https://chatgpt.com/backend-api"
const SECRET = process.env.PROXY_SECRET
if (!SECRET) throw new Error("PROXY_SECRET env var is required")

const ALLOWED_PREFIXES = ["/codex/", "/wham/"]

const PASS_THROUGH_HEADERS = new Set([
  "authorization",
  "chatgpt-account-id",
  "originator",
  "user-agent",
  "openai-beta",
  "accept",
  "content-type",
  "session_id",
  "x-client-request-id",
])

Bun.serve({
  port: Number(process.env.PORT ?? 8080),
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/healthz") return new Response("ok")

    if (!ALLOWED_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return new Response("Not found", { status: 404 })
    }

    if (req.headers.get("x-proxy-secret") !== SECRET) {
      return new Response("Unauthorized", { status: 401 })
    }

    const forwardHeaders = new Headers()
    req.headers.forEach((value, key) => {
      if (PASS_THROUGH_HEADERS.has(key.toLowerCase())) {
        forwardHeaders.set(key, value)
      }
    })

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method,
      headers: forwardHeaders,
      body: req.body,
    })

    const respHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase()
      if (k === "content-encoding" || k === "content-length" || k === "set-cookie") return
      respHeaders.set(key, value)
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    })
  },
})

console.log(`chatfaucet proxy listening on :${process.env.PORT ?? 8080}`)
