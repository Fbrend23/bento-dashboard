import { isContainerName } from '@shared/actions'

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
  return {
    allowedLogin: raw.allowedLogin.trim(),
    allowedOrigin: origin(raw.allowedOrigin),
    port: port(raw.port),
    containerLabels: labels(raw.containerLabels, 'containerLabels'),
    stackLabels: labels(raw.stackLabels, 'stackLabels'),
    hiddenContainers: hidden(raw.hiddenContainers)
  }
}
