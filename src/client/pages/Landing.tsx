import { useEffect, useRef, useState } from "react"
import { postJson, type DeviceStart } from "../lib/api"
import Window from "../srcl/components/Window"
import Card from "../srcl/components/Card"
import Button from "../srcl/components/Button"
import BlockLoader from "../srcl/components/BlockLoader"
import RowSpaceBetween from "../srcl/components/RowSpaceBetween"
import { ThemeToggle } from "../srcl/theme"

type State =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; device: DeviceStart; startedAt: number }
  | { kind: "error"; message: string }

const REPO = "financialvice/chatfaucet"

export function Landing({ onAuthed }: { onAuthed: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle" })
  const [elapsed, setElapsed] = useState(0)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const stars = useGithubStars(REPO)
  const cancelRef = useRef(false)

  useEffect(() => {
    document.title = "Chat Faucet — ChatGPT plan → OpenAI Responses API"
  }, [])

  useEffect(() => {
    if (state.kind !== "waiting") return
    setElapsed(Math.floor((Date.now() - state.startedAt) / 1000))
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(iv)
  }, [state])

  async function start() {
    cancelRef.current = false
    setState({ kind: "starting" })
    try {
      const device = await postJson<DeviceStart>("/api/auth/device-start")
      setState({ kind: "waiting", device, startedAt: Date.now() })
      poll(device)
    } catch (e) {
      setState({ kind: "error", message: humanizeError(e) })
    }
  }

  async function poll(device: DeviceStart) {
    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      if (cancelRef.current) return
      await new Promise((r) => setTimeout(r, device.interval * 1000))
      if (cancelRef.current) return
      try {
        const r = await postJson<{
          status: "pending" | "success" | "error"
          error?: string
        }>("/api/auth/device-poll", {
          device_auth_id: device.device_auth_id,
          user_code: device.user_code,
        })
        if (r.status === "success") {
          onAuthed()
          return
        }
        if (r.status === "error") {
          setState({
            kind: "error",
            message: humanizeError(r.error ?? "Authorization failed"),
          })
          return
        }
      } catch (e) {
        setState({ kind: "error", message: humanizeError(e) })
        return
      }
    }
    setState({
      kind: "error",
      message: "Sign-in didn't complete within 15 minutes. Try again.",
    })
  }

  function cancel() {
    cancelRef.current = true
    setState({ kind: "idle" })
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    } catch {}
  }

  async function copyAgentPrompt() {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT)
      setCopiedPrompt(true)
      setTimeout(() => setCopiedPrompt(false), 1500)
    } catch {}
  }

  return (
    <Window>
      <RowSpaceBetween style={{ marginBottom: "1rem" }}>
        <span>Chat Faucet</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "2ch",
          }}
        >
          <a href="/docs">docs</a>
          <a
            href={`https://github.com/${REPO}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star chatfaucet on GitHub"
          >
            ★ star{stars !== null ? ` ${formatStars(stars)}` : ""}
          </a>
          <ThemeToggle />
        </span>
      </RowSpaceBetween>

      <Card title="OVERVIEW">
        Your ChatGPT plan, exposed as an OpenAI-compatible Responses API. Sign
        in once, mint an API key, point any OpenAI SDK at{" "}
        <code>https://chatfaucet.com/v1</code>.
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="SIGN IN">
        {state.kind === "idle" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "calc(var(--theme-line-height-base) * 0.5rem)",
            }}
          >
            <Button onClick={copyAgentPrompt}>
              {copiedPrompt
                ? "Copied prompt"
                : "Get started with agent (copy prompt)"}
            </Button>
            <Button theme="SECONDARY" onClick={start}>
              Sign in with ChatGPT
            </Button>
          </div>
        )}

        {state.kind === "starting" && (
          <span>
            Starting <BlockLoader mode={1} />
          </span>
        )}

        {state.kind === "waiting" && (
          <>
            <ol style={{ margin: "0 0 1rem 0" }}>
              <li style={{ marginBottom: "0.5rem" }}>
                <a
                  href={state.device.verification_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sign in to ChatGPT
                </a>{" "}
                (opens a new tab).
              </li>
              <li style={{ marginBottom: "0.5rem" }}>
                If prompted, check your one-time password app for a code.
                <MockOtpInput />
              </li>
              <li>
                <strong>Lastly</strong>, enter this code to grant Chat Faucet
                access:
                <div style={{ margin: "0.75rem 0 0 0" }}>
                  <SegmentedCode
                    code={state.device.user_code}
                    onCopy={() => copyCode(state.device.user_code)}
                    copied={copiedCode}
                  />
                </div>
              </li>
            </ol>
            <RowSpaceBetween style={{ alignItems: "baseline" }}>
              <span>
                Waiting <BlockLoader mode={1} />{" "}
                <span style={{ opacity: 0.6, marginLeft: "1ch" }}>
                  {fmtElapsed(elapsed)}
                </span>
              </span>
              <button
                type="button"
                onClick={cancel}
                style={{
                  background: "transparent",
                  color: "var(--theme-text)",
                  border: 0,
                  padding: 0,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                  opacity: 0.7,
                }}
              >
                cancel
              </button>
            </RowSpaceBetween>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p style={{ marginBottom: "1rem", color: "var(--ansi-9-red)" }}>
              {state.message}
            </p>
            <Button theme="SECONDARY" onClick={() => setState({ kind: "idle" })}>
              Try again
            </Button>
          </>
        )}
      </Card>

      <div style={{ height: "1rem" }} />

      <div
        style={{
          marginTop: "1rem",
          opacity: 0.6,
          fontSize: "0.875em",
          lineHeight: "calc(var(--theme-line-height-base) * 1.2em)",
        }}
      >
        by{" "}
        <a
          href="https://x.com/financialvice"
          target="_blank"
          rel="noopener noreferrer"
        >
          cam
        </a>{" "}
        and{" "}
        <a
          href="https://x.com/anupambatra_"
          target="_blank"
          rel="noopener noreferrer"
        >
          anupam
        </a>{" "}
        |{" "}
        <a
          href="https://www.dubdubdub.xyz/"
          target="_blank"
          rel="noopener noreferrer"
        >
          dubdubdub labs
        </a>{" "}
        | components by{" "}
        <a
          href="https://www.sacred.computer/"
          target="_blank"
          rel="noopener noreferrer"
        >
          sacred.computer
        </a>
      </div>
    </Window>
  )
}

function MockOtpInput() {
  return (
    <div
      aria-hidden="true"
      style={{
        marginTop: "0.5rem",
        maxWidth: "32ch",
        padding: "0.35rem 1ch 0.25rem",
        border: "1px solid var(--theme-border)",
        background: "var(--theme-background-input)",
        opacity: 0.55,
        lineHeight: "calc(var(--theme-line-height-base) * 1em)",
      }}
    >
      <div style={{ fontSize: "0.8em", opacity: 0.75 }}>One-time code</div>
      <div style={{ fontSize: "1em" }}>▮</div>
    </div>
  )
}

function SegmentedCode({
  code,
  onCopy,
  copied,
}: {
  code: string
  onCopy: () => void
  copied: boolean
}) {
  const groups = code.split("-")
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2ch",
        flexWrap: "wrap",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onCopy()
          }
        }}
        aria-label={`Copy code ${code}`}
        title="click to copy"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75ch",
          cursor: "pointer",
          userSelect: "all",
        }}
      >
        {groups.map((group, gi) => (
          <div
            key={gi}
            style={{ display: "flex", alignItems: "center", gap: "0.5ch" }}
          >
            {group.split("").map((ch, ci) => (
              <span
                key={ci}
                style={{
                  width: "1.6em",
                  height: "1.8em",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow:
                    "inset 0 0 0 2px var(--theme-focused-foreground)",
                  color: "var(--theme-focused-foreground)",
                  background: "transparent",
                  fontFamily: "var(--font-family-mono)",
                  fontSize: "1.35em",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {ch}
              </span>
            ))}
            {gi < groups.length - 1 && (
              <span
                style={{
                  fontSize: "1.35em",
                  color: "var(--theme-focused-foreground)",
                  padding: "0 0.25ch",
                }}
              >
                -
              </span>
            )}
          </div>
        ))}
      </div>
      <span
        aria-live="polite"
        style={{
          opacity: copied ? 0.8 : 0,
          transition: "opacity 150ms ease",
          fontSize: "0.9em",
        }}
      >
        copied to clipboard ✓
      </span>
    </div>
  )
}

function useGithubStars(repo: string): number | null {
  const key = `gh:${repo}:stars`
  const [count, setCount] = useState<number | null>(() => {
    try {
      const cached = localStorage.getItem(key)
      if (!cached) return null
      const parsed = JSON.parse(cached) as { count: number; ts: number }
      if (Date.now() - parsed.ts < 10 * 60 * 1000) return parsed.count
    } catch {}
    return null
  })

  useEffect(() => {
    if (count !== null) return
    const ctrl = new AbortController()
    fetch(`https://api.github.com/repos/${repo}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ stargazers_count?: number }>) : Promise.reject()))
      .then((d) => {
        if (typeof d.stargazers_count !== "number") return
        setCount(d.stargazers_count)
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ count: d.stargazers_count, ts: Date.now() }),
          )
        } catch {}
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [repo, key, count])

  return count
}

function formatStars(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k"
  return Math.round(n / 1000) + "k"
}

const AGENT_PROMPT = `I want to use Chat Faucet, an OpenAI-compatible Responses API backed by my ChatGPT plan.

Please curl the agent-readable docs first:

curl -fsSL https://chatfaucet.com/docs.md

Then follow the docs to create my account and mint an API key with the CLI:

bunx chatfaucet login --name agent

If browser authorization is needed, start the documented device-code flow and tell me exactly which URL/code to approve. After setup, configure this shell/project with OPENAI_API_KEY and OPENAI_BASE_URL from \`bunx chatfaucet env\`, then verify with /v1/models or /v1/usage.

The CLI prints a one-time "Sign-in link:" for the web dashboard after login. Include that exact full URL in your final answer so I can open the GUI already signed in. Do not ask me for an OpenAI API key.`

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function humanizeError(e: unknown): string {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
  const lower = raw.toLowerCase()
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Authorization didn't stick. Try again."
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Your ChatGPT session didn't complete in time. Try again."
  }
  if (lower.includes("access_denied") || lower.includes("denied")) {
    return "Sign-in was denied. Try again."
  }
  if (lower.includes("expired_token") || lower.includes("expired")) {
    return "Sign-in code expired. Start over."
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  if (lower.startsWith("5")) {
    return "Server error. Try again in a moment."
  }
  return raw
}
