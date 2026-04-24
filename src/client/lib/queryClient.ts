import { QueryClient } from "@tanstack/react-query"
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister"
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
})

export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => (await idbGet<string>(key)) ?? null,
    setItem: async (key: string, value: string) => {
      await idbSet(key, value)
    },
    removeItem: async (key: string) => {
      await idbDel(key)
    },
  },
  key: "chatfaucet-rq-cache-v1",
  throttleTime: 1000,
})
