# codex-backend-api

Your ChatGPT plan, as an OpenAI-compatible Responses API.

- Sign in with ChatGPT (no OpenAI API key needed).
- Mint API keys — then point any OpenAI SDK at the gateway.
- Use the CLI's one-time sign-in link to open the web dashboard after headless setup.
- Delete your account and all stored data from the web UI, CLI, or API.

```
import OpenAI from "openai"
const client = new OpenAI({
  apiKey: "cba_...",
  baseURL: "https://codex-backend-api.com/v1",
})
const stream = await client.responses.create({
  model: "gpt-5.5",
  instructions: "",
  input: [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Say hi" }],
    },
  ],
  stream: true,
  store: false,
})
```

Live at **[codex-backend-api.com](https://codex-backend-api.com)**. Docs at **[codex-backend-api.com/docs](https://codex-backend-api.com/docs)**.

## How it works

```
┌─ Worker (codex-backend-api.com) ─────────────────┐
│  /v1/responses   API-key auth, SSE passthrough   │
│  /v1/models                                       │
│  /v1/usage                                        │
│  /v1/account     API-key account deletion         │
│  /api/auth/*     ChatGPT device-code flow        │
│  /api/cli/*      Headless login + dashboard link │
│  /api/keys       Mint/revoke                      │
│  /api/account    Session account deletion         │
│  /docs                                            │
└──────────────────────────────────────────────────┘
        │                     │
        ▼ OAuth               ▼ proxies per-user tokens
  auth.openai.com      fly.io proxy (bun)
                            │
                            ▼
                chatgpt.com/backend-api/codex/*
```

Cloudflare Workers can't reach `chatgpt.com/backend-api/*` (managed-challenge 403) — the Fly proxy is the smallest possible hop that can. All per-user tokens live in a Durable Object per account. API keys are stored hashed; the KV index maps `sha256(api_key) → account_id`.

## Repo layout

```
src/
  worker/        Cloudflare Worker (API + Durable Object)
  client/        Vite + React SPA
  docs/          Markdown served at /docs
proxy/           Fly.io Bun HTTP proxy
cli/             bunx codex-backend-api
```

## Self-host

You'll need:

- Cloudflare account (free plan is fine)
- Fly.io account (free plan is fine)
- A domain, with wildcard DNS pointed at Cloudflare (e.g. `*.yourdomain.com`)

### 1. Deploy the proxy

```
cd proxy
fly launch --no-deploy --copy-config --name <your-proxy-name>
fly secrets set PROXY_SECRET="$(openssl rand -hex 32)"
fly deploy --ha=false
```

Keep the proxy URL and the secret — you'll need them in step 2.

### 2. Deploy the worker

```
bun install
bunx wrangler kv namespace create INDEX
# → copy the id into wrangler.jsonc (replace PLACEHOLDER_INDEX_KV_ID)
```

Edit `wrangler.jsonc`:
- `vars.APP_HOSTNAME` → your domain (e.g. `yourdomain.com`)
- `vars.PROXY_URL` → `https://<your-proxy-name>.fly.dev`

Put the proxy secret in:

```
bunx wrangler secret put PROXY_SECRET
```

Add a workers route for `*.yourdomain.com/*` → this worker in Cloudflare. Make sure wildcard DNS points at the worker.

Deploy:

```
bun run deploy
```

### 3. Publish the CLI (optional)

```
cd cli
bun publish
```

## Inspirations / credit

- [openai/codex](https://github.com/openai/codex) — reverse-engineered the backend
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) and [anomalyco/opencode](https://github.com/anomalyco/opencode) — validated the reuse-the-Codex-CLI-client-id pattern
- Cloudflare's [@cloudflare/think](https://www.npmjs.com/package/@cloudflare/think) and [@cloudflare/vite-plugin](https://www.npmjs.com/package/@cloudflare/vite-plugin) — the beautiful abstractions

## License

MIT
