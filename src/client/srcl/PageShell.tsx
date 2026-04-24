import type { ReactNode } from "react"

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        maxWidth: "min(90ch, 100%)",
        margin: "calc(var(--theme-line-height-base) * 2rem) auto",
        padding: "0 2ch",
      }}
    >
      {children}
      <AttributionFooter />
    </main>
  )
}

function AttributionFooter() {
  return (
    <footer
      style={{
        marginTop: "calc(var(--theme-line-height-base) * 1.5rem)",
        paddingTop: "calc(var(--theme-line-height-base) * 1rem)",
        paddingLeft: "min(2ch, 4vw)",
        paddingRight: "min(2ch, 4vw)",
        borderTop: "1px solid var(--theme-border-subdued)",
        fontSize: "0.875em",
        lineHeight: "calc(var(--theme-line-height-base) * 1.2em)",
        color: "var(--theme-text)",
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
    </footer>
  )
}
