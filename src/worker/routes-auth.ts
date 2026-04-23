import {
  deviceStart,
  devicePollOnce,
  upsertAccount,
  type DevicePollInput,
} from "./signin"
import { createSession, deleteSession, getSession } from "./index-kv"
import {
  error,
  json,
  parseCookie,
  rateLimit,
  requireJson,
  requireSameOrigin,
  setCookieHeader,
} from "./util"

export const SESSION_COOKIE = "chatfaucet_session"

export async function authStatus(req: Request, env: Env): Promise<Response> {
  const sid = parseCookie(req.headers.get("cookie"), SESSION_COOKIE)
  if (!sid) return json({ signedIn: false })
  const sess = await getSession(env, sid)
  if (!sess) return json({ signedIn: false })
  return json({
    signedIn: true,
    email: sess.email,
    accountId: sess.account_id,
  })
}

export async function handleDeviceStart(
  req: Request,
  env: Env,
): Promise<Response> {
  const limited = await rateLimit(env, req, "device-start", 20, 60)
  if (limited) return limited
  return deviceStart()
}

export function mkSessionCookie(env: Env, sid: string): string {
  return setCookieHeader(SESSION_COOKIE, sid, {
    domain: env.APP_HOSTNAME,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "Lax",
  })
}

export function clearSessionCookie(env: Env): string {
  return setCookieHeader(SESSION_COOKIE, "", {
    domain: env.APP_HOSTNAME,
    maxAge: 0,
    sameSite: "Lax",
  })
}

export async function handleDevicePoll(
  req: Request,
  env: Env,
): Promise<Response> {
  const limited = await rateLimit(env, req, "device-poll", 120, 60)
  if (limited) return limited
  const badJson = requireJson(req)
  if (badJson) return badJson

  const input = (await req.json().catch(() => null)) as DevicePollInput | null
  if (
    !input ||
    typeof input.device_auth_id !== "string" ||
    typeof input.user_code !== "string"
  ) {
    return error("device_auth_id and user_code required", 400)
  }

  const r = await devicePollOnce(input)
  if (r.status !== "success") {
    return json(r, r.status === "error" ? 500 : 200)
  }

  const up = await upsertAccount(env, r.tokens!, r.email ?? null)

  const sid = await createSession(env, {
    account_id: up.accountId,
    email: up.email,
  })

  return json(
    { status: "success", email: up.email },
    200,
    { "set-cookie": mkSessionCookie(env, sid) },
  )
}

export async function handleSignOut(
  req: Request,
  env: Env,
): Promise<Response> {
  const badOrigin = requireSameOrigin(req, env)
  if (badOrigin) return badOrigin

  const sid = parseCookie(req.headers.get("cookie"), SESSION_COOKIE)
  if (sid) await deleteSession(env, sid)
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(env) })
}

export async function requireSession(
  req: Request,
  env: Env,
): Promise<{ session: import("./index-kv").Session; sid: string } | Response> {
  const sid = parseCookie(req.headers.get("cookie"), SESSION_COOKIE)
  if (!sid) return error("not signed in", 401)
  const sess = await getSession(env, sid)
  if (!sess) return error("session expired", 401)
  return { session: sess, sid }
}
