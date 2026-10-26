import { readFile } from 'fs/promises'
import { join } from 'path'
import { createHistory } from '../main/history/history'
import { createHistoryStore } from '../main/history/store'
import { createFileRunningMemory } from '../main/monitors/running-memory'
import { createAlerts } from './alerts'
import { AgentConfigError, parseAgentConfig } from './config'
import { createDiscordSender } from './discord'
import { createHistoryFeed } from './history'
import { createLocalSession } from './local-session'
import type { NotificationSender } from './notification'
import { createNtfySender } from './ntfy'
import { createNotifyServer, listenWithRetry } from './notify-server'
import { createAgentServer } from './server'
import { createAgentService } from './service'

// Entry of the bento agent (systemd unit scripts/bento-agent.service). It always listens on
// loopback: only `tailscale serve` is meant to reach it, and the login header it adds is only
// trustworthy for that reason.
const LOOPBACK = '127.0.0.1'
const DEFAULT_CONFIG_PATH = '/etc/bento-agent/config.json'
// Created for bento-dash by the unit (StateDirectory=bento-agent); the desktop reads this file.
const DEFAULT_HISTORY_PATH = '/var/lib/bento-agent/history.json'
// Containers seen running, kept across restarts so one that fell while the agent was down still alerts.
const DEFAULT_RUNNING_PATH = '/var/lib/bento-agent/running.json'

async function main(): Promise<void> {
  const configPath = process.env.BENTO_AGENT_CONFIG ?? DEFAULT_CONFIG_PATH
  const config = parseAgentConfig(await readFile(configPath, 'utf-8'))

  const history = await createHistory({
    store: createHistoryStore(process.env.BENTO_AGENT_HISTORY ?? DEFAULT_HISTORY_PATH)
  })
  const memory = await createFileRunningMemory(
    process.env.BENTO_AGENT_RUNNING ?? DEFAULT_RUNNING_PATH
  )
  // Without a channel there is no notification at all.
  const senders: NotificationSender[] = []
  if (config.discordWebhookUrl) {
    senders.push(
      createDiscordSender({
        url: config.discordWebhookUrl,
        mentionUserId: config.discordMentionUserId,
        log: (line) => console.warn(line)
      })
    )
  }
  if (config.ntfyTopic) {
    senders.push(
      createNtfySender({
        topic: config.ntfyTopic,
        url: config.ntfyUrl,
        token: config.ntfyToken,
        log: (line) => console.warn(line)
      })
    )
  }
  const alerts = senders.length > 0 ? createAlerts() : null
  const feedHistory = createHistoryFeed(history)
  const session = createLocalSession()
  const service = createAgentService({
    exec: (command, options) => session.exec(command, options),
    labels: { containerLabels: config.containerLabels, stackLabels: config.stackLabels },
    hiddenContainers: config.hiddenContainers,
    diskThresholdPercent: config.diskThresholdPercent,
    memory,
    quiet: (container, durationMs) => alerts?.suppress(container, durationMs),
    onStatus: (status) => {
      feedHistory(status)
      // The senders queue and swallow their own failures: they can neither block nor break a read.
      if (alerts) {
        for (const message of alerts.update(status))
          for (const sender of senders) void sender.send(message)
      }
    }
  })
  const server = createAgentServer({
    service,
    history,
    auth: { allowedLogin: config.allowedLogin, allowedOrigin: config.allowedOrigin },
    staticDir: process.env.BENTO_AGENT_STATIC ?? join(__dirname, 'public'),
    onRefused: (line) => console.warn(line)
  })

  // Scripts and media apps push through their own server, on a private address, with a token.
  const notifyServer =
    config.notifyListen && config.notifyToken && senders.length > 0
      ? createNotifyServer({
          token: config.notifyToken,
          send: (message) => {
            for (const sender of senders) void sender.send(message)
          },
          log: (line) => console.warn(line)
        })
      : null
  if (config.notifyListen && notifyServer) {
    listenWithRetry(notifyServer, config.notifyListen, (line) => console.log(line))
  } else if (config.notifyListen) {
    console.warn('notify: notifyListen is set but no channel (discord, ntfy) is configured')
  }

  server.listen(config.port, LOOPBACK, () => {
    console.log(`bento-agent listening on ${LOOPBACK}:${config.port}`)
    // Reads bento on its own from now on, so the history goes on while nobody opens the page.
    service.start()
  })
  const stop = (): void => {
    service.stop()
    // The minute in progress and the last changes are written before anything else: the process
    // may be killed a few seconds later.
    history.flushSync()
    void memory.flush()
    notifyServer?.close()
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
