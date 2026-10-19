import { describe, expect, it } from 'vitest'
import { planDeploy } from '../scripts/deploy-plan.mjs'

const VERSION = '1.3.0'

describe('planDeploy', () => {
  it('defaults to the ssh alias "bento"', () => {
    expect(planDeploy({ args: [], env: {}, version: VERSION })).toEqual({
      ok: true,
      host: 'bento',
      archive: `dist-agent/package/bento-agent-${VERSION}.tar.gz`,
      archiveName: `bento-agent-${VERSION}.tar.gz`
    })
  })

  it('takes the host from the first argument, then from BENTO_DEPLOY_HOST', () => {
    const env = { BENTO_DEPLOY_HOST: 'from-env' }
    expect(planDeploy({ args: ['from-arg'], env, version: VERSION })).toMatchObject({
      host: 'from-arg'
    })
    expect(planDeploy({ args: [], env, version: VERSION })).toMatchObject({ host: 'from-env' })
  })

  it('refuses a host that could be read as an ssh option or carry extra words', () => {
    for (const host of ['-oProxyCommand=x', 'a b', 'a;b', '$(id)', '', 'a\nb', '@h']) {
      const plan = planDeploy({ args: [host], env: {}, version: VERSION })
      // An empty argument falls back to the default rather than being passed on.
      if (host === '') expect(plan).toMatchObject({ ok: true, host: 'bento' })
      else expect(plan).toMatchObject({ ok: false })
    }
  })

  it('accepts user@host and dotted names', () => {
    expect(planDeploy({ args: ['me@bento.example'], env: {}, version: VERSION })).toMatchObject({
      ok: true,
      host: 'me@bento.example'
    })
  })

  it('refuses an invalid version, which would end up in a remote path', () => {
    for (const version of ['1.0', '1.0.0; rm -rf /', '../1.0.0', '']) {
      expect(planDeploy({ args: [], env: {}, version })).toMatchObject({ ok: false })
    }
  })
})
