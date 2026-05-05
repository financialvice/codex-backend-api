# Chat Faucet

An OpenAI-compatible Responses API backed by your ChatGPT plan.

Sign in with ChatGPT → mint an API key → point any OpenAI SDK at the gateway. No OpenAI API key required.

## Endpoint

```text
https://chatfaucet.com
```

That base URL exposes these endpoints:

```text
POST /v1/responses   OpenAI Responses API (streaming SSE)
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
- Not for non-Responses endpoints: no `/v1/chat/completions`, no `/v1/images/generations` — use image generation as a **tool** on `/v1/responses`.

## Developer apps

Developer apps let your users bring their own ChatGPT account for inference
without pasting a personal Chat Faucet API key into your app.

1. Sign in to Chat Faucet.
2. Create a developer app in the dashboard.
3. Save the one-time `chf_app_...` app key.
4. From your backend, start a connect session:

```bash
curl https://chatfaucet.com/api/apps/connect/start \
  -H "Authorization: Bearer $CHATFAUCET_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":"your-user-or-csrf-state"}'
```

Chat Faucet returns both `user_code` and a `verification_uri_complete` URL on
`auth.openai.com`. Your app must show the device code before sending the user
to OpenAI, because OpenAI may ask them to enter it on the next screen. Treat
Chat Faucet as backend infrastructure: the user-facing flow should mention
ChatGPT/OpenAI, not Chat Faucet.

Good user-facing flow:

1. The user clicks "Sign in with ChatGPT" in your app.
2. Your backend calls `/api/apps/connect/start`.
3. Your app shows a waiting screen with:
   - the device code from `user_code`, large enough to read and copy
   - a button or link labeled "Continue to ChatGPT" that opens
     `verification_uri_complete`
   - a short note that they should enter the displayed code if OpenAI asks
4. Your app keeps polling `/api/apps/connect/poll` from the waiting screen.
5. When polling returns `connection_id`, store it on your user record and move
   them back into your app.

Avoid immediately redirecting the tab to OpenAI before showing the code. That
can leave users on OpenAI's code-entry page with no visible code. The
recommended version is a two-step handoff: first render the waiting screen,
then let the user choose "Continue to ChatGPT" from that screen.

Minimal browser behavior:

```html
<p>Device code: <strong id="code"></strong></p>
<a id="continue" target="_blank" rel="noopener">Continue to ChatGPT</a>
<p id="status">Waiting...</p>
```

```js
// Returned by your backend after it calls /api/apps/connect/start.
const connect = {
  connect_auth_id: "cna_...",
  user_code: "DIAB-12345",
  verification_uri_complete: "https://auth.openai.com/codex/device?code=...",
};

document.querySelector("#code").textContent = connect.user_code;
document.querySelector("#continue").href = connect.verification_uri_complete;

setInterval(async () => {
  const poll = await fetch("/your-backend/chatgpt-connect/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ connect_auth_id: connect.connect_auth_id }),
  }).then((r) => r.json());

  if (poll.status === "success") {
    location.href = "/app";
  }
}, 3000);
```

```bash
curl https://chatfaucet.com/api/apps/connect/poll \
  -H "Authorization: Bearer $CHATFAUCET_APP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connect_auth_id":"cna_..."}'
```

When the user completes ChatGPT sign-in, poll returns `connection_id`. Store
that id on your user record. Then call the normal Responses API with your app
key and the user's connection id:

```bash
curl -N https://chatfaucet.com/v1/responses \
  -H "Authorization: Bearer $CHATFAUCET_APP_KEY" \
  -H "ChatFaucet-Connection: $CHATFAUCET_CONNECTION_ID" \
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

There is a runnable fixture in the repo:

```bash
CHATFAUCET_APP_KEY=chf_app_... bun examples/developer-app-fixture.mjs
```

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

Image inputs are supported with OpenAI-style `input_image` content parts. Use
a public URL or a `data:image/...;base64,...` URL:

```bash
curl -N https://chatfaucet.com/v1/responses \
  -H "Authorization: Bearer $CHATFAUCET_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.5",
    "instructions": "",
    "input": [
      {"type": "message", "role": "user",
       "content": [
         {"type": "input_text", "text": "What is in this image?"},
         {"type": "input_image", "image_url": "data:image/png;base64,..."}
       ]}
    ],
    "stream": true,
    "store": false
  }'
```

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
bunx chatfaucet keys create --name "desktop"
```

`login` opens your browser to sign in with ChatGPT and completes the OAuth handshake via a local callback on `http://127.0.0.1:1455` — no codes to copy. On success it prints your API key and saves config to `~/.chatfaucet.json`. Future `login` runs reuse that saved Chat Faucet key when it is still valid and skip browser sign-in; use `login --force` to run browser OAuth again.

`login` also prints a one-time dashboard sign-in link. Open it in a browser to land in the web UI with a normal session cookie. The link expires after 15 minutes and can be used once.

`keys create` mints a fresh API key from the saved `~/.chatfaucet.json` login, writes it back to that file, and leaves your older keys active until you revoke them in the dashboard.

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
