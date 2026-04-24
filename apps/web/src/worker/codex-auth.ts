export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_ISSUER = "https://auth.openai.com";

export interface StoredTokens {
  access_token: string;
  access_token_exp: number;
  account_id: string;
  id_token: string;
  last_refresh: number;
  refresh_token: string;
}

export interface IdTokenClaims {
  chatgpt_account_id?: string;
  email?: string;
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
  organizations?: Array<{ id: string }>;
}

export function decodeJwt<T = Record<string, unknown>>(jwt: string): T {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("invalid jwt");
  }
  const payload = parts[1]!;
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(atob(padded.replace(/-/g, "+").replace(/_/g, "/"))) as T;
}

export function decodeJwtExp(jwt: string): number {
  return decodeJwt<{ exp: number }>(jwt).exp;
}

export function extractAccountId(idToken: string): string | null {
  const claims = decodeJwt<IdTokenClaims>(idToken);
  return (
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.chatgpt_account_id ??
    claims.organizations?.[0]?.id ??
    null
  );
}

export function extractEmail(idToken: string): string | null {
  return decodeJwt<IdTokenClaims>(idToken).email ?? null;
}

export async function refreshWithCodex(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}> {
  const r = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_CLIENT_ID,
    }),
  });
  if (!r.ok) {
    throw new Error(`codex refresh failed: ${r.status}`);
  }
  return (await r.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
  };
}
