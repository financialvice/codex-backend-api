import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import Window from "../srcl/components/Window"
import Card from "../srcl/components/Card"
import Button from "../srcl/components/Button"
import BlockLoader from "../srcl/components/BlockLoader"
import RowSpaceBetween from "../srcl/components/RowSpaceBetween"
import { ThemeToggle } from "../srcl/theme"
import styles from "./Docs.module.css"

const TOC: { slug: string; label: string }[] = [
  { slug: "agent-setup", label: "Agent setup" },
  { slug: "curl", label: "curl" },
  { slug: "cli", label: "CLI" },
  { slug: "vercel-ai-sdk", label: "Vercel AI SDK" },
  { slug: "openai-node", label: "openai-node" },
  { slug: "cloudflare-agents-think", label: "Cloudflare" },
]

export function Docs({ path, signedIn }: { path: string; signedIn: boolean }) {
  const [pageCopied, setPageCopied] = useState(false)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const { data: md, error } = useQuery({
    queryKey: ["docs", "index"],
    queryFn: async () => {
      const r = await fetch("/api/docs/index")
      if (!r.ok) throw new Error(`${r.status}`)
      return r.text()
    },
    staleTime: 5 * 60_000,
  })
  const err = error ? String(error) : null

  useEffect(() => {
    if (md == null) return

    const legacy =
      path.startsWith("/docs/") && path !== "/docs/" && !path.endsWith(".md")
        ? path.slice("/docs/".length)
        : null
    const hash = legacy ? `#${legacy}` : window.location.hash
    if (hash && hash.length > 1) {
      requestAnimationFrame(() => {
        const el = document.getElementById(hash.slice(1))
        if (el) el.scrollIntoView({ behavior: "instant" as ScrollBehavior })
      })
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          .sort(
            (a, b) =>
              a.getBoundingClientRect().top - b.getBoundingClientRect().top,
          )
        const first = visible[0]
        if (first) {
          const slug = first.id
          if (slug && TOC.some((t) => t.slug === slug)) {
            setActiveSlug(slug)
            const newHash = `#${slug}`
            if (window.location.hash !== newHash) {
              history.replaceState(
                null,
                "",
                window.location.pathname + newHash,
              )
            }
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    )
    TOC.forEach((t) => {
      const el = document.getElementById(t.slug)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [md, path])

  useEffect(() => {
    if (md == null || !contentRef.current) return
    const anchors = contentRef.current.querySelectorAll<HTMLAnchorElement>(
      ".heading-anchor",
    )
    const handlers: Array<() => void> = []
    anchors.forEach((a) => {
      const h = (e: MouseEvent) => {
        e.preventDefault()
        const href = a.getAttribute("href") || ""
        const url =
          window.location.origin + window.location.pathname + href
        navigator.clipboard.writeText(url).catch(() => {})
        history.replaceState(null, "", href)
        const prev = a.textContent
        a.textContent = "✓"
        setTimeout(() => {
          a.textContent = prev
        }, 1200)
      }
      a.addEventListener("click", h)
      handlers.push(() => a.removeEventListener("click", h))
    })
    return () => handlers.forEach((fn) => fn())
  }, [md])

  async function copyPage() {
    if (md == null) return
    await navigator.clipboard.writeText(md)
    setPageCopied(true)
    setTimeout(() => setPageCopied(false), 1500)
  }

  const blocks = useMemo(() => (md ? parseBlocks(md) : []), [md])

  return (
    <Window>
      <RowSpaceBetween style={{ marginBottom: "1rem" }}>
        <Link to="/">← {signedIn ? "dashboard" : "Chat Faucet"}</Link>
        <ThemeToggle />
      </RowSpaceBetween>

      <Card title="JUMP TO">
        <nav className={styles.toc}>
          {TOC.map((t) => (
            <a
              key={t.slug}
              href={`#${t.slug}`}
              className={activeSlug === t.slug ? styles.tocActive : undefined}
            >
              <span className={styles.tocLabel}>{t.label}</span>
              <span className={styles.tocDots} aria-hidden="true" />
              <span className={styles.tocArrow}>→</span>
            </a>
          ))}
        </nav>
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="RAW MARKDOWN">
        <RowSpaceBetween className={styles.rawRow}>
          <span>
            Fetch <a href="/docs.md"><code>/docs.md</code></a> or send{" "}
            <code>Accept: text/markdown</code>.
          </span>
          <div className={styles.rawButton}>
            <Button theme="SECONDARY" onClick={copyPage} disabled={md == null}>
              {pageCopied ? "Copied ✓" : "Copy as markdown"}
            </Button>
          </div>
        </RowSpaceBetween>
      </Card>

      <div style={{ height: "1rem" }} />

      <Card title="DOCS">
        {err ? (
          <p style={{ color: "var(--ansi-9-red)" }}>Failed to load: {err}</p>
        ) : md == null ? (
          <span>
            Loading <BlockLoader mode={1} />
          </span>
        ) : (
          <div ref={contentRef} className={styles.docs}>
            {blocks.map((b, i) =>
              b.kind === "code" ? (
                <CodeBlock key={i} content={b.content} lang={b.lang} />
              ) : (
                <div
                  key={i}
                  dangerouslySetInnerHTML={{ __html: renderProse(b.content) }}
                />
              ),
            )}
          </div>
        )}
      </Card>
    </Window>
  )
}

function CodeBlock({
  content,
  lang,
}: {
  content: string
  lang?: string
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const displayLang =
    lang && lang !== "text" && lang !== "plaintext" ? lang : null
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeBlockHeader}>
        {displayLang && <span className={styles.codeLang}>{displayLang}</span>}
        <button
          type="button"
          className={
            copied
              ? `${styles.codeCopy} ${styles.codeCopiedFlash}`
              : styles.codeCopy
          }
          onClick={copy}
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  )
}

function parseBlocks(
  src: string,
): { kind: "code" | "prose"; content: string; lang?: string }[] {
  const out: { kind: "code" | "prose"; content: string; lang?: string }[] = []
  const lines = src.split("\n")
  let buf: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let codeLang: string | undefined
  const flushProse = () => {
    if (buf.length) {
      out.push({ kind: "prose", content: buf.join("\n") })
      buf = []
    }
  }
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push({
          kind: "code",
          content: codeBuf.join("\n"),
          lang: codeLang,
        })
        codeBuf = []
        codeLang = undefined
        inCode = false
      } else {
        flushProse()
        codeLang = line.slice(3).trim() || undefined
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
    } else {
      buf.push(line)
    }
  }
  flushProse()
  return out
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function safeHref(href: string): string {
  const trimmed = href.trim()
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return trimmed
  }
  return "#"
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function renderProse(s: string): string {
  const headingRepl = (level: number) => (_m: string, title: string) => {
    const id = slugify(title)
    return `<h${level} id="${id}">${title}<a class="heading-anchor" href="#${id}" aria-label="link to section">#</a></h${level}>`
  }
  const html = escapeHtml(s)
    .replace(/^###### (.*)$/gm, headingRepl(6))
    .replace(/^##### (.*)$/gm, headingRepl(5))
    .replace(/^#### (.*)$/gm, headingRepl(4))
    .replace(/^### (.*)$/gm, headingRepl(3))
    .replace(/^## (.*)$/gm, headingRepl(2))
    .replace(/^# (.*)$/gm, headingRepl(1))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_m, label: string, href: string) =>
        `<a href="${safeHref(href)}">${label}</a>`,
    )
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n\n+/g, "</p><p>")
  return `<p>${html}</p>`
}
