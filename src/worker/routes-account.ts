import { getAccountByApiKey, deleteApiKeyByHash } from "./index-kv"
import { requireSession, clearSessionCookie } from "./routes-auth"
import { error, json } from "./util"

function getStub(env: Env, accountId: string) {
  const id = env.ACCOUNT_DO.idFromName(accountId)
  return env.ACCOUNT_DO.get(id)
}

async function deleteIndexObjectsForAccount(
  env: Env,
  prefix: string,
  accountId: string,
) {
  let cursor: string | undefined
  do {
    const page = await env.INDEX.list({ prefix, cursor })
    await Promise.all(
      page.keys.map(async (key) => {
        const item = await env.INDEX.get<{
          account_id?: string
        }>(key.name, "json")
        if (item?.account_id === accountId) {
          await env.INDEX.delete(key.name)
        }
      }),
    )
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
}

export async function deleteAccountData(env: Env, accountId: string) {
  const stub = getStub(env, accountId)
  const keys = await stub.listKeys()
  await Promise.all(keys.map((key) => deleteApiKeyByHash(env, key.hash)))
  await stub.purge()
  await Promise.all([
    deleteIndexObjectsForAccount(env, "sess:", accountId),
    deleteIndexObjectsForAccount(env, "cli-signin:", accountId),
  ])
  return { deleted_keys: keys.length }
}

function accountFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || ""
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? null
}

export async function deleteAccountByApiKey(
  req: Request,
  env: Env,
): Promise<Response> {
  const apiKey = accountFromBearer(req)
  if (!apiKey) return error("missing Bearer token", 401)

  const row = await getAccountByApiKey(env, apiKey)
  if (!row) return error("invalid api key", 401)

  const result = await deleteAccountData(env, row.account_id)
  return json({ ok: true, ...result })
}

export async function deleteAccountBySession(
  req: Request,
  env: Env,
): Promise<Response> {
  const s = await requireSession(req, env)
  if (s instanceof Response) return s

  const result = await deleteAccountData(env, s.session.account_id)
  return json(
    { ok: true, ...result },
    200,
    { "set-cookie": clearSessionCookie(env) },
  )
}
