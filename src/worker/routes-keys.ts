import { requireSession } from "./routes-auth"
import { setApiKey, deleteApiKeyByHash } from "./index-kv"
import {
  error,
  json,
  randomSlug,
  rateLimit,
  requireJson,
  requireSameOrigin,
  sha256Hex,
} from "./util"
import type { ApiKey } from "./AccountDO"

const KEY_PREFIX = "chf_"

function mintRawKey(): string {
  return `${KEY_PREFIX}${randomSlug(40)}`
}

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId)
  return env.ACCOUNT_DO.get(id)
}

function publicKey(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    revoked_at: k.revoked_at,
  }
}

export async function listKeys(req: Request, env: Env): Promise<Response> {
  const s = await requireSession(req, env)
  if (s instanceof Response) return s
  const stub = getStub(env, s.session.account_id)
  const keys = await stub.listKeys()
  return json({ keys: keys.map(publicKey) })
}

export async function createKey(req: Request, env: Env): Promise<Response> {
  const badOrigin = requireSameOrigin(req, env)
  if (badOrigin) return badOrigin
  const badJson = requireJson(req)
  if (badJson) return badJson

  const s = await requireSession(req, env)
  if (s instanceof Response) return s
  const limited = await rateLimit(
    env,
    req,
    "create-key",
    20,
    60 * 60,
    s.session.account_id,
  )
  if (limited) return limited

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const name = (body.name ?? "default").slice(0, 64) || "default"

  const raw = mintRawKey()
  const hash = await sha256Hex(raw)
  const prefix = raw.slice(0, 12)
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16)

  const stub = getStub(env, s.session.account_id)
  const rec: ApiKey = {
    id,
    name,
    prefix,
    hash,
    created_at: Math.floor(Date.now() / 1000),
    last_used_at: null,
    revoked_at: null,
  }
  await stub.insertKey(rec)
  await setApiKey(env, raw, s.session.account_id, id)

  return json({ id, name, prefix, key: raw, created_at: rec.created_at })
}

export async function revokeKey(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const badOrigin = requireSameOrigin(req, env)
  if (badOrigin) return badOrigin

  const s = await requireSession(req, env)
  if (s instanceof Response) return s
  const stub = getStub(env, s.session.account_id)

  const keys = await stub.listKeys()
  const target = keys.find((k) => k.id === id)
  if (!target) return error("key not found", 404)

  const ok = await stub.revokeKey(id)
  if (ok) await deleteApiKeyByHash(env, target.hash)
  return json({ ok })
}
