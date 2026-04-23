# codex-backend-api

CLI for [codex-backend-api.com](https://codex-backend-api.com), which exposes
your ChatGPT plan as an OpenAI-compatible Responses API.

## Usage

Requires [Bun](https://bun.sh).

```sh
bunx codex-backend-api login
bunx codex-backend-api env
```

After login, use the printed exports with OpenAI-compatible SDKs and tools:

```sh
export OPENAI_API_KEY="cba_..."
export OPENAI_BASE_URL="https://codex-backend-api.com/v1"
```

`login` also prints a one-time `Sign-in link:`. Open it in a browser to view the dashboard already signed in; it expires after 15 minutes and can be used once.

You can also run it through npm if Bun is installed:

```sh
npx codex-backend-api login
```

## Commands

```sh
codex-backend-api login [--name <label>] [--no-read-auth-json]
codex-backend-api env
codex-backend-api keys
codex-backend-api logout
codex-backend-api delete-account --yes
codex-backend-api --help
```

## Environment

- `CBA_HOST` overrides the gateway host.
- `CBA_API_KEY` and `CBA_BASE_URL` can be used for headless API-key commands.
