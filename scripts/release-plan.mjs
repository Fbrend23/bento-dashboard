// Pure part of `npm run release:win`: decides what to upload, or why not to. No I/O here so it can
// be tested (tests/release-plan.test.ts). The I/O lives in scripts/publish-release.mjs.

const SEMVER = /^\d+\.\d+\.\d+$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** Where the French release notes of a version live (the version comes from package.json). */
export function notesFileFor(version) {
  return `release-notes/${version}.md`
}

/** "git+https://github.com/owner/repo.git" (or ssh, or plain) -> "owner/repo", else null. */
export function parseRepository(url) {
  if (typeof url !== 'string') return null
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * @param {{
 *   version: string,
 *   repo: string,
 *   distFiles: string[],
 *   latestYml: string | null,
 *   remoteTags: string[],
 *   releaseExists: boolean,
 *   notesFile?: string | null
 * }} input
 * @returns {{ ok: true, tag: string, args: string[] } | { ok: false, error: string }}
 */
export function planRelease({
  version,
  repo,
  distFiles,
  latestYml,
  remoteTags,
  releaseExists,
  notesFile = null
}) {
  if (!SEMVER.test(version)) return fail(`Version invalide dans package.json : "${version}".`)
  if (!REPO.test(repo)) return fail(`Dépôt invalide : "${repo}".`)

  const tag = `v${version}`
  const files = [
    `bento-dashboard-${version}-setup.exe`,
    `bento-dashboard-${version}-setup.exe.blockmap`,
    'latest.yml'
  ]

  const missing = files.filter((file) => !distFiles.includes(file))
  if (missing.length > 0) return fail(`Fichiers manquants dans dist/ : ${missing.join(', ')}.`)

  const announced = latestYml?.match(/^version:\s*(\S+)\s*$/m)?.[1]
  if (announced !== version) {
    return fail(
      `latest.yml annonce la version ${announced ?? 'inconnue'}, pas ${version} : le build est périmé.`
    )
  }

  if (!remoteTags.includes(tag)) {
    return fail(`Le tag ${tag} n'est pas poussé. Lancez : git tag ${tag} && git push origin ${tag}`)
  }

  if (releaseExists) {
    return fail(
      `La release ${tag} existe déjà. Pour la refaire : gh release delete ${tag} --repo ${repo} --yes`
    )
  }

  return {
    ok: true,
    tag,
    args: [
      'release',
      'create',
      tag,
      ...files.map((file) => `dist/${file}`),
      '--repo',
      repo,
      '--title',
      `Bento Dashboard ${version}`,
      // The notes written for this version, else GitHub's bare changelog link.
      ...(notesFile ? ['--notes-file', notesFile] : ['--generate-notes'])
    ]
  }
}

function fail(error) {
  return { ok: false, error }
}
