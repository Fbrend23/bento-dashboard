// Assembles the bento agent into one archive to copy to bento: the bundled agent, the built
// phone page, the systemd unit and an example config. Run through `npm run package:agent`.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
// Node runs the tools' own entry points: no shell, nothing to escape.
const tool = (path, args) => run(process.execPath, [path, ...args])

tool('node_modules/vite/bin/vite.js', ['build', '-c', 'vite.agent.config.ts'])
tool('node_modules/vue-tsc/bin/vue-tsc.js', [
  '--noEmit',
  '-p',
  'tsconfig.web.json',
  '--composite',
  'false'
])
tool('node_modules/vite/bin/vite.js', ['build', '-c', 'vite.mobile.config.ts'])

const name = `bento-agent-${pkg.version}`
const out = join('dist-agent', 'package')
const folder = join(out, name)
rmSync(out, { recursive: true, force: true })
mkdirSync(folder, { recursive: true })

for (const [from, to] of [
  ['dist-agent/bento-agent.cjs', 'bento-agent.cjs'],
  ['dist-mobile', 'public'],
  ['scripts/bento-agent.service', 'bento-agent.service'],
  ['scripts/bento-agent.config.example.json', 'config.example.json']
]) {
  if (!existsSync(from)) throw new Error(`Missing ${from}: the build did not produce it.`)
  cpSync(from, join(folder, to), { recursive: true })
}

run('tar', ['-czf', join(out, `${name}.tar.gz`), '-C', out, name])
console.log(`\nArchive: ${join(out, `${name}.tar.gz`)}`)
