// Settings shape shared by main (storage, validation) and renderer (form).

export interface Settings {
  host: string
  port: number
  username: string
  /** Pinned SSH host key fingerprint ("SHA256:…"). */
  hostFingerprint: string
  refreshIntervalSec: number
  /** Containers left out of the dashboard (names only, never used to build commands). */
  hiddenContainers: string[]
  /** Display names by docker container name. Display only: the docker name stays the identifier. */
  containerLabels: Record<string, string>
  /** Display names by compose project. */
  stackLabels: Record<string, string>
  /** Names of the web interfaces behind published host ports. */
  portLabels: Record<number, string>
  /**
   * Containers whose logs can be read. Each one also needs its own exact sudoers rule on bento:
   * this list only decides what the app offers, the rule decides what bento allows.
   */
  logContainers: string[]
  diskThresholdPercent: number
  excludedMounts: string[]
  notifyUnhealthy: boolean
  launchAtStartup: boolean
  /** Download a new version as soon as it is found and restart on it, without asking. */
  autoUpdate: boolean
  /** Also notify when a problem that was notified is over (service back, bento reachable…). */
  notifyRecovery: boolean
  notifyCpu: boolean
  cpuThresholdPercent: number
  notifyMemory: boolean
  memoryThresholdPercent: number
  notifyLoad: boolean
  /** Load average over 1 minute above which the load alert counts. */
  loadThreshold: number
  /** How many consecutive readings above a threshold make a sustained overload. */
  sustainedSamples: number
  quietHoursEnabled: boolean
  /** "HH:MM", local time; the period may cross midnight. */
  quietHoursStart: string
  quietHoursEnd: string
}

/** User-facing (French) message per invalid field; `settings` is for non-object input. */
export type SettingsErrors = Partial<Record<keyof Settings | 'settings', string>>

export const DEFAULT_SETTINGS: Settings = {
  host: '',
  port: 22,
  username: 'bento-dash',
  hostFingerprint: '',
  refreshIntervalSec: 30,
  hiddenContainers: [],
  containerLabels: { jellyfin: 'Jellyfin' },
  stackLabels: {},
  portLabels: { 8096: 'Jellyfin' },
  logContainers: [],
  diskThresholdPercent: 85,
  excludedMounts: ['/boot/efi'],
  notifyUnhealthy: true,
  launchAtStartup: false,
  autoUpdate: false,
  notifyRecovery: true,
  notifyCpu: true,
  cpuThresholdPercent: 90,
  notifyMemory: true,
  memoryThresholdPercent: 90,
  notifyLoad: false,
  loadThreshold: 8,
  sustainedSamples: 3,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00'
}

export type SaveSettingsResult =
  { ok: true; settings: Settings } | { ok: false; errors: SettingsErrors }
