import { readFile } from 'fs/promises'
import { join } from 'path'
import { AgentConfigError, parseAgentConfig } from './config'
import { createLocalSession } from './local-session'
import { createAgentServer } from './server'
import { createAgentService } from './service'

// Entry of the bento agent (systemd unit scripts/bento-agent.service). It always listens on
// loopback: only `tailscale serve` is meant to reach it, and the login header it adds is only
// trustworthy for that reason.
const LOOPBACK = '127.0.0.1'
const DEFAULT_CONFIG_PATH = '/etc/bento-agent/config.json'

async function main(): Promise<void> {
  const configPath = process.env.BENTO_AGENT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = parseAgentConfig(await readFile(configPath, 'utf-8'))

  const session = createLocalSession()
  const service = createAgentService({
    exec: (command, options) => session.exec(command, options),
    labels: { containerLabels: config.containerLabels, stackLabels: config.stackLabels },
    hiddenContainers: config.hiddenContainers
  })
  const server = createAgentServer({
    service,
    auth: { allowedLogin: config.allowedLogin, allowedOrigin: config.allowedOrigin },
    staticDir: process.env.BENTO_AGENT_STATIC ?? join(__dirname, 'public'),
    onRefused: (line) => console.warn(line)
  })

  server.listen(config.port, LOOPBACK, () => {
    console.log(`bento-agent listening on ${LOOPBACK}:${config.port}`)
  })
  const stop = (): void => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((error: unknown) => {
  // The message of a config error names the field only, never a value.
  console.error(
    error instanceof AgentConfigError
      ? `Invalid config: ${error.message}`
      : 'bento-agent could not start (is the config readable?)'
  )
  process.exit(1)
})
