# Chat Faucet

An OpenAI-compatible Responses API backed by your ChatGPT plan.

Sign in with ChatGPT → mint an API key → point any OpenAI SDK at the gateway. No OpenAI API key required.

## Endpoint

```text
https://chatfaucet.com
```

That base URL exposes these endpoints:

```text
POST /v1/responses   OpenAI Responses API (streaming SSE or JSON)
GET  /v1/models      Available models
GET  /v1/usage       Your ChatGPT-plan quota
DELETE /v1/account   Delete your account and all stored data
```

Authenticate with `Authorization: Bearer <your_api_key>`. Your key identifies your account — nothing else to configure.

Three request fields are required (even though they feel redundant):

- `instructions` — must be present (empty string is fine)
- `stream` — must be `true`
- `store` — must be `false`

Direct Responses calls must use list-shaped message input, as shown below.
The ChatGPT Codex backend does not accept the SDK shorthand string form
(`input: "Say hi"`).

## What this is NOT

- Not a general-purpose OpenAI proxy. Only the Responses API shape is served.
- Not a multi-tenant billing system. One ChatGPT account = one gateway; the quota is whatever your ChatGPT plan gives you.
- Not for non-Responses endpoints: no `/v1/chat/completions`, no `/v1/images/generations` — use image generation as a **tool** on `/v1/responses`.

## Agent setup

Agents should start by fetching the raw docs:

```bash
curl -fsSL https://chatfaucet.com/docs.md
```

Then run the CLI login, which creates the account if needed and mints an API key:

```bash
bunx chatfaucet login --name agent
eval "$(bunx chatfaucet env)"
```

If the CLI asks for browser authorization, open the printed URL — it runs a local callback on `http://127.0.0.1:1455` and the sign-in completes automatically. After login, the CLI prints a one-time `Sign-in link:` for the web dashboard. Agents should include that exact full URL in their final answer so the user can open the GUI already signed in.

Verify the gateway headlessly:

```bash
curl "$OPENAI_BASE_URL/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

## curl

The simplest thing that works.

```bash
curl -N https://chatfaucet.com/v1/responses \
  -H "Authorization: Bearer $CHATFAUCET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "instructions": "",
    "input": [
      {"type": "message", "role": "user",
       "content": [{"type": "input_text", "text": "Say hi"}]}
    ],
    "stream": true,
    "store": false
  }'
```

The response is Server-Sent Events. Each `data:` line is a JSON event — watch for `response.output_text.delta` for streamed tokens and `response.completed` at the end.

Image generation is a tool, not an endpoint:

```bash
curl -N https://chatfaucet.com/v1/responses \
  -H "Authorization: Bearer $CHATFAUCET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "instructions": "",
    "input": [
      {"type": "message", "role": "user",
       "content": [{"type": "input_text", "text": "A corgi on a skateboard"}]}
    ],
    "tools": [{"type": "image_generation", "output_format": "png"}],
    "stream": true,
    "store": false
  }'
```

The image comes back base64-encoded inside an `image_generation_call` output item.

Usage:

```bash
curl https://chatfaucet.com/v1/usage \
  -H "Authorization: Bearer $CHATFAUCET_API_KEY"
```

## CLI

`bunx chatfaucet` — sign in and mint keys from your terminal.

```bash
bunx chatfaucet login
bunx chatfaucet login --name "laptop"
bunx chatfaucet login --name agent -y        # after the user confirms token upload
bunx chatfaucet login --no-read-auth-json   # skip auth.json, force browser sign-in
```

By default `login` looks for `~/.codex/auth.json` (the file the official Codex CLI writes). If it finds the file, it asks before uploading those tokens. Agents should ask the user for clear verbal confirmation first, then rerun the login command with `-y` after the user confirms. If that file doesn't exist, or the user declines, it opens your browser to sign in with ChatGPT and completes the OAuth handshake via a local callback on `http://127.0.0.1:1455` — no codes to copy. On success it prints your API key and saves config to `~/.chatfaucet.json`.

`login` also prints a one-time dashboard sign-in link. Open it in a browser to land in the web UI with a normal session cookie. The link expires after 15 minutes and can be used once.

```bash
eval "$(bunx chatfaucet env)"
```

Prints shell exports for `OPENAI_API_KEY` and `OPENAI_BASE_URL` — drop into your shell rc file to make any OpenAI-compatible tool "just work."

Self-host: set `CHATFAUCET_HOST` to point at your own instance.

```bash
CHATFAUCET_HOST=my-gateway.example.com bunx chatfaucet login
```

Delete your account and all server-side data:

```bash
bunx chatfaucet delete-account --yes
```

For headless API use, authenticate with any active API key. This deletes the account, stored ChatGPT tokens, all API key records, API key indexes, and web sessions:

```bash
curl -X DELETE https://chatfaucet.com/v1/account \
  -H "Authorization: Bearer $CHATFAUCET_API_KEY"
```

## Vercel AI SDK

`@ai-sdk/openai` works unmodified — point `baseURL` at the gateway.

```bash
bun add ai @ai-sdk/openai
```

```ts
import { createOpenAI } from "@ai-sdk/openai"
import { streamText } from "ai"

const openai = createOpenAI({
  apiKey: process.env.CHATFAUCET_API_KEY!,
  baseURL: "https://chatfaucet.com/v1",
})

const result = streamText({
  model: openai.responses("gpt-5.5"),
  system: "",
  prompt: "Say hi",
  providerOptions: {
    openai: { store: false, instructions: "" },
  },
})

for await (const delta of result.textStream) {
  process.stdout.write(delta)
}
```

Image generation tool:

```ts
const result = await generateText({
  model: openai.responses("gpt-5.5"),
  prompt: "A corgi on a skateboard",
  tools: {
    image_generation: openai.tools.imageGeneration({ outputFormat: "png" }),
  },
  providerOptions: {
    openai: { store: false, instructions: "" },
  },
})
```

The Codex backend requires `store: false` on every request. The Vercel AI SDK defaults to `store: true` — `providerOptions.openai.store: false` overrides it.

## openai-node

The official OpenAI SDK works with `baseURL` and `apiKey`. Use the
list-shaped Responses input shown here.

```bash
bun add openai
```

```ts
import OpenAI from "openai"

const client = new OpenAI({
  apiKey: process.env.CHATFAUCET_API_KEY!,
  baseURL: "https://chatfaucet.com/v1",
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

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta)
  }
}
```

Python:

```py
from openai import OpenAI

client = OpenAI(
  api_key="chf_...",
  base_url="https://chatfaucet.com/v1",
)

stream = client.responses.create(
  model="gpt-5.5",
  instructions="",
  input=[
    {
      "type": "message",
      "role": "user",
      "content": [{"type": "input_text", "text": "Say hi"}],
    }
  ],
  stream=True,
  store=False,
)
for event in stream:
  if event.type == "response.output_text.delta":
    print(event.delta, end="", flush=True)
```

## Cloudflare agents / Think

`@cloudflare/think`:

```ts
import { Think } from "@cloudflare/think"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel, ToolSet } from "ai"

const openai = createOpenAI({
  apiKey: "chf_...",
  baseURL: "https://chatfaucet.com/v1",
})

export class MyAgent extends Think<Env> {
  getModel(): LanguageModel {
    return openai.responses("gpt-5.5")
  }

  getTools(): ToolSet {
    return {
      image_generation: openai.tools.imageGeneration({ outputFormat: "png" }),
    }
  }

  beforeTurn() {
    return {
      providerOptions: {
        openai: { store: false, instructions: "" },
      },
    }
  }
}
```

Stash your API key in a Workers secret and pull it via `env.CHATFAUCET_API_KEY`:

```bash
bunx wrangler secret put CHATFAUCET_API_KEY
```

`@cloudflare/agents`:

```ts
import { Agent, routeAgentRequest } from "agents"
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

export class MyAgent extends Agent<Env> {
  async onMessage(prompt: string) {
    const openai = createOpenAI({
      apiKey: this.env.CHATFAUCET_API_KEY,
      baseURL: "https://chatfaucet.com/v1",
    })
    const result = streamText({
      model: openai.responses("gpt-5.5"),
      prompt,
      providerOptions: { openai: { store: false, instructions: "" } },
    })
    return result.toTextStreamResponse()
  }
}
```

This works because traffic goes to `chatfaucet.com` (a Worker) — not `chatgpt.com` directly. Workers can't reach `chatgpt.com/backend-api/*` (managed-challenge 403). The Worker proxies through a small non-Cloudflare host (Fly.io) that can.

## How it works

Your ChatGPT OAuth tokens are stored in a per-user Durable Object. When a request comes in with your API key, we refresh your ChatGPT access token if needed and forward to `chatgpt.com/backend-api/codex/*` through a thin Fly-hosted proxy.

Code: [github.com/financialvice/chatfaucet](https://github.com/financialvice/chatfaucet)
