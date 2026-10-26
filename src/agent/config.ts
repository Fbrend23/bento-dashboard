import { isContainerName } from '@shared/actions'
import { DEFAULT_SETTINGS } from '@shared/settings'

/** `/etc/bento-agent/config.json` on bento: root-owned, read by the agent at start. */
export interface AgentConfig {
  /** Tailscale login allowed to use the agent. */
  allowedLogin: string
  /** Origin the PWA is served from, when `tailscale serve` rewrites the Host header. */
  allowedOrigin: string | undefined
  /** Loopback port `tailscale serve` forwards to. The address itself is never configurable. */
  port: number
  containerLabels: Record<string, string>
  stackLabels: Record<string, string>
  hiddenContainers: string[]
  /** Used percentage above which a disk is an incident in the history; as in the desktop settings. */
  diskThresholdPercent: number
  /** Where the agent announces a container or tailscaled going down; none means no notification. */
  discordWebhookUrl: string | undefined
  /** Discord user (numeric id) pinged when something goes down; nobody when absent. */
  discordMentionUserId: string | undefined
  /** ntfy topic receiving the same notifications on the phone; none means no ntfy push. */
  ntfyTopic: string | undefined
  /** Base url of the ntfy server (https); the public ntfy.sh when absent. */
  ntfyUrl: string | undefined
  /** Access token when the ntfy topic is protected. */
  ntfyToken: string | undefined
  /** Where `listen` accepts the pushes of scripts and webhooks (`ip:port`); off when absent. */
  notifyListen: string | undefined
  /** Bearer token those pushes must present; required with `notifyListen`. */
  notifyToken: string | undefined
}

export const DEFAULT_PORT = 8484

export class AgentConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentConfigError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function labels(raw: unknown, field: string): Record<string, string> {
  if (raw === undefined) return {}
  if (!isRecord(raw)) throw new AgentConfigError(`${field} must be an object of strings`)
  const table: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') throw new AgentConfigError(`${field}.${key} must be a string`)
    table[key] = value
  }
  return table
}

function hidden(raw: unknown): string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || !raw.every(isContainerName)) {
    throw new AgentConfigError('hiddenContainers must be a list of container names')
  }
  return [...raw]
}

function origin(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^https:\/\/[^/\s?#]+$/.test(raw)) {
    throw new AgentConfigError('allowedOrigin must look like https://host, with no path')
  }
  return raw
}

function port(raw: unknown): number {
  if (raw === undefined) return DEFAULT_PORT
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1024 || raw > 65535) {
    throw new AgentConfigError('port must be an integer between 1024 and 65535')
  }
  return raw
}

function diskThreshold(raw: unknown): number {
  if (raw === undefined) return DEFAULT_SETTINGS.diskThresholdPercent
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 100) {
    throw new AgentConfigError('diskThresholdPercent must be an integer between 1 and 100')
  }
  return raw
}

function discordWebhook(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  // The url is a secret: the message names the field, never the value.
  if (
    typeof raw !== 'string' ||
    !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(raw)
  ) {
    throw new AgentConfigError('discordWebhookUrl must be a Discord webhook url')
  }
  return raw
}

function discordUserId(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^\d{17,20}$/.test(raw)) {
    throw new AgentConfigError('discordMentionUserId must be a numeric Discord user id')
  }
  return raw
}

function ntfyTopic(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  // On the public server the topic is the only protection: long enough not to be guessed.
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(raw)) {
    throw new AgentConfigError('ntfyTopic must be 16 to 64 letters, digits, "-" or "_"')
  }
  return raw
}

function ntfyUrl(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^https:\/\/[^/\s?#]+$/.test(raw)) {
    throw new AgentConfigError('ntfyUrl must look like https://host, with no path')
  }
  return raw
}

function ntfyToken(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(raw)) {
    throw new AgentConfigError('ntfyToken must be a ntfy access token')
  }
  return raw
}

const PRIVATE_IPV4 =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/

function notifyListen(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  const match = typeof raw === 'string' ? /^([0-9.]+):(\d{4,5})$/.exec(raw) : null
  const octets = match ? match[1].split('.').map(Number) : []
  if (
    !match ||
    !PRIVATE_IPV4.test(match[1]) ||
    octets.some((octet) => octet > 255) ||
    Number(match[2]) < 1024 ||
    Number(match[2]) > 65535
  ) {
    // Never a public address: the entry carries no login, only the token.
    throw new AgentConfigError('notifyListen must be a private IPv4 address and a port, as ip:port')
  }
  return raw as string
}

function notifyToken(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(raw)) {
    throw new AgentConfigError('notifyToken must be 32 to 128 letters, digits, "-" or "_"')
  }
  return raw
}

/** Validates the config text. Anything wrong stops the agent: it must never run half-configured. */
export function parseAgentConfig(text: string): AgentConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AgentConfigError('The config is not valid JSON')
  }
  if (!isRecord(raw)) throw new AgentConfigError('The config must be a JSON object')
  if (typeof raw.allowedLogin !== 'string' || raw.allowedLogin.trim() === '') {
    throw new AgentConfigError('allowedLogin is required')
  }
  const config: AgentConfig = {
    allowedLogin: raw.allowedLogin.trim(),
    allowedOrigin: origin(raw.allowedOrigin),
    port: port(raw.port),
    containerLabels: labels(raw.containerLabels, 'containerLabels'),
    stackLabels: labels(raw.stackLabels, 'stackLabels'),
    hiddenContainers: hidden(raw.hiddenContainers),
    diskThresholdPercent: diskThreshold(raw.diskThresholdPercent),
    discordWebhookUrl: discordWebhook(raw.discordWebhookUrl),
    discordMentionUserId: discordUserId(raw.discordMentionUserId),
    ntfyTopic: ntfyTopic(raw.ntfyTopic),
    ntfyUrl: ntfyUrl(raw.ntfyUrl),
    ntfyToken: ntfyToken(raw.ntfyToken),
    notifyListen: notifyListen(raw.notifyListen),
    notifyToken: notifyToken(raw.notifyToken)
  }
  if ((config.notifyListen === undefined) !== (config.notifyToken === undefined)) {
    throw new AgentConfigError('notifyListen and notifyToken go together')
  }
  return config
}
