#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const HOST = process.env.CHATFAUCET_HOST || "chatfaucet.com";
const BASE = `https://${HOST}`;
const CONFIG = join(homedir(), ".chatfaucet.json");

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_ISSUER = "https://auth.openai.com";
const CALLBACK_HOST = process.env.CHATFAUCET_CALLBACK_HOST || "127.0.0.1";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";

interface Config {
  api_key: string;
  base_url: string;
  email: string | null;
  key_id: string;
}

interface LoginResult extends Config {
  sign_in_url?: string;
}

interface ExistingLoginResult {
  base_url: string;
  email: string | null;
  key_id: string;
  sign_in_url?: string;
}

interface KeyListResult {
  active_key_id: string;
  email: string | null;
  keys: Array<{
    created_at: number;
    id: string;
    last_used_at: number | null;
    name: string;
    prefix: string;
    revoked_at: number | null;
  }>;
}

async function readConfig(): Promise<Config | null> {
  try {
    return JSON.parse(await readFile(CONFIG, "utf8")) as Config;
  } catch {
    return null;
  }
}

async function readCredentials(): Promise<{
  base_url: string;
  api_key: string;
  email: string | null;
} | null> {
  const c = await readConfig();
  if (c?.api_key) {
    return c;
  }

  const apiKey = process.env.CHATFAUCET_API_KEY;
  const baseUrl = process.env.CHATFAUCET_BASE_URL;
  if (!(apiKey && baseUrl)) {
    return null;
  }
  return {
    api_key: apiKey,
    base_url: baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, ""),
    email: null,
  };
}

async function writeConfig(c: Config) {
  await mkdir(homedir(), { recursive: true }).catch(() => {});
  await writeFile(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 });
}

function base64url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePkce(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = randomBytes(16).toString("hex");
  return { verifier, challenge, state };
}

function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(`${CODEX_ISSUER}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "chatfaucet");
  return url.toString();
}

function openBrowser(url: string): void {
  const plat = platform();
  const cmd =
    plat === "darwin" ? "open" : plat === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // ignore — user can click the printed URL
  }
}

const SUCCESS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat Faucet — signed in</title><style>html,body{margin:0;padding:0;background:#0b0b0b;color:#eaeaea;font-family:ui-monospace,Menlo,Monaco,monospace}main{max-width:480px;margin:6rem auto;padding:0 1.25rem;line-height:1.55}h1{font-size:1.05rem;font-weight:600;letter-spacing:-0.01em;margin:0 0 0.75rem}p{font-size:0.95rem;opacity:0.8;margin:0 0 0.5rem}code{background:rgba(255,255,255,0.08);padding:0.1em 0.35em;border-radius:3px}</style></head><body><main><h1>Signed in to Chat Faucet</h1><p>You can close this tab and return to your terminal.</p></main></body></html>`;

const ERROR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat Faucet — sign-in failed</title><style>html,body{margin:0;padding:0;background:#0b0b0b;color:#eaeaea;font-family:ui-monospace,Menlo,Monaco,monospace}main{max-width:480px;margin:6rem auto;padding:0 1.25rem;line-height:1.55}h1{font-size:1.05rem;font-weight:600;letter-spacing:-0.01em;margin:0 0 0.75rem;color:#ff8e8e}p{font-size:0.95rem;opacity:0.8;margin:0 0 0.5rem}</style></head><body><main><h1>Sign-in failed</h1><p>Close this tab, return to your terminal, and run <code>bunx chatfaucet login</code> again.</p></main></body></html>`;

async function startCallbackServer(state: string): Promise<Promise<string>> {
  let onReady: (() => void) | null = null;
  let onReadyError: ((err: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    onReady = resolve;
    onReadyError = reject;
  });
  const codePromise = new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, code?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      server.close();
      if (err) {
        reject(err);
      } else {
        resolve(code!);
      }
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const parsed = new URL(
        req.url || "/",
        `http://localhost:${CALLBACK_PORT}`
      );
      if (parsed.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end("not found");
        return;
      }
      const code = parsed.searchParams.get("code");
      const gotState = parsed.searchParams.get("state");
      if (!code || gotState !== state) {
        res.statusCode = 400;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(ERROR_HTML);
        finish(new Error("state mismatch or missing code in callback"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(SUCCESS_HTML);
      finish(null, code);
    });
    server.on("error", (e: NodeJS.ErrnoException) => {
      const err =
        e.code === "EADDRINUSE"
          ? new Error(
              `port ${CALLBACK_PORT} is in use (likely the Codex or Pi CLI). Close that process and rerun \`chatfaucet login\`.`
            )
          : e;
      finish(err);
      onReadyError?.(err);
    });
    server.listen(CALLBACK_PORT, CALLBACK_HOST, () => onReady?.());
  });
  codePromise.catch(() => {});
  await ready;
  return codePromise;
}

async function exchangeCode(
  code: string,
  verifier: string
): Promise<{
  access_token: string;
  refresh_token: string;
  id_token: string;
}> {
  const r = await fetch(`${CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!r.ok) {
    throw new Error(`token exchange failed: ${r.status} ${await r.text()}`);
  }
  const j = (await r.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
  };
  if (!(j.access_token && j.refresh_token && j.id_token)) {
    throw new Error("token response missing access/refresh/id token");
  }
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    id_token: j.id_token,
  };
}

function decodeJwt(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return {};
  }
  const padded = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4);
  try {
    const bytes = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(bytes) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractAccountId(idToken: string): string {
  const claims = decodeJwt(idToken) as {
    "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    chatgpt_account_id?: string;
    organizations?: Array<{ id: string }>;
  };
  return (
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.chatgpt_account_id ??
    claims.organizations?.[0]?.id ??
    ""
  );
}

async function uploadTokens(
  tokens: {
    refresh_token: string;
    id_token: string;
    access_token: string;
    account_id: string;
  },
  name: string
): Promise<LoginResult> {
  const r = await fetch(`${BASE}/api/cli/upload-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokens, key_name: name }),
  });
  if (!r.ok) {
    throw new Error(`upload-tokens failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as LoginResult;
}

async function existingLogin(c: Config): Promise<LoginResult | null> {
  const r = await fetch(`${c.base_url}/api/cli/existing-login`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.api_key}` },
  });
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    return null;
  }
  if (!r.ok) {
    throw new Error(`existing-login failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as ExistingLoginResult;
  return {
    api_key: c.api_key,
    base_url: body.base_url,
    email: body.email,
    key_id: body.key_id,
    sign_in_url: body.sign_in_url,
  };
}

async function createKeyFromConfig(
  c: Config,
  name: string
): Promise<LoginResult> {
  const r = await fetch(`${c.base_url}/api/cli/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.api_key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    throw new Error(`create key failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as LoginResult;
}

async function browserFlow(name: string): Promise<LoginResult> {
  const { verifier, challenge, state } = generatePkce();
  const authUrl = buildAuthorizeUrl(challenge, state);
  const waitPromise = await startCallbackServer(state);

  console.log("");
  console.log("  Opening your browser to sign in with ChatGPT…");
  console.log(`  If it doesn't open, visit: ${authUrl}`);
  console.log("");
  console.log("  Waiting for authorization…");
  openBrowser(authUrl);

  const code = await waitPromise;
  const exchanged = await exchangeCode(code, verifier);
  const accountId = extractAccountId(exchanged.id_token);
  return uploadTokens(
    {
      refresh_token: exchanged.refresh_token,
      id_token: exchanged.id_token,
      access_token: exchanged.access_token,
      account_id: accountId,
    },
    name
  );
}

function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0 && args[i + 1]) {
    return args[i + 1];
  }
  return;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function cmdLogin(args: string[]) {
  const name = getArg(args, "--name") ?? "cli";
  const force = hasFlag(args, "--force");
  const existing = force ? null : await readConfig();
  const login = existing ? await existingLogin(existing) : null;
  if (login) {
    await writeConfig({
      base_url: login.base_url,
      api_key: login.api_key,
      email: login.email,
      key_id: login.key_id,
    });
    console.log("");
    console.log(`  Already signed in as ${login.email ?? "(email unknown)"}`);
    console.log(`  Base URL:   ${login.base_url}`);
    console.log(`  API Key:    ${login.api_key}`);
    if (login.sign_in_url) {
      console.log(`  Sign-in link: ${login.sign_in_url}`);
      console.log(
        "  Open this link to view the dashboard. It expires in 15 minutes and can be used once."
      );
    }
    console.log("");
    console.log(`  Saved to ${CONFIG}`);
    console.log("");
    console.log("  Run `chatfaucet env` to get shell exports.");
    return;
  }
  if (existing) {
    console.log(
      "  Saved Chat Faucet key is no longer valid; opening browser sign-in."
    );
  }
  const browserLogin = await browserFlow(name);
  const cfg: Config = {
    base_url: browserLogin.base_url,
    api_key: browserLogin.api_key,
    email: browserLogin.email,
    key_id: browserLogin.key_id,
  };
  await writeConfig(cfg);
  console.log("");
  console.log(`  Signed in as ${cfg.email ?? "(email unknown)"}`);
  console.log(`  Base URL:   ${cfg.base_url}`);
  console.log(`  API Key:    ${cfg.api_key}`);
  if (browserLogin.sign_in_url) {
    console.log(`  Sign-in link: ${browserLogin.sign_in_url}`);
    console.log(
      "  Open this link to view the dashboard. It expires in 15 minutes and can be used once."
    );
  }
  console.log("");
  console.log(`  Saved to ${CONFIG}`);
  console.log("");
  console.log("  Run `chatfaucet env` to get shell exports.");
}

async function cmdKeysCreate(args: string[]) {
  const name = getArg(args, "--name") ?? "cli";
  const c = await readConfig();
  if (!c) {
    throw new Error("not logged in — run `chatfaucet login`");
  }
  const login = await createKeyFromConfig(c, name);
  const cfg: Config = {
    base_url: login.base_url,
    api_key: login.api_key,
    email: login.email,
    key_id: login.key_id,
  };
  await writeConfig(cfg);
  console.log("");
  console.log(`  Created key "${name}" for ${cfg.email ?? "(email unknown)"}`);
  console.log(`  Base URL:   ${cfg.base_url}`);
  console.log(`  API Key:    ${cfg.api_key}`);
  if (login.sign_in_url) {
    console.log(`  Sign-in link: ${login.sign_in_url}`);
    console.log(
      "  Open this link to view the dashboard. It expires in 15 minutes and can be used once."
    );
  }
  console.log("");
  console.log(`  Saved to ${CONFIG}`);
}

async function cmdEnv() {
  const c = await readConfig();
  if (!c) {
    throw new Error("not logged in — run `chatfaucet login`");
  }
  console.log(`export OPENAI_API_KEY="${c.api_key}"`);
  console.log(`export OPENAI_BASE_URL="${c.base_url}/v1"`);
  console.log(`export CHATFAUCET_API_KEY="${c.api_key}"`);
  console.log(`export CHATFAUCET_BASE_URL="${c.base_url}"`);
}

async function cmdKeysList() {
  const c = await readConfig();
  if (!c) {
    throw new Error("not logged in — run `chatfaucet login`");
  }
  const r = await fetch(`${c.base_url}/api/cli/keys`, {
    headers: { Authorization: `Bearer ${c.api_key}` },
  });
  if (!r.ok) {
    throw new Error(`keys failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as KeyListResult;
  console.log(`Logged in as ${body.email ?? c.email ?? "(email unknown)"}`);
  console.log("");
  for (const key of body.keys) {
    const active = key.id === body.active_key_id ? " *" : "";
    const status = key.revoked_at ? "revoked" : "active";
    const used = key.last_used_at
      ? new Date(key.last_used_at * 1000).toISOString()
      : "never";
    console.log(
      `${key.prefix}…  ${key.name}  ${status}${active}  last_used=${used}`
    );
  }
  console.log("");
  console.log(`* marks the key saved in ${CONFIG}`);
  console.log(`Manage keys at ${c.base_url}/`);
}

async function cmdLogout() {
  await rm(CONFIG, { force: true }).catch(() => {});
  console.log(
    "  Cleared local config. Your account and keys still exist on the server."
  );
  console.log(`  Revoke keys at ${BASE}/`);
}

async function cmdDeleteAccount(args: string[]) {
  if (!hasFlag(args, "--yes")) {
    throw new Error(
      "delete-account permanently removes your account and all API keys; rerun with --yes"
    );
  }
  const c = await readCredentials();
  if (!c) {
    throw new Error(
      "not logged in — run `chatfaucet login` or set CHATFAUCET_API_KEY and CHATFAUCET_BASE_URL"
    );
  }
  const r = await fetch(`${c.base_url}/v1/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.api_key}` },
  });
  if (!r.ok) {
    throw new Error(`delete-account failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as { deleted_keys?: number };
  await rm(CONFIG, { force: true }).catch(() => {});
  console.log(
    `  Deleted account and ${body.deleted_keys ?? 0} API key record(s).`
  );
  console.log(`  Removed ${CONFIG}`);
}

function help() {
  console.log(`Chat Faucet — your ChatGPT plan as an OpenAI-compatible Responses API

Usage:
  chatfaucet login [--name <label>] [--force]
  chatfaucet env
  chatfaucet keys
  chatfaucet keys create [--name <label>]
  chatfaucet logout
  chatfaucet delete-account --yes
  chatfaucet --help

Env:
  CHATFAUCET_HOST   Override the gateway host (default: chatfaucet.com)
  CHATFAUCET_API_KEY and CHATFAUCET_BASE_URL can be used for headless API-key commands
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd) {
      case "login":
        await cmdLogin(rest);
        break;
      case "env":
        await cmdEnv();
        break;
      case "keys":
        if (rest[0] === "create") {
          await cmdKeysCreate(rest.slice(1));
        } else {
          await cmdKeysList();
        }
        break;
      case "logout":
        await cmdLogout();
        break;
      case "delete-account":
        await cmdDeleteAccount(rest);
        break;
      case undefined:
      case "-h":
      case "--help":
      case "help":
        help();
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        help();
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
