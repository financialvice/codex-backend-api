import { useEffect, useRef, useState } from "react"
import {
  del,
  getJson,
  postJson,
  type ApiKeyPublic,
  type AuthStatus,
} from "../lib/api"
import Window from "../srcl/components/Window"
import Card from "../srcl/components/Card"
import Button from "../srcl/components/Button"
import Badge from "../srcl/components/Badge"
import BlockLoader from "../srcl/components/BlockLoader"
import BarLoader from "../srcl/components/BarLoader"
import Dialog from "../srcl/components/Dialog"
import RowSpaceBetween from "../srcl/components/RowSpaceBetween"
import { ThemeToggle } from "../srcl/theme"

export function Dashboard({ status }: { status: AuthStatus }) {
  const [keys, setKeys] = useState<ApiKeyPublic[] | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyName, setNewKeyName] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [usage, setUsage] = useState<unknown>(null)
  const [usageErr, setUsageErr] = useState<string | null>(null)
  const [keysErr, setKeysErr] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [revokingKey, setRevokingKey] = useState<ApiKeyPublic | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
  const [deleteAccountErr, setDeleteAccountErr] = useState<string | null>(null)

  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const newKeyRef = useRef<HTMLSpanElement | null>(null)
  const copyButtonRef = useRef<HTMLButtonElement | null>(null)

  const baseUrl = window.location.origin

  useEffect(() => {
    document.title = "dashboard — Chat Faucet"
  }, [])

  async function refresh() {
    try {
      const r = await getJson<{ keys: ApiKeyPublic[] }>("/api/keys")
      setKeys(r.keys)
      setKeysErr(null)
    } catch (e) {
      setKeysErr(messageFromError(e))
    }
  }

  async function refreshUsage() {
    try {
      const r = await fetch("/api/usage", { credentials: "include" })
      if (!r.ok) {
        setUsageErr(`${r.status} ${await r.text()}`)
        return
      }
      setUsage(await r.json())
      setUsageErr(null)
    } catch (e) {
      setUsageErr(String(e))
    }
  }

  useEffect(() => {
    refresh()
    refreshUsage()
    nameInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!newKey) return
    copyButtonRef.current?.focus()
    if (newKeyRef.current) {
      const r = document.createRange()
      r.selectNodeContents(newKeyRef.current)
      const sel = window.getSelection()
      if (sel) {
        sel.removeAllRanges()
        sel.addRange(r)
      }
    }
  }, [newKey])

  useEffect(() => {
    if (!newKey) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== "c" && e.key !== "C") return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return
      e.preventDefault()
      copyNewKey()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKey])

  async function create() {
    try {
      setActionErr(null)
      const r = await postJson<{
        key: string
        id: string
        name: string
      }>("/api/keys", {
        name: name || "default",
      })
      setNewKey(r.key)
      setNewKeyName(r.name)
      setName("")
      refresh()
      setTimeout(() => nameInputRef.current?.focus(), 0)
    } catch (e) {
      setActionErr(`Couldn't create key: ${messageFromError(e)}`)
    }
  }

  async function copyNewKey() {
    if (!newKey) return
    try {
      await navigator.clipboard.writeText(newKey)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 1500)
    } catch {}
  }

  async function revoke(id: string) {
    try {
      setActionErr(null)
      await del(`/api/keys/${id}`)
      setRevokingKey(null)
      refresh()
    } catch (e) {
      setActionErr(`Couldn't revoke key: ${messageFromError(e)}`)
      setRevokingKey(null)
    }
  }

  async function signOut() {
    try {
      setActionErr(null)
      await postJson("/api/auth/sign-out")
      window.location.href = "/"
    } catch (e) {
      setActionErr(`Couldn't sign out: ${messageFromError(e)}`)
    }
  }

  async function deleteAccount() {
    try {
      await del("/api/account")
      window.location.href = "/"
    } catch (e) {
      setDeleteAccountErr(e instanceof Error ? e.message : String(e))
      setConfirmDeleteAccount(false)
    }
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
          <button type="button" onClick={signOut} style={linkButtonStyle}>
            sign out
          </button>
          <ThemeToggle />
        </span>
      </RowSpaceBetween>

      <Card title={`SIGNED IN — ${status.email ?? "(unknown)"}`}>
        Your API keys authenticate requests to the gateway. One key per
        client; revoke any time.
      </Card>

      {actionErr && (
        <>
          <div style={{ height: "1rem" }} />
          <Card title="ACTION FAILED">
            <p style={{ color: "var(--ansi-9-red)" }}>{actionErr}</p>
          </Card>
        </>
      )}

      <div style={{ height: "1rem" }} />

      <Card title="ENDPOINT">
        <pre style={{ margin: 0, overflow: "auto" }}>{`POST ${baseUrl}/v1/responses
GET  ${baseUrl}/v1/models
GET  ${baseUrl}/v1/usage

Authorization: Bearer <your api key>`}</pre>
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="CREATE API KEY">
        <RowSpaceBetween style={{ gap: "1ch", alignItems: "stretch" }}>
          <input
            ref={nameInputRef}
            type="text"
            placeholder="name (e.g. laptop, raycast, ai-sdk)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            onKeyDown={(e) => {
              if (e.key === "Enter") create()
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={64}
          />
          <div style={{ width: "24ch", flexShrink: 0 }}>
            <Button onClick={create}>Create</Button>
          </div>
        </RowSpaceBetween>

        {newKey && (
          <div
            style={{
              marginTop: "1rem",
              padding: "calc(var(--theme-line-height-base) * 0.5rem) 1ch",
              background: "var(--theme-focused-foreground-subdued)",
              color: "var(--theme-text)",
              boxShadow: "inset 0 0 0 2px var(--theme-focused-foreground)",
            }}
          >
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>Save this now</strong> — it won't be shown again.{" "}
              {newKeyName && (
                <span style={{ opacity: 0.7 }}>({newKeyName})</span>
              )}
            </p>
            <p
              style={{
                margin: "0.5rem 0",
                wordBreak: "break-all",
                fontFamily: "inherit",
              }}
            >
              <code ref={newKeyRef}>{newKey}</code>
            </p>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "1ch",
                marginTop: "0.5rem",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setNewKey(null)
                  setNewKeyName(null)
                }}
                style={{
                  ...linkButtonStyle,
                  opacity: 0.6,
                }}
              >
                dismiss
              </button>
              <div style={{ width: "18ch" }}>
                <Button ref={copyButtonRef} onClick={copyNewKey}>
                  {copiedKey ? "Copied ✓" : "Copy  [C]"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="API KEYS">
        {keysErr ? (
          <p style={{ color: "var(--ansi-9-red)" }}>{keysErr}</p>
        ) : keys == null ? (
          <span>
            Loading <BlockLoader mode={1} />
          </span>
        ) : keys.length === 0 ? (
          <span>No keys yet. Create one above.</span>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    background: "var(--ansi-240-gray-35)",
                    color: "var(--color-white)",
                  }}
                >
                  <td style={thStyle}>NAME</td>
                  <td style={thStyle}>PREFIX</td>
                  <td style={thStyle}>CREATED</td>
                  <td style={thStyle}>LAST USED</td>
                  <td style={thStyle}>STATUS</td>
                  <td style={thStyle}></td>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td style={tdStyle}>{k.name}</td>
                    <td style={tdStyle}>
                      <code>{k.prefix}…</code>
                    </td>
                    <td style={tdStyle} title={absDate(k.created_at)}>
                      {relDate(k.created_at)}
                    </td>
                    <td
                      style={tdStyle}
                      title={k.last_used_at ? absDate(k.last_used_at) : ""}
                    >
                      {k.last_used_at ? (
                        relDate(k.last_used_at)
                      ) : (
                        <span style={{ opacity: 0.5 }}>never</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {k.revoked_at ? (
                        <Badge
                          style={{ background: "var(--ansi-248-gray-66)" }}
                        >
                          revoked
                        </Badge>
                      ) : (
                        <Badge
                          style={{
                            background: "var(--ansi-10-lime)",
                            color: "var(--color-black)",
                          }}
                        >
                          active
                        </Badge>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {!k.revoked_at && (
                        <button
                          onClick={() => setRevokingKey(k)}
                          style={linkButtonStyle}
                        >
                          revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="USAGE">
        <RowSpaceBetween style={{ marginBottom: "0.5rem" }}>
          <span style={{ opacity: 0.7 }}>ChatGPT-plan quota</span>
          <button
            type="button"
            onClick={refreshUsage}
            style={linkButtonStyle}
          >
            refresh
          </button>
        </RowSpaceBetween>
        {usageErr ? (
          <p style={{ color: "var(--ansi-9-red)" }}>{usageErr}</p>
        ) : usage == null ? (
          <span>
            Loading <BlockLoader mode={1} />
          </span>
        ) : (
          <UsageMeter data={usage} />
        )}
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="ACCOUNT">
        <RowSpaceBetween style={{ alignItems: "baseline", gap: "2ch" }}>
          <span style={{ opacity: 0.7 }}>
            Permanently delete your account, tokens, sessions, and API keys.
          </span>
          <button
            type="button"
            onClick={() => {
              setDeleteAccountErr(null)
              setConfirmDeleteAccount(true)
            }}
            style={{ ...linkButtonStyle, color: "var(--ansi-9-red)" }}
          >
            delete account
          </button>
        </RowSpaceBetween>
        {deleteAccountErr && (
          <p style={{ color: "var(--ansi-9-red)", marginTop: "0.5rem" }}>
            {deleteAccountErr}
          </p>
        )}
      </Card>

      {revokingKey && (
        <Dialog
          title="REVOKE KEY"
          confirmLabel="Revoke"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => revoke(revokingKey.id)}
          onCancel={() => setRevokingKey(null)}
        >
          <p>
            Revoke <strong>{revokingKey.name}</strong>{" "}
            <code>{revokingKey.prefix}…</code>?
          </p>
          <p style={{ opacity: 0.75, marginTop: "0.5rem" }}>
            Any client using this key will stop working. This cannot be
            undone.
          </p>
        </Dialog>
      )}

      {confirmDeleteAccount && (
        <Dialog
          title="DELETE ACCOUNT"
          confirmLabel="Delete account"
          cancelLabel="Cancel"
          destructive
          onConfirm={deleteAccount}
          onCancel={() => setConfirmDeleteAccount(false)}
        >
          <p>
            Delete your Chat Faucet account for{" "}
            <strong>{status.email ?? "(unknown)"}</strong>?
          </p>
          <p style={{ opacity: 0.75, marginTop: "0.5rem" }}>
            This removes stored ChatGPT tokens, all API keys, and web sessions.
            Any client using this account will stop working.
          </p>
        </Dialog>
      )}
    </Window>
  )
}

interface Limit {
  label: string
  pct: number
  used?: number
  max?: number
  resetIn?: number
}

function UsageMeter({ data }: { data: unknown }) {
  const limits = extractLimits(data)
  const plan = pickPlan(data)
  if (limits.length === 0) {
    return (
      <>
        {plan && (
          <p style={{ marginBottom: "0.5rem" }}>
            Plan: <strong>{plan}</strong>
          </p>
        )}
        <pre style={{ margin: 0, overflow: "auto", opacity: 0.7 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </>
    )
  }
  return (
    <>
      {plan && (
        <p style={{ marginBottom: "0.75rem" }}>
          Plan: <strong>{plan}</strong>
        </p>
      )}
      {limits.map((lim, i) => (
        <div key={i} style={{ marginBottom: "0.75rem" }}>
          <RowSpaceBetween style={{ marginBottom: "0.25rem" }}>
            <span>{lim.label}</span>
            <span style={{ opacity: 0.7 }}>
              {lim.used != null && lim.max != null
                ? `${fmt(lim.used)} / ${fmt(lim.max)}`
                : `${Math.round(lim.pct)}%`}
              {lim.resetIn != null && (
                <span style={{ marginLeft: "2ch", opacity: 0.7 }}>
                  resets {formatReset(lim.resetIn)}
                </span>
              )}
            </span>
          </RowSpaceBetween>
          <BarLoader progress={Math.max(0, Math.min(100, lim.pct))} />
        </div>
      ))}
    </>
  )
}

function pickPlan(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  const v = d.plan_type ?? d.plan ?? d.subscription_plan
  return typeof v === "string" ? v : null
}

function extractLimits(data: unknown): Limit[] {
  if (!data || typeof data !== "object") return []
  const d = data as Record<string, unknown>

  const limits: Limit[] = []
  const addWindows = (prefix: string, rl: Record<string, unknown>) => {
    for (const winKey of ["primary_window", "secondary_window"]) {
      const w = rl[winKey]
      if (!w || typeof w !== "object") continue
      const o = w as Record<string, unknown>
      const pct = pickPct(o)
      if (pct == null) continue
      limits.push({
        label: `${prefix}${windowLabel(winKey, o.limit_window_seconds)}`,
        pct,
        resetIn:
          typeof o.reset_after_seconds === "number"
            ? o.reset_after_seconds
            : typeof o.reset_in_seconds === "number"
              ? o.reset_in_seconds
              : typeof o.resets_in_seconds === "number"
                ? o.resets_in_seconds
                : undefined,
      })
    }
  }

  if (d.rate_limit && typeof d.rate_limit === "object") {
    addWindows("", d.rate_limit as Record<string, unknown>)
  }

  if (Array.isArray(d.additional_rate_limits)) {
    for (const extra of d.additional_rate_limits) {
      if (!extra || typeof extra !== "object") continue
      const e = extra as Record<string, unknown>
      const name =
        (typeof e.limit_name === "string" && e.limit_name) ||
        (typeof e.metered_feature === "string" && e.metered_feature) ||
        "extra"
      const rl = e.rate_limit
      if (rl && typeof rl === "object") {
        addWindows(`${name} — `, rl as Record<string, unknown>)
      }
    }
  }

  if (limits.length === 0) {
    if (Array.isArray(d.rate_limits)) {
      d.rate_limits.forEach((x: unknown, i: number) => {
        if (!x || typeof x !== "object") return
        const o = x as Record<string, unknown>
        const pct = pickPct(o)
        if (pct == null) return
        limits.push({
          label:
            (typeof o.name === "string" && o.name) ||
            (typeof o.type === "string" && o.type) ||
            `limit ${i + 1}`,
          pct,
          used: typeof o.used === "number" ? o.used : undefined,
          max:
            typeof o.max === "number"
              ? o.max
              : typeof o.limit === "number"
                ? o.limit
                : undefined,
          resetIn:
            typeof o.reset_after_seconds === "number"
              ? o.reset_after_seconds
              : typeof o.reset_in_seconds === "number"
                ? o.reset_in_seconds
                : undefined,
        })
      })
    }
  }

  return limits
}

function windowLabel(key: string, limitSeconds: unknown): string {
  if (typeof limitSeconds === "number") {
    if (limitSeconds >= 86400 * 7) return "weekly"
    if (limitSeconds >= 86400) return `${Math.round(limitSeconds / 86400)}-day`
    if (limitSeconds >= 3600) return `${Math.round(limitSeconds / 3600)}-hour`
    if (limitSeconds >= 60) return `${Math.round(limitSeconds / 60)}-minute`
  }
  return key.replace(/_window$/, "").replace(/_/g, " ")
}

function pickPct(item: Record<string, unknown>): number | null {
  if (typeof item.used_percent === "number") return item.used_percent
  if (typeof item.usage_percent === "number") return item.usage_percent
  if (typeof item.used === "number" && typeof item.max === "number" && item.max > 0) {
    return (item.used / item.max) * 100
  }
  if (
    typeof item.used === "number" &&
    typeof item.limit === "number" &&
    item.limit > 0
  ) {
    return (item.used / item.limit) * 100
  }
  return null
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatReset(seconds: number): string {
  if (seconds < 60) return `in ${Math.round(seconds)}s`
  if (seconds < 3600) return `in ${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `in ${Math.round(seconds / 3600)}h`
  return `in ${Math.round(seconds / 86400)}d`
}

function relDate(secs: number): string {
  const diff = Date.now() / 1000 - secs
  if (diff < 45) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))} w ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))} mo ago`
  return `${Math.floor(diff / (86400 * 365))} y ago`
}

function absDate(secs: number): string {
  return new Date(secs * 1000).toLocaleString()
}

function messageFromError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: "inherit",
  fontSize: "inherit",
  background: "var(--theme-background-input)",
  color: "var(--theme-text)",
  border: 0,
  boxShadow: "inset 0 0 0 2px var(--theme-border)",
  padding: "0 1ch",
  lineHeight: "calc(var(--theme-line-height-base) * 2em)",
  outline: "none",
}

const thStyle: React.CSSProperties = {
  padding: "0 2ch 0 0",
  textAlign: "left",
  fontWeight: 400,
}

const tdStyle: React.CSSProperties = {
  padding: "0 2ch 0 0",
  verticalAlign: "top",
}

const linkButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--theme-text)",
  border: 0,
  padding: 0,
  fontFamily: "inherit",
  fontSize: "inherit",
  cursor: "pointer",
  textDecoration: "underline",
}
