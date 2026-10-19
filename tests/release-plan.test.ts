import { describe, expect, it } from 'vitest'
import { parseRepository, planRelease } from '../scripts/release-plan.mjs'

const VERSION = '1.0.2'
const FILES = [
  `bento-dashboard-${VERSION}-setup.exe`,
  `bento-dashboard-${VERSION}-setup.exe.blockmap`,
  'latest.yml',
  'builder-debug.yml',
  'win-unpacked'
]

const input = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: VERSION,
  repo: 'Fbrend23/bento-dashboard',
  distFiles: FILES,
  latestYml: `version: ${VERSION}\nfiles:\n  - url: bento-dashboard-${VERSION}-setup.exe\n`,
  remoteTags: ['v1.0.0', 'v1.0.1', `v${VERSION}`],
  releaseExists: false,
  ...overrides
})

describe('planRelease', () => {
  it('uploads the installer, its blockmap and latest.yml under the version tag', () => {
    const plan = planRelease(input())
    expect(plan).toEqual({
      ok: true,
      tag: 'v1.0.2',
      args: [
        'release',
        'create',
        'v1.0.2',
        'dist/bento-dashboard-1.0.2-setup.exe',
        'dist/bento-dashboard-1.0.2-setup.exe.blockmap',
        'dist/latest.yml',
        '--repo',
        'Fbrend23/bento-dashboard',
        '--title',
        'v1.0.2',
        '--generate-notes'
      ]
    })
  })

  it('never uploads anything else from dist', () => {
    const plan = planRelease(input())
    expect(plan.args.join(' ')).not.toMatch(/builder-debug|win-unpacked/)
  })

  it('refuses when a file is missing, and names it', () => {
    const plan = planRelease(input({ distFiles: ['latest.yml'] }))
    expect(plan.ok).toBe(false)
    expect(plan.error).toContain('bento-dashboard-1.0.2-setup.exe')
    expect(plan.error).toContain('bento-dashboard-1.0.2-setup.exe.blockmap')
  })

  it('refuses a stale build whose latest.yml announces another version', () => {
    const plan = planRelease(input({ latestYml: 'version: 1.0.1\n' }))
    expect(plan).toEqual({
      ok: false,
      error: 'latest.yml annonce la version 1.0.1, pas 1.0.2 : le build est périmé.'
    })
  })

  it('refuses a latest.yml without version', () => {
    expect(planRelease(input({ latestYml: 'files: []\n' })).ok).toBe(false)
  })

  it('refuses when the tag is not pushed, with the commands to fix it', () => {
    const plan = planRelease(input({ remoteTags: ['v1.0.0', 'v1.0.1'] }))
    expect(plan.ok).toBe(false)
    expect(plan.error).toContain('git tag v1.0.2')
    expect(plan.error).toContain('git push origin v1.0.2')
  })

  it('refuses when the release already exists, with the command to remove it', () => {
    const plan = planRelease(input({ releaseExists: true }))
    expect(plan.ok).toBe(false)
    expect(plan.error).toContain('gh release delete v1.0.2')
  })

  it('refuses a version that is not semantic', () => {
    expect(planRelease(input({ version: '1.0' })).ok).toBe(false)
    expect(planRelease(input({ version: '1.0.2; rm -rf /' })).ok).toBe(false)
  })

  it('refuses a malformed repository', () => {
    expect(planRelease(input({ repo: 'not a repo' })).ok).toBe(false)
  })
})

describe('parseRepository', () => {
  it.each([
    ['git+https://github.com/Fbrend23/bento-dashboard.git', 'Fbrend23/bento-dashboard'],
    ['https://github.com/Fbrend23/bento-dashboard', 'Fbrend23/bento-dashboard'],
    ['git@github.com:Fbrend23/bento-dashboard.git', 'Fbrend23/bento-dashboard']
  ])('reads %s', (url, expected) => {
    expect(parseRepository(url)).toBe(expected)
  })

  it('returns null for anything else', () => {
    expect(parseRepository('https://example.com/x/y')).toBeNull()
    expect(parseRepository(undefined)).toBeNull()
  })
})
