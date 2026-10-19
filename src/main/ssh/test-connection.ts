import type { ConnectionTestResult } from '@shared/connection-test'
import { explainSshError } from '@shared/ssh-errors'
import { toSshConfig } from '../settings/ssh-config'
import { validateSettings } from '../settings/validate'
import { TEST_CONNECTION_COMMAND } from './commands'
import { ConnectionManager, type Connector } from './connection'
import type { SshConfig } from './ssh2-connector'

/** A server that never answers must not leave the button spinning for ever. */
const DEFAULT_TIMEOUT_MS = 25_000

interface Deps {
  createConnector: (config: SshConfig) => Connector
  timeoutMs?: number
}

const fail = (message: string, technical: string | null = null): ConnectionTestResult => ({
  ok: false,
  message,
  technical
})

/** The first problem of the fields a connection depends on, in form order. */
function draftProblem(errors: ReturnType<typeof validateSettings>['errors']): string | null {
  return (
    errors.settings ??
    errors.host ??
    errors.port ??
    errors.username ??
    errors.hostFingerprint ??
    null
  )
}

/**
 * Tries the settings as typed, before they are saved: connects with the agent key, checks the
 * pinned fingerprint, runs one fixed no-op command through the allow-list and closes. The draft
 * comes from the renderer and is validated like saved settings; nothing from it becomes a command.
 */
export async function testConnection(draft: unknown, deps: Deps): Promise<ConnectionTestResult> {
  const { settings, errors } = validateSettings(draft)
  const problem = draftProblem(errors)
  if (problem) return fail(problem)
  if (settings.host === '' || settings.hostFingerprint === '') {
    return fail("Renseignez l'hôte et l'empreinte du serveur avant de tester la connexion.")
  }

  const connector = deps.createConnector(toSshConfig(settings))
  let rawError: string | null = null
  let settle: (outcome: 'online' | 'failed' | 'timeout') => void = () => {}
  const settled = new Promise<'online' | 'failed' | 'timeout'>((resolve) => (settle = resolve))

  // One attempt: the manager would retry on its own, so it is stopped right after the outcome.
  const manager = new ConnectionManager(async () => {
    try {
      return await connector()
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error)
      settle('failed')
      throw error
    }
  })
  manager.onStateChange((state) => {
    if (state === 'online') settle('online')
  })
  const timer = setTimeout(() => settle('timeout'), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    manager.start()
    const outcome = await settled
    if (outcome === 'timeout') {
      return fail(
        explainSshError('Timed out while waiting for handshake') ?? 'bento ne répond pas.'
      )
    }
    if (outcome === 'failed') {
      return fail(explainSshError(rawError) ?? 'La connexion a échoué.', rawError)
    }

    try {
      const result = await manager.run(TEST_CONNECTION_COMMAND)
      if (result.code !== 0) {
        return fail('La connexion fonctionne, mais la commande de test a échoué.')
      }
      return { ok: true }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      return fail(
        explainSshError(raw) ?? 'La connexion fonctionne, mais la commande de test a échoué.',
        raw
      )
    }
  } finally {
    clearTimeout(timer)
    manager.stop()
  }
}
