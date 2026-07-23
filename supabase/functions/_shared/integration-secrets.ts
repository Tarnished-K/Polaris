export type EncryptedSecret = {
  version: 1
  algorithm: 'AES-GCM'
  iv: string
  ciphertext: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(encodedKey)
  if (bytes.byteLength !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY_INVALID')
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptIntegrationSecret(value: string, encodedKey: string): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(encodedKey),
    new TextEncoder().encode(value),
  )
  return {
    version: 1,
    algorithm: 'AES-GCM',
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptIntegrationSecret(secret: EncryptedSecret, encodedKey: string): Promise<string> {
  if (secret?.version !== 1 || secret?.algorithm !== 'AES-GCM') throw new Error('INTEGRATION_SECRET_FORMAT_INVALID')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(secret.iv) },
    await encryptionKey(encodedKey),
    base64ToBytes(secret.ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}
