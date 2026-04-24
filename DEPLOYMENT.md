# Deployment

Chat Faucet has three deployable surfaces:

| App            | Where                | How                                |
| -------------- | -------------------- | ---------------------------------- |
| `apps/web`     | Cloudflare Workers   | `bun run deploy` (wrangler)        |
| `apps/proxy`   | Fly.io               | `bun run deploy` (flyctl)          |
| `apps/cli`     | npm (`chatfaucet`)   | push a `cli-v*` tag → GitHub Actions |

From the repo root, `bun run deploy` runs the web + proxy deploys via Turbo. The CLI publishes from CI (see below).

## Prereqs

- `bun` 1.3+
- `wrangler` (comes in via workspace deps; use `bunx wrangler`)
- `flyctl` installed locally and `fly auth login`
- Cloudflare account + `wrangler login`
- An `NPM_TOKEN` secret configured on the GitHub repo (for CLI releases)

## First-time setup

### 1. Fly proxy (`apps/proxy`)

The proxy forwards ChatGPT backend calls from Cloudflare IPs (which ChatGPT backends were rejecting) through a shared-secret-gated Fly app.

```sh
cd apps/proxy

# Rename the app if forking
# (edit `app = "..."` in fly.toml)
flyctl apps create chatfaucet-proxy

# Generate a shared secret and set it on Fly
openssl rand -hex 32 | tee /tmp/proxy-secret
flyctl secrets set PROXY_SECRET="$(cat /tmp/proxy-secret)"

bun run deploy
```

Keep `/tmp/proxy-secret` around for the next step, then delete it.

### 2. Cloudflare Worker (`apps/web`)

```sh
cd apps/web

# One-time: create the INDEX KV namespace and paste the id into wrangler.jsonc
bunx wrangler kv namespace create INDEX
# → copy the returned `id` into the `kv_namespaces[0].id` field in wrangler.jsonc

# Set worker secrets
bunx wrangler secret put PROXY_SECRET           # paste the Fly secret
openssl rand -hex 32 | bunx wrangler secret put TOKEN_ENCRYPTION_KEY

# Point `PROXY_URL` and `APP_HOSTNAME` in wrangler.jsonc at your Fly app + domain
# Update the `routes` block (or remove it) if you aren't using chatfaucet.com

bun run deploy
```

Durable Object migrations in `wrangler.jsonc` are cumulative — leave them alone unless you know what you're doing. New forks will apply all migrations on first deploy.

### 3. CLI (`apps/cli`)

Published as `chatfaucet` on npm. Releases are automated via `.github/workflows/release-cli.yml` — push a tag that matches the package version and CI publishes with npm provenance.

```sh
cd apps/cli
# bump the version in package.json, then from the repo root:
git commit -am "chatfaucet CLI vX.Y.Z"
git tag cli-vX.Y.Z
git push origin main --tags
```

Required secret on the GitHub repo: `NPM_TOKEN` (an npm automation token with publish access to `chatfaucet`).

First-time local publish (if you want to bootstrap outside CI):

```sh
cd apps/cli
bun run build
npm publish --access public
```

## Routine deploys

```sh
bun run deploy        # web + proxy
```

Individual:

```sh
bun --filter @chatfaucet/web deploy
bun --filter chatfaucet-proxy deploy
```

## Secrets reference

| Secret                 | Where              | What                                                                 |
| ---------------------- | ------------------ | -------------------------------------------------------------------- |
| `PROXY_SECRET`         | Fly + Worker       | Shared HMAC-style token. Worker sends `X-Proxy-Secret`, Fly verifies. |
| `TOKEN_ENCRYPTION_KEY` | Worker             | 32 bytes of hex (`openssl rand -hex 32`). Encrypts stored OAuth tokens at rest. Rotating it invalidates existing sessions. |
| `NPM_TOKEN`            | GitHub repo secret | npm automation token used by the release workflow.                   |

## Troubleshooting

- **`401 Unauthorized` from worker → proxy**: `PROXY_SECRET` drifted between Fly and the worker. Re-run `flyctl secrets set` and `wrangler secret put` with the same value.
- **`TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex chars`**: you set a non-hex value. Use `openssl rand -hex 32`.
- **CLI release workflow fails with "Tag does not match package version"**: bump `apps/cli/package.json` before tagging, or retag after bumping.
- **Wrangler type errors after changing `wrangler.jsonc`**: `apps/web/worker-configuration.d.ts` is generated; `bun run dev` / `bun run build` / `bun run typecheck` regenerate it. To refresh manually: `bun --filter @chatfaucet/web cf-typegen`.
