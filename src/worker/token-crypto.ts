const ENCRYPTED_PREFIX = "enc:v1"
const KEY_BYTES = 32
const IV_BYTES = 12

export async function encryptJson(
  secretHex: string,
  value: unknown,
): Promise<string> {
  const key = await importKey(secretHex)
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(plaintext),
    ),
  )
  return `${ENCRYPTED_PREFIX}:${base64UrlEncode(iv)}:${base64UrlEncode(ciphertext)}`
}

export async function decryptJson<T>(
  secretHex: string,
  blob: string,
): Promise<T> {
  const parts = blob.split(":")
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== ENCRYPTED_PREFIX) {
    throw new Error("invalid encrypted token blob")
  }

  const iv = base64UrlDecode(parts[2]!)
  const ciphertext = base64UrlDecode(parts[3]!)
  const key = await importKey(secretHex)
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

async function importKey(secretHex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(secretHex.trim())
  if (bytes.length !== KEY_BYTES) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes as 64 hex chars")
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be hex encoded")
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64UrlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
