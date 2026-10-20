// Publishes dist/ to a GitHub release with the `gh` CLI (already logged in: no token to handle).
// electron-builder's own publisher races when it uploads two files at once, hence this script.
// Run through `npm run release:win`, after the version tag has been pushed.

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { notesFileFor, parseRepository, planRelease } from './release-plan.mjs'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
const repo = parseRepository(
  typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
)

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function remoteTags() {
  return run('git', ['ls-remote', '--tags', 'origin'])
    .split(/\r?\n/)
    .map((line) => line.match(/refs\/tags\/(\S+?)(?:\^\{\})?$/)?.[1])
    .filter(Boolean)
}

function releaseExists(tag) {
  try {
    run('gh', ['release', 'view', tag, '--repo', repo])
    return true
  } catch {
    return false
  }
}

const tag = `v${pkg.version}`
const notesFile = notesFileFor(pkg.version)
const plan = planRelease({
  notesFile: existsSync(notesFile) ? notesFile : null,
  version: pkg.version,
  repo: repo ?? '',
  distFiles: existsSync('dist') ? readdirSync('dist') : [],
  latestYml: existsSync('dist/latest.yml') ? readFileSync('dist/latest.yml', 'utf-8') : null,
  remoteTags: repo ? remoteTags() : [],
  releaseExists: repo ? releaseExists(tag) : false
})

if (!plan.ok) {
  console.error(`\nPublication annulée : ${plan.error}`)
  process.exit(1)
}

console.log(`Publication de ${plan.tag} sur ${repo}…`)
execFileSync('gh', plan.args, { stdio: 'inherit' })
console.log(`\nRelease ${plan.tag} publiée.`)
