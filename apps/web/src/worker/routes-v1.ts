import { getActiveAccountByApiKey } from "./index-kv";
import { getActiveAppByApiKey, getAppConnection } from "./routes-apps";
import { error, rateLimit } from "./util";

const CODEX_PREFIX = "/codex";
const WHAM_PREFIX = "/wham";
const DEFAULT_CODEX_CLIENT_VERSION = "0.124.0";

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId);
  return env.ACCOUNT_DO.get(id);
}

async function authAndResolve(
  req: Request,
  env: Env
): Promise<
  { accountId: string; keyId: string; rateLimitSubject: string } | Response
> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return error("missing Bearer token", 401);
  const apiKey = m[1]!.trim();

  const row = await getActiveAccountByApiKey(env, apiKey);
  if (row) {
    return {
      accountId: row.account_id,
      keyId: row.key_id,
      rateLimitSubject: row.key_id,
    };
  }

  const app = await getActiveAppByApiKey(env, apiKey);
  if (!app) return error("invalid api key", 401);

  const connectionId =
    req.headers.get("chatfaucet-connection") ??
    req.headers.get("x-chatfaucet-connection");
  if (!connectionId) {
    return error("missing ChatFaucet-Connection header", 401);
  }

  const connection = await getAppConnection(env, connectionId.trim());
  if (
    !connection ||
    connection.app_id !== app.app_id ||
    connection.revoked_at != null
  ) {
    return error("invalid app connection", 401);
  }

  return {
    accountId: connection.account_id,
    keyId: app.key_id,
    rateLimitSubject: `${app.app_id}:${app.key_id}:${connection.connection_id}`,
  };
}

async function proxy(
  req: Request,
  env: Env,
  accountId: string,
  upstreamPath: string,
  opts: { useBody: boolean; defaultQuery?: Record<string, string> } = {
    useBody: true,
  }
): Promise<Response> {
  const stub = getStub(env, accountId);
  const tokens = await stub.ensureFreshToken().catch(() => null);
  if (!tokens) return error("token refresh failed; sign in again", 401);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${tokens.access_token}`);
  headers.set("chatgpt-account-id", tokens.account_id);
  headers.set("originator", "codex_cli_rs");
  headers.set("User-Agent", "chatfaucet");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("X-Proxy-Secret", env.PROXY_SECRET);

  const passThrough = [
    "content-type",
    "accept",
    "session_id",
    "x-client-request-id",
  ];
  for (const h of passThrough) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type") && opts.useBody) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) headers.set("accept", "text/event-stream");

  const url = new URL(env.PROXY_URL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${upstreamPath}`;
  const reqUrl = new URL(req.url);
  reqUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });
  for (const [key, value] of Object.entries(opts.defaultQuery ?? {})) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (opts.useBody && req.body) {
    init.body = req.body;
  }

  const upstream = await fetch(url, init);
  const respHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-encoding" || k === "content-length") return;
    respHeaders.set(key, value);
  });
  if (!respHeaders.has("content-type")) {
    respHeaders.set(
      "content-type",
      upstreamPath.endsWith("/responses")
        ? "text/event-stream; charset=utf-8"
        : "application/json; charset=utf-8"
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export async function handleResponses(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const a = await authAndResolve(req, env);
  if (a instanceof Response) return a;
  const limited = await rateLimit(
    env,
    req,
    "v1-responses",
    120,
    60,
    a.rateLimitSubject
  );
  if (limited) return limited;
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId));
  const normalized = await normalizeResponsesRequest(req);
  return proxy(normalized, env, a.accountId, `${CODEX_PREFIX}/responses`);
}

export async function handleModels(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const a = await authAndResolve(req, env);
  if (a instanceof Response) return a;
  const limited = await rateLimit(
    env,
    req,
    "v1-models",
    120,
    60,
    a.rateLimitSubject
  );
  if (limited) return limited;
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId));
  return proxy(req, env, a.accountId, `${CODEX_PREFIX}/models`, {
    useBody: false,
    defaultQuery: { client_version: DEFAULT_CODEX_CLIENT_VERSION },
  });
}

export async function handleUsage(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const a = await authAndResolve(req, env);
  if (a instanceof Response) return a;
  const limited = await rateLimit(
    env,
    req,
    "v1-usage",
    120,
    60,
    a.rateLimitSubject
  );
  if (limited) return limited;
  ctx.waitUntil(getStub(env, a.accountId).touchKey(a.keyId));
  return proxy(req, env, a.accountId, `${WHAM_PREFIX}/usage`, {
    useBody: false,
  });
}

async function normalizeResponsesRequest(req: Request): Promise<Request> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return req;
  }

  let body: unknown;
  try {
    body = await req.clone().json();
  } catch {
    return req;
  }

  const normalized = normalizeInputContent(body);
  if (normalized === body) return req;

  return new Request(req, {
    body: JSON.stringify(normalized),
  });
}

function normalizeInputContent(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const normalized = value.map((item) => {
      const next = normalizeInputContent(item);
      changed ||= next !== item;
      return next;
    });
    return changed ? normalized : value;
  }

  if (!isRecord(value)) return value;

  const imagePart = normalizeImagePart(value);
  if (imagePart) return imagePart;

  let changed = false;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = normalizeInputContent(child);
    changed ||= next !== child;
    normalized[key] = next;
  }
  return changed ? normalized : value;
}

function normalizeImagePart(
  value: Record<string, unknown>
): Record<string, unknown> | null {
  if (value.type === "input_image") {
    const imageUrl = normalizeImageUrl(value.image_url);
    if (!imageUrl) return null;

    return {
      ...value,
      image_url: imageUrl,
    };
  }

  if (value.type === "input_file") {
    const fileData = typeof value.file_data === "string" ? value.file_data : "";
    if (!fileData.startsWith("data:image/")) return null;

    const out: Record<string, unknown> = {
      type: "input_image",
      image_url: fileData,
    };
    if (value.detail != null) out.detail = value.detail;
    return out;
  }

  return null;
}

function normalizeImageUrl(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (!isRecord(value)) return null;

  const url = value.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
