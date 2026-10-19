// Pure part of `npm run deploy:agent`: which host, which archive, or why not. No I/O here so it can
// be tested (tests/deploy-plan.test.ts). The I/O lives in scripts/deploy-agent.mjs.

const SEMVER = /^\d+\.\d+\.\d+$/
// An ssh alias or [user@]host: never starts with "-" (it would be read as an option).
const HOST = /^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/
const DEFAULT_HOST = 'bento'

/**
 * @param {{ args: string[], env: Record<string, string | undefined>, version: string }} input
 * @returns {{ ok: true, host: string, archive: string, archiveName: string } | { ok: false, error: string }}
 */
export function planDeploy({ args, env, version }) {
  if (!SEMVER.test(version)) return fail(`Version invalide dans package.json : "${version}".`)
  const host = args[0] || env.BENTO_DEPLOY_HOST || DEFAULT_HOST
  if (!HOST.test(host)) return fail(`Hôte invalide : "${host}".`)
  const archiveName = `bento-agent-${version}.tar.gz`
  return { ok: true, host, archive: `dist-agent/package/${archiveName}`, archiveName }
}

const fail = (error) => ({ ok: false, error })
