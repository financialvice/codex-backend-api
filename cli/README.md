# Chat Faucet

CLI for [chatfaucet.com](https://chatfaucet.com), which exposes
your ChatGPT plan as an OpenAI-compatible Responses API.

## Usage

Requires [Bun](https://bun.sh).

```sh
bunx chatfaucet login
bunx chatfaucet env
```

After login, use the printed exports with OpenAI-compatible SDKs and tools:

```sh
export OPENAI_API_KEY="chf_..."
export OPENAI_BASE_URL="https://chatfaucet.com/v1"
```

`login` also prints a one-time `Sign-in link:`. Open it in a browser to view the dashboard already signed in; it expires after 15 minutes and can be used once.

You can also run it through npm if Bun is installed:

```sh
npx chatfaucet login
```

## Commands

```sh
chatfaucet login [--name <label>] [--no-read-auth-json]
chatfaucet env
chatfaucet keys
chatfaucet logout
chatfaucet delete-account --yes
chatfaucet --help
```

## Environment

- `CHATFAUCET_HOST` overrides the gateway host.
- `CHATFAUCET_API_KEY` and `CHATFAUCET_BASE_URL` can be used for headless API-key commands.
