// Builds the agent, copies it to bento and restarts it: `npm run deploy:agent [hôte-ssh]`.
// The host is an ssh alias (default "bento", or BENTO_DEPLOY_HOST). The sudo password, if bento
// asks for one, is typed in the terminal: ssh gets a tty for the last step.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { planDeploy } from './deploy-plan.mjs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const plan = planDeploy({ args: process.argv.slice(2), env: process.env, version: pkg.version })
if (!plan.ok) {
  console.error(plan.error)
  process.exit(1)
}

// No shell anywhere: every command is a program plus its arguments.
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options })

console.log('\n1/3 Empaquetage')
run(process.execPath, ['scripts/package-agent.mjs'])

console.log(`\n2/3 Copie vers ${plan.host}`)
const made = execFileSync('ssh', [plan.host, 'mktemp', '-d'], {
  stdio: ['inherit', 'pipe', 'inherit']
})
const remote = made.toString().trim()
// The folder name comes back from the server: only a plain /tmp path is accepted.
if (!/^\/tmp\/tmp\.[A-Za-z0-9]+$/.test(remote)) {
  console.error(`Dossier distant inattendu : "${remote}".`)
  process.exit(1)
}
run('scp', [plan.archive, 'scripts/deploy-agent.remote.sh', `${plan.host}:${remote}/`])

console.log('\n3/3 Installation et redémarrage')
try {
  run('ssh', ['-t', plan.host, 'bash', `${remote}/deploy-agent.remote.sh`, remote])
} finally {
  run('ssh', [plan.host, 'rm', '-rf', remote])
}
console.log('\nAgent déployé. Fermez puis rouvrez la page sur le téléphone.')
