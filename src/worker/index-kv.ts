import { sha256Hex } from "./util"

export async function getAccountByApiKey(
  env: Env,
  apiKey: string,
): Promise<{ account_id: string; key_id: string } | null> {
  const h = await sha256Hex(apiKey)
  const v = await env.INDEX.get(`key:${h}`, "json")
  return v as { account_id: string; key_id: string } | null
}

export async function setApiKey(
  env: Env,
  apiKey: string,
  accountId: string,
  keyId: string,
): Promise<void> {
  const h = await sha256Hex(apiKey)
  await env.INDEX.put(
    `key:${h}`,
    JSON.stringify({ account_id: accountId, key_id: keyId }),
  )
}

export async function deleteApiKey(env: Env, apiKey: string): Promise<void> {
  const h = await sha256Hex(apiKey)
  await env.INDEX.delete(`key:${h}`)
}

export async function deleteApiKeyByHash(
  env: Env,
  hash: string,
): Promise<void> {
  await env.INDEX.delete(`key:${hash}`)
}

export interface Session {
  account_id: string
  email: string | null
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const CLI_SIGN_IN_TTL_SECONDS = 15 * 60

export async function createSession(
  env: Env,
  sess: Session,
): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "")
  await env.INDEX.put(`sess:${id}`, JSON.stringify(sess), {
    expirationTtl: SESSION_TTL_SECONDS,
  })
  return id
}

export async function getSession(env: Env, id: string): Promise<Session | null> {
  const v = await env.INDEX.get(`sess:${id}`, "json")
  return v as Session | null
}

export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.INDEX.delete(`sess:${id}`)
}

export async function createCliSignInToken(
  env: Env,
  sess: Session,
): Promise<string> {
  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  await env.INDEX.put(`cli-signin:${token}`, JSON.stringify(sess), {
    expirationTtl: CLI_SIGN_IN_TTL_SECONDS,
  })
  return token
}

export async function consumeCliSignInToken(
  env: Env,
  token: string,
): Promise<Session | null> {
  const key = `cli-signin:${token}`
  const sess = (await env.INDEX.get(key, "json")) as Session | null
  if (sess) await env.INDEX.delete(key)
  return sess
}
