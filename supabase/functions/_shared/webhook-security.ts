export type AssistantProvider = 'line' | 'discord'

const encoder = new TextEncoder()

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null
  return Uint8Array.from(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)))
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

export async function externalUserHash(
  provider: AssistantProvider,
  externalUserId: string,
  secret: string,
): Promise<string> {
  if (!secret || externalUserId.length < 3 || externalUserId.length > 256) {
    throw new Error('INVALID_EXTERNAL_USER')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${provider}:${externalUserId}`),
  )
  return bytesToHex(new Uint8Array(signature))
}

export async function verifyLineSignature(
  rawBody: string,
  signature: string,
  channelSecret: string,
): Promise<boolean> {
  const expected = base64ToBytes(signature)
  if (!expected || !channelSecret) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const actual = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)))
  return equalBytes(actual, expected)
}

export async function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  applicationPublicKeyHex: string,
): Promise<boolean> {
  const signature = hexToBytes(signatureHex)
  const publicKey = hexToBytes(applicationPublicKeyHex)
  if (!signature || signature.length !== 64 || !publicKey || publicKey.length !== 32 || !/^\d{10,13}$/.test(timestamp)) {
    return false
  }
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      arrayBuffer(publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
      'Ed25519',
      key,
      arrayBuffer(signature),
      encoder.encode(timestamp + rawBody),
    )
  } catch {
    return false
  }
}

export function discordTimestampMilliseconds(timestamp: string): number | null {
  if (!/^\d{10}$/.test(timestamp)) return null
  const value = Number(timestamp) * 1000
  return Number.isSafeInteger(value) ? value : null
}

export function isFreshTimestamp(
  timestampMs: number,
  nowMs = Date.now(),
  maxAgeMs = 5 * 60 * 1000,
): boolean {
  return Number.isSafeInteger(timestampMs)
    && timestampMs <= nowMs + 5 * 60 * 1000
    && timestampMs >= nowMs - maxAgeMs
}
