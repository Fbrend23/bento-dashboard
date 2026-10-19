import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { UPDATE_REPOSITORY } from '../src/main/updater/repository'

const root = resolve(__dirname, '..')
const builder = readFileSync(resolve(root, 'electron-builder.yml'), 'utf-8')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as {
  version: string
  scripts: Record<string, string>
  repository?: { url?: string } | string
}

describe('release configuration', () => {
  it('builds a Windows NSIS installer', () => {
    expect(builder).toMatch(/^win:/m)
    expect(builder).toMatch(/target:\s*\n\s*- nsis/)
  })

  it('publishes to the public GitHub repository the app checks for updates', () => {
    expect(builder).toMatch(/^publish:/m)
    expect(builder).toMatch(/provider: github/)
    const lines = builder.split(/\r?\n/).map((line) => line.trim())
    expect(lines).toContain(`owner: ${UPDATE_REPOSITORY.owner}`)
    expect(lines).toContain(`repo: ${UPDATE_REPOSITORY.repo}`)
    expect(builder).not.toMatch(/private:/)
  })

  it('never writes a token in the build configuration', () => {
    expect(builder).not.toMatch(/token\s*:/i)
    expect(builder).not.toMatch(/github_pat_|ghp_/)
  })

  it('releases through the gh script, never through electron-builder own publisher', () => {
    expect(pkg.scripts['release:win']).toBe('npm run build:win && node scripts/publish-release.mjs')
    expect(pkg.scripts['build:win']).toContain('--publish never')
    expect(JSON.stringify(pkg.scripts)).not.toContain('publish always')
  })

  it('turns off the Electron fuses the app does not need', () => {
    const lines = builder.split(/\r?\n/).map((line) => line.trim())
    expect(lines).toContain('electronFuses:')
    for (const fuse of [
      'runAsNode: false',
      'enableNodeOptionsEnvironmentVariable: false',
      'enableNodeCliInspectArguments: false',
      'enableEmbeddedAsarIntegrityValidation: true',
      'onlyLoadAppFromAsar: true'
    ]) {
      expect(lines).toContain(fuse)
    }
  })

  it('uses a semantic version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('points the package to the repository', () => {
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    expect(url).toContain(`${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}`)
  })
})
