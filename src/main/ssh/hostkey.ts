import { createHash } from 'crypto'

/** OpenSSH-style fingerprint: "SHA256:" + unpadded base64 of the key's SHA-256. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

/** Refuses every key unless a fingerprint was pinned and matches exactly. */
export function isTrustedHostKey(key: Buffer, pinnedFingerprint: string | undefined): boolean {
  return !!pinnedFingerprint && fingerprintOf(key) === pinnedFingerprint
}
