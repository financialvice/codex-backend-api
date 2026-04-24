import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import "./srcl/styles/fonts.css"
import "./srcl/styles/global.css"
import { App } from "./App"
import { ThemeProvider } from "./srcl/theme"
import { persister, queryClient } from "./lib/queryClient"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
