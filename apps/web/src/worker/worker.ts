import { routeAgentRequest } from "agents";
import {
  deleteAccountByApiKey,
  deleteAccountBySession,
} from "./routes-account";
import {
  authStatus,
  handleDevicePoll,
  handleDeviceStart,
  handleSignOut,
  requireSession,
} from "./routes-auth";
import {
  cliBrowserSignIn,
  cliCreateKey,
  cliExistingLogin,
  cliUploadTokens,
} from "./routes-cli";
import { getDoc, listDocs } from "./routes-docs";
import { createKey, listKeys, revokeKey } from "./routes-keys";
import { sessionUsage } from "./routes-usage";
import { handleModels, handleResponses, handleUsage } from "./routes-v1";
import { error, withSecurityHeaders } from "./util";

// biome-ignore lint/performance/noBarrelFile: Cloudflare Workers entry must re-export Durable Object classes.
export { AccountDO, AccountDOEncrypted } from "./AccountDO";
export { PlaygroundAgent } from "./PlaygroundAgent";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    return withSecurityHeaders(await handleRequest(request, env, ctx));
  },
} satisfies ExportedHandler<Env>;

function handleV1(
  p: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Response | Promise<Response> | null {
  if (p === "/v1/responses" && request.method === "POST")
    return handleResponses(request, env, ctx);
  if (p === "/v1/models" && request.method === "GET")
    return handleModels(request, env, ctx);
  if (p === "/v1/usage" && request.method === "GET")
    return handleUsage(request, env, ctx);
  if (p === "/v1/account" && request.method === "DELETE")
    return deleteAccountByApiKey(request, env);
  return null;
}

function handleApi(
  p: string,
  request: Request,
  env: Env
): Response | Promise<Response> | null {
  if (p === "/api/auth/status") return authStatus(request, env);
  if (p === "/api/auth/device-start" && request.method === "POST")
    return handleDeviceStart(request, env);
  if (p === "/api/auth/device-poll" && request.method === "POST")
    return handleDevicePoll(request, env);
  if (p === "/api/auth/sign-out" && request.method === "POST")
    return handleSignOut(request, env);

  if (p === "/api/keys" && request.method === "GET")
    return listKeys(request, env);
  if (p === "/api/keys" && request.method === "POST")
    return createKey(request, env);
  const keyMatch = p.match(/^\/api\/keys\/([^/]+)$/);
  if (keyMatch && request.method === "DELETE")
    return revokeKey(request, env, keyMatch[1]!);

  if (p === "/api/usage" && request.method === "GET")
    return sessionUsage(request, env);
  if (p === "/api/account" && request.method === "DELETE")
    return deleteAccountBySession(request, env);

  if (p === "/api/cli/upload-tokens" && request.method === "POST")
    return cliUploadTokens(request, env);
  if (p === "/api/cli/existing-login" && request.method === "POST")
    return cliExistingLogin(request, env);
  if (p === "/api/cli/keys" && request.method === "POST")
    return cliCreateKey(request, env);
  const cliSignInMatch = p.match(/^\/api\/cli\/sign-in\/([^/]+)$/);
  if (cliSignInMatch && request.method === "GET")
    return cliBrowserSignIn(cliSignInMatch[1]!, env);

  if (p === "/api/docs") return listDocs();
  const docMatch = p.match(/^\/api\/docs\/([a-z0-9-]+)$/);
  if (docMatch) return getDoc(docMatch[1]!, request);

  return null;
}

async function handleAgents(
  p: string,
  request: Request,
  env: Env
): Promise<Response> {
  const s = await requireSession(request, env);
  if (s instanceof Response) return s;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 3) return error("invalid agent path", 400);
  parts[2] = s.session.account_id;
  const pinned = new URL(request.url);
  pinned.pathname = `/${parts.join("/")}`;
  const res = await routeAgentRequest(new Request(pinned, request), env);
  if (res) return res;
  return error("agent route not found", 404);
}

function handleDocsPage(
  p: string,
  request: Request
): Response | Promise<Response> | null {
  if (!(p === "/docs" || p === "/docs.md" || p.startsWith("/docs/")))
    return null;
  const accept = request.headers.get("accept") || "";
  const wantsMd =
    p === "/docs.md" ||
    p.endsWith(".md") ||
    accept.includes("text/markdown") ||
    accept.includes("text/x-markdown");
  if (wantsMd) return getDoc("index", request);
  return null;
}

async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  if (url.hostname === `www.${env.APP_HOSTNAME}`) {
    url.hostname = env.APP_HOSTNAME;
    return Response.redirect(url.toString(), 308);
  }

  if (p === "/healthz") return new Response("ok");

  const v1 = handleV1(p, request, env, ctx);
  if (v1) return v1;

  const api = handleApi(p, request, env);
  if (api) return api;

  if (p.startsWith("/agents/")) return handleAgents(p, request, env);

  if (p.startsWith("/api/") || p.startsWith("/v1/"))
    return error("not found", 404);

  const doc = handleDocsPage(p, request);
  if (doc) return doc;

  const assetResp = await env.ASSETS.fetch(request);
  const out = new Response(assetResp.body, assetResp);
  out.headers.set("cdn-cache-control", "no-store");
  return out;
}
