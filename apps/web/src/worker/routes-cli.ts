import type { ApiKey } from "./AccountDO";
import {
  decodeJwtExp,
  extractAccountId,
  extractEmail,
  refreshWithCodex,
  type StoredTokens,
} from "./codex-auth";
import {
  consumeCliSignInToken,
  createCliSignInToken,
  createSession,
  getAccountByApiKey,
  setApiKey,
} from "./index-kv";
import { mkSessionCookie } from "./routes-auth";
import { upsertAccount } from "./signin";
import {
  error,
  json,
  randomSlug,
  rateLimit,
  requireJson,
  sha256Hex,
} from "./util";

const KEY_PREFIX = "chf_";
const CLI_SIGN_IN_PREFIX = "/api/cli/sign-in/";

function mintRawKey(): string {
  return `${KEY_PREFIX}${randomSlug(40)}`;
}

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId);
  return env.ACCOUNT_DO.get(id);
}

function publicKey(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    revoked_at: k.revoked_at,
  };
}

async function authCliKey(
  req: Request,
  env: Env
): Promise<{ accountId: string; keyId: string } | Response> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return error("missing Bearer token", 401);

  const row = await getAccountByApiKey(env, m[1]!.trim());
  if (!row) return error("invalid api key", 401);
  return { accountId: row.account_id, keyId: row.key_id };
}

async function createApiKey(
  env: Env,
  accountId: string,
  name: string
): Promise<{ id: string; key: string; prefix: string; created_at: number }> {
  const raw = mintRawKey();
  const hash = await sha256Hex(raw);
  const prefix = raw.slice(0, 12);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const rec: ApiKey = {
    id,
    name,
    prefix,
    hash,
    created_at: Math.floor(Date.now() / 1000),
    last_used_at: null,
    revoked_at: null,
  };
  const stub = getStub(env, accountId);
  await stub.insertKey(rec);
  await setApiKey(env, raw, accountId, id);
  return { id, key: raw, prefix, created_at: rec.created_at };
}

async function finishCliAuth(
  env: Env,
  accountId: string,
  email: string | null,
  keyName: string
): Promise<Response> {
  const key = await createApiKey(env, accountId, keyName);
  const signInToken = await createCliSignInToken(env, {
    account_id: accountId,
    email,
  });
  return json({
    ok: true,
    status: "success",
    email,
    base_url: `https://${env.APP_HOSTNAME}`,
    api_key: key.key,
    key_id: key.id,
    sign_in_url: `https://${env.APP_HOSTNAME}${CLI_SIGN_IN_PREFIX}${signInToken}`,
  });
}

export async function cliExistingLogin(
  req: Request,
  env: Env
): Promise<Response> {
  const auth = await authCliKey(req, env);
  if (auth instanceof Response) return auth;
  const limited = await rateLimit(
    env,
    req,
    "cli-existing-login",
    20,
    60,
    auth.accountId
  );
  if (limited) return limited;

  const stub = getStub(env, auth.accountId);
  const meta = await stub.getMeta();
  const signInToken = await createCliSignInToken(env, {
    account_id: auth.accountId,
    email: meta?.email ?? null,
  });
  return json({
    ok: true,
    status: "success",
    email: meta?.email ?? null,
    base_url: `https://${env.APP_HOSTNAME}`,
    key_id: auth.keyId,
    sign_in_url: `https://${env.APP_HOSTNAME}${CLI_SIGN_IN_PREFIX}${signInToken}`,
  });
}

export async function cliCreateKey(req: Request, env: Env): Promise<Response> {
  const badJson = requireJson(req);
  if (badJson) return badJson;

  const auth = await authCliKey(req, env);
  if (auth instanceof Response) return auth;
  const limited = await rateLimit(
    env,
    req,
    "cli-create-key",
    20,
    60 * 60,
    auth.accountId
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const key = await createApiKey(
    env,
    auth.accountId,
    (body.name ?? "cli").slice(0, 64) || "cli"
  );
  const meta = await getStub(env, auth.accountId).getMeta();
  const signInToken = await createCliSignInToken(env, {
    account_id: auth.accountId,
    email: meta?.email ?? null,
  });
  return json({
    ok: true,
    status: "success",
    email: meta?.email ?? null,
    base_url: `https://${env.APP_HOSTNAME}`,
    api_key: key.key,
    key_id: key.id,
    sign_in_url: `https://${env.APP_HOSTNAME}${CLI_SIGN_IN_PREFIX}${signInToken}`,
  });
}

export async function cliListKeys(req: Request, env: Env): Promise<Response> {
  const auth = await authCliKey(req, env);
  if (auth instanceof Response) return auth;
  const limited = await rateLimit(
    env,
    req,
    "cli-list-keys",
    60,
    60,
    auth.accountId
  );
  if (limited) return limited;

  const stub = getStub(env, auth.accountId);
  const [meta, keys] = await Promise.all([stub.getMeta(), stub.listKeys()]);
  return json({
    email: meta?.email ?? null,
    active_key_id: auth.keyId,
    keys: keys.map(publicKey),
  });
}

export async function cliUploadTokens(
  req: Request,
  env: Env
): Promise<Response> {
  const limited = await rateLimit(env, req, "cli-upload-tokens", 10, 60);
  if (limited) return limited;
  const badJson = requireJson(req);
  if (badJson) return badJson;

  const body = (await req.json().catch(() => null)) as {
    refresh_token?: string;
    id_token?: string;
    access_token?: string;
    account_id?: string;
    key_name?: string;
  } | null;
  if (!body) return error("invalid json", 400);
  if (!body.refresh_token) return error("refresh_token required", 400);

  const refreshed = await refreshWithCodex(body.refresh_token).catch(
    (e) => e as Error
  );
  if (refreshed instanceof Error) {
    return error("token refresh failed", 400);
  }

  const newAccessToken = refreshed.access_token;
  const newRefreshToken = refreshed.refresh_token ?? body.refresh_token;
  const newIdToken = refreshed.id_token ?? body.id_token;
  if (!newIdToken) {
    return error("token response missing id_token", 400);
  }

  const accountId = body.account_id || extractAccountId(newIdToken);
  if (!accountId) return error("could not resolve account id", 400);

  const tokens: StoredTokens = {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    id_token: newIdToken,
    account_id: accountId,
    access_token_exp: decodeJwtExp(newAccessToken),
    last_refresh: Math.floor(Date.now() / 1000),
  };

  const up = await upsertAccount(env, tokens, extractEmail(newIdToken));
  return finishCliAuth(
    env,
    up.accountId,
    up.email,
    (body.key_name ?? "cli").slice(0, 64) || "cli"
  );
}

export async function cliBrowserSignIn(
  token: string,
  env: Env
): Promise<Response> {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return signInLinkError(
      "This sign-in link is malformed. Run `bunx chatfaucet login --name agent` again to get a fresh link.",
      400
    );
  }

  const sess = await consumeCliSignInToken(env, token);
  if (!sess) {
    return signInLinkError(
      "This sign-in link is expired or has already been used. Run `bunx chatfaucet login --name agent` again to get a new one.",
      410
    );
  }

  const sid = await createSession(env, sess);
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": mkSessionCookie(env, sid),
    },
  });
}

function signInLinkError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
