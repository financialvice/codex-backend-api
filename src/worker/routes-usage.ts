import { requireSession } from "./routes-auth"
import { error } from "./util"

export async function sessionUsage(req: Request, env: Env): Promise<Response> {
  const s = await requireSession(req, env)
  if (s instanceof Response) return s

  const id = env.ACCOUNT_DO.idFromName(s.session.account_id)
  const stub = env.ACCOUNT_DO.get(id)
  let tokens
  try {
    tokens = await stub.ensureFreshToken()
  } catch (e) {
    return error("token refresh failed; sign in again", 401)
  }

  const r = await fetch(`${env.PROXY_URL}/wham/usage`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "chatgpt-account-id": tokens.account_id,
      originator: "codex_cli_rs",
      accept: "application/json",
      "X-Proxy-Secret": env.PROXY_SECRET,
    },
  })

  const body = await r.text()
  return new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json" },
  })
}
