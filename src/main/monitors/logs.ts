import type { LogsResult } from '@shared/logs'
import { NotConnectedError, type ExecResult } from '../ssh/connection'

export const MAX_LOG_LINES = 200
export const MAX_LINE_LENGTH = 2000

/* eslint-disable no-control-regex -- stripping terminal escapes and control characters is the point */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g
/* eslint-enable no-control-regex */

function clean(line: string): string {
  const text = line.replace(OSC, '').replace(CSI, '').replace(CONTROL, '')
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text
}

/**
 * Raw `docker logs` / `journalctl` output to displayable lines: no terminal escapes (nginx colours
 * its output), no control characters, bounded line length and count. The result is shown as plain
 * text only, never as HTML.
 */
export function parseLogs(output: string): string[] {
  if (output.trim() === '') return []
  const lines = output.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(-MAX_LOG_LINES).map(clean)
}

/** True when sudo refused the command: no matching sudoers rule for bento-dash. */
export function isSudoersRefusal(result: ExecResult): boolean {
  return /a password is required|is not allowed to execute|may not run sudo/i.test(result.stderr)
}

/** A readable French reason for a failed command; never the raw stderr. */
export function describeCommandFailure(result: ExecResult): string {
  if (isSudoersRefusal(result)) {
    return 'Règle sudoers manquante pour bento-dash.'
  }
  if (result.code === 124) return 'Bento a mis trop de temps à répondre.'
  if (/no such container/i.test(result.stderr)) return 'Conteneur introuvable.'
  return result.code === null
    ? 'La commande a échoué.'
    : `La commande a échoué (code ${result.code}).`
}

/** A readable French reason for an exception thrown while running a command. */
export function describeExecError(error: unknown, fallback: string): string {
  if (error instanceof NotConnectedError) return 'Bento est injoignable.'
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return 'Bento a mis trop de temps à répondre.'
  }
  return fallback
}

export function toLogsResult(result: ExecResult, now: number): LogsResult {
  if (result.code !== 0) return { ok: false, error: describeCommandFailure(result) }
  return { ok: true, lines: parseLogs(result.stdout), fetchedAt: now }
}
