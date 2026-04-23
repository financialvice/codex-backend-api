#!/usr/bin/env bun
import { readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const HOST = process.env.CBA_HOST || "codex-backend-api.com"
const BASE = `https://${HOST}`
const CONFIG = join(homedir(), ".codex-backend-api.json")
const AUTH_JSON = join(homedir(), ".codex", "auth.json")

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

  const apiKey = process.env.CBA_API_KEY
  const baseUrl = process.env.CBA_BASE_URL
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

async function uploadTokens(
  tokens: Awaited<ReturnType<typeof readAuthJson>>,
  name: string,
): Promise<LoginResult> {
  if (!tokens) throw new Error("no tokens")
  const r = await fetch(`${BASE}/api/cli/upload-tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      refresh_token: tokens.refresh_token,
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      account_id: tokens.account_id,
      key_name: name,
    }),
  })
  if (!r.ok) throw new Error(`upload-tokens failed: ${r.status} ${await r.text()}`)
  return (await r.json()) as LoginResult
}

async function deviceFlow(name: string): Promise<LoginResult> {
  const start = await fetch(`${BASE}/api/cli/device-start`, { method: "POST" })
  if (!start.ok) throw new Error(`device-start: ${start.status}`)
  const d = (await start.json()) as {
    device_auth_id: string
    user_code: string
    interval: number
    verification_uri_complete: string
  }
  console.log("")
  console.log("  Open this URL in your browser to authorize:")
  console.log(`  ${d.verification_uri_complete}`)
  console.log("")
  console.log(`  Or enter code: ${d.user_code}`)
  console.log("")
  console.log("  Waiting for authorization…")
  const deadline = Date.now() + 15 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, d.interval * 1000))
    const r = await fetch(`${BASE}/api/cli/device-poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        device_auth_id: d.device_auth_id,
        user_code: d.user_code,
        key_name: name,
      }),
    })
    const j = (await r.json()) as
      | { status: "pending" }
      | { status: "error"; error: string }
      | {
          status: "success"
          email: string | null
          base_url: string
          api_key: string
          key_id: string
          sign_in_url?: string
        }
    if (j.status === "success") return j
    if (j.status === "error") throw new Error(j.error)
  }
  throw new Error("authorization timed out")
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
  let login: LoginResult
  if (!noAuthJson) {
    const tokens = await readAuthJson()
    if (tokens) {
      console.log(`Found ~/.codex/auth.json — uploading tokens…`)
      login = await uploadTokens(tokens, name)
    } else {
      login = await deviceFlow(name)
    }
  } else {
    login = await deviceFlow(name)
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
  console.log("  Run `codex-backend-api env` to get shell exports.")
}

async function cmdEnv() {
  const c = await readConfig()
  if (!c) throw new Error("not logged in — run `codex-backend-api login`")
  console.log(`export OPENAI_API_KEY="${c.api_key}"`)
  console.log(`export OPENAI_BASE_URL="${c.base_url}/v1"`)
  console.log(`export CBA_API_KEY="${c.api_key}"`)
  console.log(`export CBA_BASE_URL="${c.base_url}"`)
}

async function cmdKeysList() {
  const c = await readCredentials()
  if (!c) throw new Error("not logged in — run `codex-backend-api login`")
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
      "not logged in — run `codex-backend-api login` or set CBA_API_KEY and CBA_BASE_URL",
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
  console.log(`codex-backend-api — your ChatGPT plan as an OpenAI-compatible Responses API

Usage:
  codex-backend-api login [--name <label>] [--no-read-auth-json]
  codex-backend-api env
  codex-backend-api keys
  codex-backend-api logout
  codex-backend-api delete-account --yes
  codex-backend-api --help

Env:
  CBA_HOST   Override the gateway host (default: codex-backend-api.com)
  CBA_API_KEY and CBA_BASE_URL can be used for headless API-key commands
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
