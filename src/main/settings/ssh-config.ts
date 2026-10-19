import type { Settings } from '@shared/settings'
import type { SshConfig } from '../ssh/ssh2-connector'

/** The key stays in the Windows ssh-agent: no key path or passphrase is stored by the app. */
export function toSshConfig(settings: Settings): SshConfig {
  return {
    host: settings.host,
    port: settings.port,
    username: settings.username,
    hostFingerprint: settings.hostFingerprint,
    auth: { kind: 'agent' }
  }
}
