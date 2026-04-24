import { routeAgentRequest } from "agents"
import { AccountDO, AccountDOEncrypted } from "./AccountDO"
import { PlaygroundAgent } from "./PlaygroundAgent"
import {
  authStatus,
  handleDeviceStart,
  handleDevicePoll,
  handleSignOut,
  requireSession,
} from "./routes-auth"
import { listKeys, createKey, revokeKey } from "./routes-keys"
import { handleResponses, handleModels, handleUsage } from "./routes-v1"
import { cliUploadTokens, cliBrowserSignIn } from "./routes-cli"
import {
  deleteAccountByApiKey,
  deleteAccountBySession,
} from "./routes-account"
import { sessionUsage } from "./routes-usage"
import { listDocs, getDoc } from "./routes-docs"
import { error, withSecurityHeaders } from "./util"

export { AccountDO, AccountDOEncrypted, PlaygroundAgent }

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return withSecurityHeaders(await handleRequest(request, env, ctx))
  },
} satisfies ExportedHandler<Env>

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
    const url = new URL(request.url)
    const p = url.pathname
    if (url.hostname === `www.${env.APP_HOSTNAME}`) {
      url.hostname = env.APP_HOSTNAME
      return Response.redirect(url.toString(), 308)
    }

    if (p === "/healthz") return new Response("ok")

    if (p === "/v1/responses" && request.method === "POST") {
      return handleResponses(request, env, ctx)
    }
    if (p === "/v1/models" && request.method === "GET") {
      return handleModels(request, env, ctx)
    }
    if (p === "/v1/usage" && request.method === "GET") {
      return handleUsage(request, env, ctx)
    }
    if (p === "/v1/account" && request.method === "DELETE") {
      return deleteAccountByApiKey(request, env)
    }

    if (p === "/api/auth/status") return authStatus(request, env)
    if (p === "/api/auth/device-start" && request.method === "POST")
      return handleDeviceStart(request, env)
    if (p === "/api/auth/device-poll" && request.method === "POST")
      return handleDevicePoll(request, env)
    if (p === "/api/auth/sign-out" && request.method === "POST")
      return handleSignOut(request, env)

    if (p === "/api/keys" && request.method === "GET")
      return listKeys(request, env)
    if (p === "/api/keys" && request.method === "POST")
      return createKey(request, env)
    const keyMatch = p.match(/^\/api\/keys\/([^/]+)$/)
    if (keyMatch && request.method === "DELETE")
      return revokeKey(request, env, keyMatch[1]!)

    if (p === "/api/usage" && request.method === "GET")
      return sessionUsage(request, env)
    if (p === "/api/account" && request.method === "DELETE")
      return deleteAccountBySession(request, env)

    if (p.startsWith("/agents/")) {
      const s = await requireSession(request, env)
      if (s instanceof Response) return s
      const parts = p.split("/").filter(Boolean)
      if (parts.length < 3) return error("invalid agent path", 400)
      parts[2] = s.session.account_id
      const pinned = new URL(request.url)
      pinned.pathname = "/" + parts.join("/")
      const res = await routeAgentRequest(new Request(pinned, request), env)
      if (res) return res
      return error("agent route not found", 404)
    }

    if (p === "/api/cli/upload-tokens" && request.method === "POST")
      return cliUploadTokens(request, env)
    const cliSignInMatch = p.match(/^\/api\/cli\/sign-in\/([^/]+)$/)
    if (cliSignInMatch && request.method === "GET")
      return cliBrowserSignIn(cliSignInMatch[1]!, env)

    if (p === "/api/docs") return listDocs()
    const docMatch = p.match(/^\/api\/docs\/([a-z0-9-]+)$/)
    if (docMatch) return getDoc(docMatch[1]!, request)

    if (p.startsWith("/api/") || p.startsWith("/v1/")) {
      return error("not found", 404)
    }

    if (p === "/docs" || p === "/docs.md" || p.startsWith("/docs/")) {
      const accept = request.headers.get("accept") || ""
      const wantsMd =
        p === "/docs.md" ||
        p.endsWith(".md") ||
        accept.includes("text/markdown") ||
        accept.includes("text/x-markdown")
      if (wantsMd) return getDoc("index", request)
    }

    const assetResp = await env.ASSETS.fetch(request)
    const out = new Response(assetResp.body, assetResp)
    out.headers.set("cdn-cache-control", "no-store")
    return out
}
