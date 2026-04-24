import { useEffect, useState } from "react"
import { useIsRestoring, useQuery, useQueryClient } from "@tanstack/react-query"
import { Landing } from "./pages/Landing"
import { Dashboard } from "./pages/Dashboard"
import { Docs } from "./pages/Docs"
import { Playground } from "./pages/Playground"
import { getJson, type AuthStatus } from "./lib/api"
import { PageShell } from "./srcl/PageShell"
import BlockLoader from "./srcl/components/BlockLoader"

export function App() {
  const [path, setPath] = useState(window.location.pathname)
  const queryClient = useQueryClient()
  const isRestoring = useIsRestoring()

  const { data: status, isPending } = useQuery({
    queryKey: ["auth-status"],
    queryFn: async () => {
      try {
        return await getJson<AuthStatus>("/api/auth/status")
      } catch {
        return { signedIn: false } as AuthStatus
      }
    },
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  if (path === "/docs" || path.startsWith("/docs/")) {
    return (
      <PageShell>
        <Docs path={path} signedIn={status?.signedIn ?? false} />
      </PageShell>
    )
  }

  if (!status && (isRestoring || isPending)) {
    return (
      <PageShell>
        <span>
          Loading <BlockLoader mode={1} />
        </span>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {status?.signedIn && path === "/playground" ? (
        <Playground />
      ) : status?.signedIn ? (
        <Dashboard status={status} />
      ) : (
        <Landing
          onAuthed={() => {
            queryClient.invalidateQueries({ queryKey: ["auth-status"] })
          }}
        />
      )}
    </PageShell>
  )
}
