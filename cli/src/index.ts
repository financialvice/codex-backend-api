#!/usr/bin/env bun
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomBytes, createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline/promises"

const HOST = process.env.CHATFAUCET_HOST || "chatfaucet.com"
const BASE = `https://${HOST}`
const CONFIG = join(homedir(), ".chatfaucet.json")
const AUTH_JSON = join(homedir(), ".codex", "auth.json")

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const CODEX_ISSUER = "https://auth.openai.com"
const CALLBACK_HOST = process.env.CHATFAUCET_CALLBACK_HOST || "127.0.0.1"
const CALLBACK_PORT = 1455
const CALLBACK_PATH = "/auth/callback"
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
const SCOPE = "openid profile email offline_access"

interface Config {
  base_url: string
  api_key: string
  email: string | null
  key_id: string
}

interface LoginResult extends Config {
  sign_in_url?: string
}

async function readConfig(): Promise<Config | null> {
  try {
    return JSON.parse(await readFile(CONFIG, "utf8")) as Config
  } catch {
    return null
  }
}

async function readCredentials(): Promise<{
  base_url: string
  api_key: string
  email: string | null
} | null> {
  const c = await readConfig()
  if (c?.api_key) return c

  const apiKey = process.env.CHATFAUCET_API_KEY
  const baseUrl = process.env.CHATFAUCET_BASE_URL
  if (!apiKey || !baseUrl) return null
  return {
    api_key: apiKey,
    base_url: baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, ""),
    email: null,
  }
}

async function writeConfig(c: Config) {
  await mkdir(homedir(), { recursive: true }).catch(() => {})
  await writeFile(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 })
}

async function readAuthJson(): Promise<{
  refresh_token: string
  id_token: string
  access_token: string
  account_id: string
} | null> {
  try {
    const raw = await readFile(AUTH_JSON, "utf8")
    const j = JSON.parse(raw) as { tokens?: Record<string, string> }
    const t = j.tokens
    if (!t?.refresh_token || !t?.id_token) return null
    return {
      refresh_token: t.refresh_token,
      id_token: t.id_token,
      access_token: t.access_token ?? "",
      account_id: t.account_id ?? "",
    }
  } catch {
    return null
  }
}

function base64url(bytes: Buffer): string {
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function generatePkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  const state = randomBytes(16).toString("hex")
  return { verifier, challenge, state }
}

function buildAuthorizeUrl(challenge: string, state: string): string {
  const url = new URL(`${CODEX_ISSUER}/oauth/authorize`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", CODEX_CLIENT_ID)
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("scope", SCOPE)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  url.searchParams.set("id_token_add_organizations", "true")
  url.searchParams.set("codex_cli_simplified_flow", "true")
  url.searchParams.set("originator", "chatfaucet")
  return url.toString()
}

function openBrowser(url: string): void {
  const plat = platform()
  const cmd = plat === "darwin" ? "open" : plat === "win32" ? "start" : "xdg-open"
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref()
  } catch {
    // ignore — user can click the printed URL
  }
}

const SUCCESS_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat Faucet — signed in</title><style>html,body{margin:0;padding:0;background:#0b0b0b;color:#eaeaea;font-family:ui-monospace,Menlo,Monaco,monospace}main{max-width:480px;margin:6rem auto;padding:0 1.25rem;line-height:1.55}h1{font-size:1.05rem;font-weight:600;letter-spacing:-0.01em;margin:0 0 0.75rem}p{font-size:0.95rem;opacity:0.8;margin:0 0 0.5rem}code{background:rgba(255,255,255,0.08);padding:0.1em 0.35em;border-radius:3px}</style></head><body><main><h1>Signed in to Chat Faucet</h1><p>You can close this tab and return to your terminal.</p></main></body></html>`

const ERROR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat Faucet — sign-in failed</title><style>html,body{margin:0;padding:0;background:#0b0b0b;color:#eaeaea;font-family:ui-monospace,Menlo,Monaco,monospace}main{max-width:480px;margin:6rem auto;padding:0 1.25rem;line-height:1.55}h1{font-size:1.05rem;font-weight:600;letter-spacing:-0.01em;margin:0 0 0.75rem;color:#ff8e8e}p{font-size:0.95rem;opacity:0.8;margin:0 0 0.5rem}</style></head><body><main><h1>Sign-in failed</h1><p>Close this tab, return to your terminal, and run <code>bunx chatfaucet login</code> again.</p></main></body></html>`

async function waitForCallback(state: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (err: Error | null, code?: string) => {
      if (settled) return
      settled = true
      server.close()
      if (err) reject(err)
      else resolve(code!)
    }
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const parsed = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`)
      if (parsed.pathname !== CALLBACK_PATH) {
        res.statusCode = 404
        res.setHeader("content-type", "text/plain; charset=utf-8")
        res.end("not found")
        return
      }
      const code = parsed.searchParams.get("code")
      const gotState = parsed.searchParams.get("state")
      if (!code || gotState !== state) {
        res.statusCode = 400
        res.setHeader("content-type", "text/html; charset=utf-8")
        res.end(ERROR_HTML)
        finish(new Error("state mismatch or missing code in callback"))
        return
      }
      res.statusCode = 200
      res.setHeader("content-type", "text/html; charset=utf-8")
      res.end(SUCCESS_HTML)
      finish(null, code)
    })
    server.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        finish(
          new Error(
            `port ${CALLBACK_PORT} is in use (likely the Codex or Pi CLI). Close that process and rerun \`chatfaucet login\`.`,
          ),
        )
      } else {
        finish(e)
      }
    })
    server.listen(CALLBACK_PORT, CALLBACK_HOST)
  })
}

async function exchangeCode(
  code: string,
  verifier: string,
): Promise<{
  access_token: string
  refresh_token: string
  id_token: string
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
  })
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${await r.text()}`)
  const j = (await r.json()) as {
    access_token?: string
    refresh_token?: string
    id_token?: string
  }
  if (!j.access_token || !j.refresh_token || !j.id_token) {
    throw new Error("token response missing access/refresh/id token")
  }
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    id_token: j.id_token,
  }
}

function decodeJwt(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".")
  if (parts.length < 2) return {}
  const padded = parts[1]! + "=".repeat((4 - (parts[1]!.length % 4)) % 4)
  try {
    const bytes = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8")
    return JSON.parse(bytes) as Record<string, unknown>
  } catch {
    return {}
  }
}

function extractAccountId(idToken: string): string {
  const claims = decodeJwt(idToken) as {
    "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
    chatgpt_account_id?: string
    organizations?: Array<{ id: string }>
  }
  return (
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims.chatgpt_account_id ??
    claims.organizations?.[0]?.id ??
    ""
  )
}

async function uploadTokens(
  tokens: {
    refresh_token: string
    id_token: string
    access_token: string
    account_id: string
  },
  name: string,
): Promise<LoginResult> {
  const r = await fetch(`${BASE}/api/cli/upload-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...tokens, key_name: name }),
  })
  if (!r.ok) throw new Error(`upload-tokens failed: ${r.status} ${await r.text()}`)
  return (await r.json()) as LoginResult
}

async function browserFlow(name: string): Promise<LoginResult> {
  const { verifier, challenge, state } = generatePkce()
  const authUrl = buildAuthorizeUrl(challenge, state)
  const waitPromise = waitForCallback(state)
  // Small delay so the server is bound before we tell the user to navigate.
  await new Promise((r) => setTimeout(r, 50))

  console.log("")
  console.log("  Opening your browser to sign in with ChatGPT…")
  console.log(`  If it doesn't open, visit: ${authUrl}`)
  console.log("")
  console.log("  Waiting for authorization…")
  openBrowser(authUrl)

  const code = await waitPromise
  const exchanged = await exchangeCode(code, verifier)
  const accountId = extractAccountId(exchanged.id_token)
  return uploadTokens(
    {
      refresh_token: exchanged.refresh_token,
      id_token: exchanged.id_token,
      access_token: exchanged.access_token,
      account_id: accountId,
    },
    name,
  )
}

function getArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  if (i >= 0 && args[i + 1]) return args[i + 1]
  return undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

async function cmdLogin(args: string[]) {
  const name = getArg(args, "--name") ?? "cli"
  const noAuthJson = hasFlag(args, "--no-read-auth-json")
  const assumeYes = hasFlag(args, "-y") || hasFlag(args, "--yes")
  let login: LoginResult
  if (!noAuthJson) {
    const tokens = await readAuthJson()
    if (tokens) {
      const ok = await confirmAuthJsonUpload(assumeYes)
      if (ok) {
        console.log(`Found ~/.codex/auth.json — uploading tokens…`)
        try {
          login = await uploadTokens(tokens, name)
        } catch (e) {
          console.log(`Token upload failed (${String(e)}); falling back to browser sign-in.`)
          login = await browserFlow(name)
        }
      } else {
        console.log("Okay — using browser sign-in instead.")
        login = await browserFlow(name)
      }
    } else {
      login = await browserFlow(name)
    }
  } else {
    login = await browserFlow(name)
  }
  const cfg: Config = {
    base_url: login.base_url,
    api_key: login.api_key,
    email: login.email,
    key_id: login.key_id,
  }
  await writeConfig(cfg)
  console.log("")
  console.log(`  Signed in as ${cfg.email ?? "(email unknown)"}`)
  console.log(`  Base URL:   ${cfg.base_url}`)
  console.log(`  API Key:    ${cfg.api_key}`)
  if (login.sign_in_url) {
    console.log(`  Sign-in link: ${login.sign_in_url}`)
    console.log(
      "  Open this link to view the dashboard. It expires in 15 minutes and can be used once.",
    )
  }
  console.log("")
  console.log(`  Saved to ${CONFIG}`)
  console.log("")
  console.log("  Run `chatfaucet env` to get shell exports.")
}

async function confirmAuthJsonUpload(assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true

  console.log("")
  console.log("  Found ~/.codex/auth.json.")
  console.log(
    "  Chat Faucet can use it to sign you in without opening a browser. This sends your ChatGPT OAuth tokens to Chat Faucet so the gateway can refresh requests for you.",
  )

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const answer = await rl.question("  Continue with this token upload? [y/N] ")
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

async function cmdEnv() {
  const c = await readConfig()
  if (!c) throw new Error("not logged in — run `chatfaucet login`")
  console.log(`export OPENAI_API_KEY="${c.api_key}"`)
  console.log(`export OPENAI_BASE_URL="${c.base_url}/v1"`)
  console.log(`export CHATFAUCET_API_KEY="${c.api_key}"`)
  console.log(`export CHATFAUCET_BASE_URL="${c.base_url}"`)
}

async function cmdKeysList() {
  const c = await readCredentials()
  if (!c) throw new Error("not logged in — run `chatfaucet login`")
  const r = await fetch(`${c.base_url}/v1/usage`, {
    headers: { Authorization: `Bearer ${c.api_key}` },
  })
  console.log(`Logged in as ${c.email}. Active key: ${c.api_key.slice(0, 12)}…`)
  console.log(`Manage keys at ${c.base_url}/`)
  console.log(`Usage (/v1/usage): ${r.status}`)
  console.log(await r.text())
}

async function cmdLogout() {
  await rm(CONFIG, { force: true }).catch(() => {})
  console.log("  Cleared local config. Your account and keys still exist on the server.")
  console.log(`  Revoke keys at ${BASE}/`)
}

async function cmdDeleteAccount(args: string[]) {
  if (!hasFlag(args, "--yes")) {
    throw new Error(
      "delete-account permanently removes your account and all API keys; rerun with --yes",
    )
  }
  const c = await readCredentials()
  if (!c) {
    throw new Error(
      "not logged in — run `chatfaucet login` or set CHATFAUCET_API_KEY and CHATFAUCET_BASE_URL",
    )
  }
  const r = await fetch(`${c.base_url}/v1/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${c.api_key}` },
  })
  if (!r.ok) throw new Error(`delete-account failed: ${r.status} ${await r.text()}`)
  const body = (await r.json()) as { deleted_keys?: number }
  await rm(CONFIG, { force: true }).catch(() => {})
  console.log(
    `  Deleted account and ${body.deleted_keys ?? 0} API key record(s).`,
  )
  console.log(`  Removed ${CONFIG}`)
}

function help() {
  console.log(`Chat Faucet — your ChatGPT plan as an OpenAI-compatible Responses API

Usage:
  chatfaucet login [--name <label>] [-y] [--no-read-auth-json]
  chatfaucet env
  chatfaucet keys
  chatfaucet logout
  chatfaucet delete-account --yes
  chatfaucet --help

Env:
  CHATFAUCET_HOST   Override the gateway host (default: chatfaucet.com)
  CHATFAUCET_API_KEY and CHATFAUCET_BASE_URL can be used for headless API-key commands
`)
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  try {
    switch (cmd) {
      case "login":
        await cmdLogin(rest)
        break
      case "env":
        await cmdEnv()
        break
      case "keys":
        await cmdKeysList()
        break
      case "logout":
        await cmdLogout()
        break
      case "delete-account":
        await cmdDeleteAccount(rest)
        break
      case undefined:
      case "-h":
      case "--help":
      case "help":
        help()
        break
      default:
        console.error(`Unknown command: ${cmd}`)
        help()
        process.exit(1)
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`)
    process.exit(1)
  }
}

main()
