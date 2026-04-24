import { createContext, useContext, useEffect, useState } from "react"

export type Theme = "blue" | "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "chf_theme_mode"
const TINT = "tint-blue"
const ALL_THEMES: Theme[] = ["blue", "light", "dark"]

function readStored(): Theme {
  if (typeof localStorage === "undefined") return "blue"
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === "blue" || v === "light" || v === "dark") return v
  return "blue"
}

function applyToRoot(theme: Theme) {
  const root = document.documentElement
  root.classList.remove("theme-blue", "theme-light", "theme-dark")
  root.classList.add(`theme-${theme}`)
  if (!root.classList.contains(TINT)) root.classList.add(TINT)

  const body = document.body
  if (body) {
    body.classList.remove("theme-blue", "theme-light", "theme-dark")
    body.classList.add(`theme-${theme}`)
    if (!body.classList.contains(TINT)) body.classList.add(TINT)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored())

  useEffect(() => {
    applyToRoot(theme)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {}
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

const SWATCH_FILL: Record<Theme, string> = {
  blue: "#0052ff",
  light: "#ffffff",
  dark: "#000000",
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.75ch",
        fontFamily: "inherit",
      }}
    >
      <span className="theme-toggle-label" style={{ opacity: 0.7 }}>
        theme:
      </span>
      {ALL_THEMES.map((t) => {
        const active = theme === t
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            title={t}
            aria-label={`${t} theme`}
            aria-pressed={active}
            style={{
              width: "1em",
              height: "1em",
              padding: 0,
              background: SWATCH_FILL[t],
              color: "inherit",
              border: "1px solid var(--theme-text)",
              boxShadow: active
                ? "0 0 0 2px var(--theme-background), 0 0 0 3px var(--theme-text)"
                : "none",
              cursor: "pointer",
              display: "inline-block",
              boxSizing: "border-box",
              transition: "box-shadow 120ms",
            }}
          />
        )
      })}
    </span>
  )
}
