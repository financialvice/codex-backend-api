import {
  decodeJwtExp,
  extractAccountId,
  extractEmail,
  refreshWithCodex,
  type StoredTokens,
} from "./codex-auth"
import { upsertAccount, devicePollOnce, deviceStart } from "./signin"
import {
  consumeCliSignInToken,
  createCliSignInToken,
  createSession,
  setApiKey,
} from "./index-kv"
import type { ApiKey } from "./AccountDO"
import { error, json, randomSlug, sha256Hex } from "./util"
import { mkSessionCookie } from "./routes-auth"

const KEY_PREFIX = "cba_"
const CLI_SIGN_IN_PREFIX = "/api/cli/sign-in/"

function mintRawKey(): string {
  return `${KEY_PREFIX}${randomSlug(40)}`
}

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId)
  return env.ACCOUNT_DO.get(id)
}

async function createApiKey(
  env: Env,
  accountId: string,
  name: string,
): Promise<{ id: string; key: string; prefix: string; created_at: number }> {
  const raw = mintRawKey()
  const hash = await sha256Hex(raw)
  const prefix = raw.slice(0, 12)
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  const rec: ApiKey = {
    id,
    name,
    prefix,
    hash,
    created_at: Math.floor(Date.now() / 1000),
    last_used_at: null,
    revoked_at: null,
  }
  const stub = getStub(env, accountId)
  await stub.insertKey(rec)
  await setApiKey(env, raw, accountId, id)
  return { id, key: raw, prefix, created_at: rec.created_at }
}

async function finishCliAuth(
  env: Env,
  accountId: string,
  email: string | null,
  keyName: string,
): Promise<Response> {
  const key = await createApiKey(env, accountId, keyName)
  const signInToken = await createCliSignInToken(env, {
    account_id: accountId,
    email,
  })
  return json({
    ok: true,
    status: "success",
    email,
    base_url: `https://${env.APP_HOSTNAME}`,
    api_key: key.key,
    key_id: key.id,
    sign_in_url:
      `https://${env.APP_HOSTNAME}${CLI_SIGN_IN_PREFIX}${signInToken}`,
  })
}

export async function cliUploadTokens(
  req: Request,
  env: Env,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    refresh_token?: string
    id_token?: string
    access_token?: string
    account_id?: string
    key_name?: string
  } | null
  if (!body) return error("invalid json", 400)
  if (!body.refresh_token) return error("refresh_token required", 400)

  const refreshed = await refreshWithCodex(body.refresh_token).catch(
    (e) => e as Error,
  )
  if (refreshed instanceof Error) {
    return error(`token refresh failed: ${refreshed.message}`, 400)
  }

  const newAccessToken = refreshed.access_token
  const newRefreshToken = refreshed.refresh_token ?? body.refresh_token
  const newIdToken = refreshed.id_token ?? body.id_token
  if (!newIdToken) return error("no id_token available; cannot resolve account", 400)

  const accountId =
    body.account_id ?? extractAccountId(newIdToken) ?? null
  if (!accountId) return error("could not resolve account id", 400)

  const tokens: StoredTokens = {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    id_token: newIdToken,
    account_id: accountId,
    access_token_exp: decodeJwtExp(newAccessToken),
    last_refresh: Math.floor(Date.now() / 1000),
  }

  const up = await upsertAccount(env, tokens, extractEmail(newIdToken))
  return finishCliAuth(
    env,
    up.accountId,
    up.email,
    (body.key_name ?? "cli").slice(0, 64) || "cli",
  )
}

export async function cliDeviceStart(): Promise<Response> {
  return deviceStart()
}

export async function cliDevicePoll(
  req: Request,
  env: Env,
): Promise<Response> {
  const input = (await req.json()) as {
    device_auth_id: string
    user_code: string
    key_name?: string
  }
  const r = await devicePollOnce(input)
  if (r.status !== "success") {
    return json(r, r.status === "error" ? 500 : 200)
  }
  const up = await upsertAccount(env, r.tokens!, r.email ?? null)
  return finishCliAuth(
    env,
    up.accountId,
    up.email,
    (input.key_name ?? "cli").slice(0, 64) || "cli",
  )
}

export async function cliBrowserSignIn(
  token: string,
  env: Env,
): Promise<Response> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return error("invalid sign-in link", 400)

  const sess = await consumeCliSignInToken(env, token)
  if (!sess) {
    return new Response(
      "This sign-in link is expired or has already been used. Run " +
        "`bunx codex-backend-api login --name agent` again to get a new one.",
      {
        status: 410,
        headers: { "content-type": "text/plain; charset=utf-8" },
      },
    )
  }

  const sid = await createSession(env, sess)
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": mkSessionCookie(env, sid),
    },
  })
}
