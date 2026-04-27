# Chat Faucet

![Chat Faucet — your ChatGPT plan exposed as an OpenAI Responses API](./apps/web/public/og.png)

## what it do
- gives you a more OPENAI_API_KEY-like experience by managing your codex auth creds and letting you mint your own api keys to use against the chatfaucet.com/v1 base url
- also runs requests through a thin Fly proxy bc I had trouble with making requests from Cloudflare IPs when building on their infra
- TL;DR: your ChatGPT plan -> OpenAI Responses API

## why
- your ChatGPT subscription includes Responses API usage (primarily intended for consumption in Codex CLI and App), but [approved for usage elsewhere by OAI staff](https://x.com/steipete/status/2046775849769148838)
- the standard use case for this auth method (codex exec or codex app-server) is relatively un-ergonomic for more standard, simple AI app implementations (like basic chat or non-computer-using agents)
- chat faucet makes it stupid easy to build and deploy apps that use your ChatGPT sub inference

## quirks
- must set `instructions`, `store: false`, `stream: true` (see [docs](https://chatfaucet.com/docs))
- probably other quirks, if you find please PR
- I don't recommend using this for powering inference for externally-facing apps, I think that probably violates [TOS](https://openai.com/policies/row-terms-of-use/) and is low aura, just use this for personal apps/fun things

## privacy and security
- to make things easy, this service stores encrypted ChatGPT OAuth tokens from the browser sign-in flow and auto-refreshes them for gateway requests
- please fork, deploy for yourself (just need Cloudflare/Fly.io), or ask your agent to do things your way

## inspiration / references
- [OpenAI Codex](https://github.com/openai/codex); direct reference source code for reverse-engineering
- [Pi](https://github.com/badlogic/pi-mono), [OpenCode](https://github.com/anomalyco/opencode), [OpenClaw](https://github.com/openclaw/openclaw); they use similar approaches for enabling ChatGPT sub usage for their agent harnesses
