/// <reference types="vite/client" />

declare global {
  namespace Cloudflare {
    interface Env {
      PROXY_SECRET: string
      TOKEN_ENCRYPTION_KEY: string
    }
  }
}

export {}
