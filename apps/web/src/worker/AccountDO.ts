import { DurableObject } from "cloudflare:workers";
import {
  decodeJwtExp,
  refreshWithCodex,
  type StoredTokens,
} from "./codex-auth";
import { decryptJson, encryptJson } from "./token-crypto";

const REFRESH_MARGIN_SECONDS = 300;

export interface ApiKey {
  created_at: number;
  hash: string;
  id: string;
  last_used_at: number | null;
  name: string;
  prefix: string;
  revoked_at: number | null;
  [key: string]: SqlStorageValue;
}

export interface AccountMeta {
  account_id: string;
  created_at: number;
  email: string | null;
  updated_at: number;
}

export class AccountDO extends DurableObject<Env> {
  private refreshInFlight: Promise<StoredTokens> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          prefix TEXT NOT NULL,
          hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER,
          revoked_at INTEGER
        )
      `);
    });
  }

  private getKv(k: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ v: string; [key: string]: SqlStorageValue }>(
        "SELECT v FROM kv WHERE k = ?",
        k
      )
      .toArray();
    return rows[0]?.v ?? null;
  }

  private setKv(k: string, v: string) {
    this.ctx.storage.sql.exec(
      "INSERT INTO kv(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      k,
      v
    );
  }

  async setMeta(meta: AccountMeta): Promise<void> {
    this.setKv("meta", JSON.stringify(meta));
  }

  async getMeta(): Promise<AccountMeta | null> {
    const v = this.getKv("meta");
    return v ? (JSON.parse(v) as AccountMeta) : null;
  }

  async setTokens(tokens: StoredTokens): Promise<void> {
    this.setKv(
      "tokens",
      await encryptJson(this.env.TOKEN_ENCRYPTION_KEY, tokens)
    );
  }

  async getTokens(): Promise<StoredTokens | null> {
    const v = this.getKv("tokens");
    if (!v) {
      return null;
    }
    return decryptJson<StoredTokens>(this.env.TOKEN_ENCRYPTION_KEY, v);
  }

  async ensureFreshToken(): Promise<StoredTokens> {
    const cur = await this.getTokens();
    if (!cur) {
      throw new Error("no tokens for account");
    }
    const now = Math.floor(Date.now() / 1000);
    if (cur.access_token_exp - now > REFRESH_MARGIN_SECONDS) {
      return cur;
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = (async () => {
      try {
        const body = await refreshWithCodex(cur.refresh_token);
        const next: StoredTokens = {
          ...cur,
          access_token: body.access_token,
          refresh_token: body.refresh_token ?? cur.refresh_token,
          id_token: body.id_token ?? cur.id_token,
          access_token_exp: decodeJwtExp(body.access_token),
          last_refresh: Math.floor(Date.now() / 1000),
        };
        const latest = await this.getTokens();
        if (
          latest &&
          (latest.refresh_token !== cur.refresh_token ||
            latest.last_refresh > cur.last_refresh)
        ) {
          return latest;
        }
        await this.setTokens(next);
        return next;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  async listKeys(): Promise<ApiKey[]> {
    return this.ctx.storage.sql
      .exec<ApiKey>("SELECT * FROM api_keys ORDER BY created_at DESC")
      .toArray();
  }

  async insertKey(k: ApiKey): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT INTO api_keys(id, name, prefix, hash, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      k.id,
      k.name,
      k.prefix,
      k.hash,
      k.created_at,
      k.last_used_at,
      k.revoked_at
    );
  }

  async revokeKey(id: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const res = this.ctx.storage.sql.exec(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      now,
      id
    );
    return res.rowsWritten > 0;
  }

  async touchKey(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.ctx.storage.sql.exec(
      "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
      now,
      id
    );
  }

  async purge(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM kv");
    this.ctx.storage.sql.exec("DELETE FROM api_keys");
  }
}

export class AccountDOEncrypted extends AccountDO {}
