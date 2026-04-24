import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { type DeviceStart, postJson } from "../lib/api";
import BlockLoader from "../srcl/components/BlockLoader";
import Button from "../srcl/components/Button";
import Card from "../srcl/components/Card";
import RowSpaceBetween from "../srcl/components/RowSpaceBetween";
import Window from "../srcl/components/Window";
import { ThemeToggle } from "../srcl/theme";
import styles from "./Landing.module.css";

type State =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; device: DeviceStart; startedAt: number }
  | { kind: "error"; message: string };

const REPO = "financialvice/chatfaucet";

export function Landing({ onAuthed }: { onAuthed: () => void }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const stars = useGithubStars(REPO);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (state.kind !== "waiting") {
      return;
    }
    setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [state]);

  async function start() {
    cancelRef.current = false;
    setState({ kind: "starting" });
    try {
      const device = await postJson<DeviceStart>("/api/auth/device-start");
      setState({ kind: "waiting", device, startedAt: Date.now() });
      poll(device);
    } catch (e) {
      setState({ kind: "error", message: humanizeError(e) });
    }
  }

  async function poll(device: DeviceStart) {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      if (cancelRef.current) {
        return;
      }
      await new Promise((r) => setTimeout(r, device.interval * 1000));
      if (cancelRef.current) {
        return;
      }
      try {
        const r = await postJson<{
          status: "pending" | "success" | "error";
          error?: string;
        }>("/api/auth/device-poll", {
          device_auth_id: device.device_auth_id,
          user_code: device.user_code,
        });
        if (r.status === "success") {
          onAuthed();
          return;
        }
        if (r.status === "error") {
          setState({
            kind: "error",
            message: humanizeError(r.error ?? "Authorization failed"),
          });
          return;
        }
      } catch (e) {
        setState({ kind: "error", message: humanizeError(e) });
        return;
      }
    }
    setState({
      kind: "error",
      message: "Sign-in didn't complete within 15 minutes. Try again.",
    });
  }

  function cancel() {
    cancelRef.current = true;
    setState({ kind: "idle" });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    } catch {}
  }

  async function copyAgentPrompt() {
    try {
      await navigator.clipboard.writeText(AGENT_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1500);
    } catch {}
  }

  return (
    <Window>
      <RowSpaceBetween style={{ marginBottom: "1rem" }}>
        <span>Chat Faucet</span>
        <span className={styles.headerActions}>
          <Link to="/docs">docs</Link>
          <a
            aria-label="Star chatfaucet on GitHub"
            href={`https://github.com/${REPO}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            ★ star{stars === null ? "" : ` ${formatStars(stars)}`}
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
              {copiedPrompt ? (
                "Copied prompt"
              ) : (
                <>
                  <span className={styles.btnLabelFull}>
                    Get started with agent (copy prompt)
                  </span>
                  <span className={styles.btnLabelShort}>
                    Set up with agent
                  </span>
                </>
              )}
            </Button>
            <Button onClick={start} theme="SECONDARY">
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
                  rel="noopener noreferrer"
                  target="_blank"
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
                    copied={copiedCode}
                    onCopy={() => copyCode(state.device.user_code)}
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
                type="button"
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
            <Button
              onClick={() => setState({ kind: "idle" })}
              theme="SECONDARY"
            >
              Try again
            </Button>
          </>
        )}
      </Card>
    </Window>
  );
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
  );
}

function SegmentedCode({
  code,
  onCopy,
  copied,
}: {
  code: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const groups = code.split("-");
  return (
    <div className={styles.code}>
      <div className={styles.codeButton} style={{ userSelect: "all" }}>
        {groups.map((group, gi) => (
          <div className={styles.codeGroup} key={gi}>
            {group.split("").map((ch, ci) => (
              <span className={styles.codeChar} key={ci}>
                {ch}
              </span>
            ))}
            {gi < groups.length - 1 && (
              <span className={styles.codeDash}>-</span>
            )}
          </div>
        ))}
      </div>
      <div className={styles.copyButton}>
        <Button aria-live="polite" onClick={onCopy} theme="SECONDARY">
          {copied ? "Copied ✓" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function useGithubStars(repo: string): number | null {
  const key = `gh:${repo}:stars`;
  const [count, setCount] = useState<number | null>(() => {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) {
        return null;
      }
      const parsed = JSON.parse(cached) as { count: number; ts: number };
      return parsed.count;
    } catch {}
    return null;
  });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`https://api.github.com/repos/${repo}`, { signal: ctrl.signal })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ stargazers_count?: number }>)
          : Promise.reject()
      )
      .then((d) => {
        if (typeof d.stargazers_count !== "number") {
          return;
        }
        setCount(d.stargazers_count);
        try {
          localStorage.setItem(
            key,
            JSON.stringify({ count: d.stargazers_count, ts: Date.now() })
          );
        } catch {}
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [repo, key]);

  return count;
}

function formatStars(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 10_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${Math.round(n / 1000)}k`;
}

const AGENT_PROMPT = `I want to use Chat Faucet, an OpenAI-compatible Responses API backed by my ChatGPT plan.

Please curl the agent-readable docs first:

curl -fsSL https://chatfaucet.com/docs.md

Then follow the docs to create my account and mint an API key with the CLI:

bunx chatfaucet login --name agent

Complete the browser authorization flow if it opens. If the CLI reuses an existing ~/.chatfaucet.json login, continue without browser auth. After setup, configure this shell/project with OPENAI_API_KEY and OPENAI_BASE_URL from \`bunx chatfaucet env\`, then verify with /v1/models or /v1/usage.

The CLI prints a one-time "Sign-in link:" for the web dashboard after login. Include that exact full URL in your final answer so I can open the GUI already signed in. Do not ask me for an OpenAI API key.`;

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function humanizeError(e: unknown): string {
  const raw =
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Authorization didn't stick. Try again.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Your ChatGPT session didn't complete in time. Try again.";
  }
  if (lower.includes("access_denied") || lower.includes("denied")) {
    return "Sign-in was denied. Try again.";
  }
  if (lower.includes("expired_token") || lower.includes("expired")) {
    return "Sign-in code expired. Start over.";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (lower.startsWith("5")) {
    return "Server error. Try again in a moment.";
  }
  return raw;
}
