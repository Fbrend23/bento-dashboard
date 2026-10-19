import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve('src/renderer/index.html'), 'utf-8')
const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)
const csp = match?.[1] ?? ''

function directive(name: string): string[] {
  const entry = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
  return entry ? entry.split(/\s+/).slice(1) : []
}

describe('renderer content security policy', () => {
  it('is declared in index.html', () => {
    expect(csp).not.toBe('')
  })

  it('restricts default and script sources to self', () => {
    expect(directive('default-src')).toEqual(["'self'"])
    expect(directive('script-src')).toEqual(["'self'"])
  })

  it('never allows unsafe-eval or inline scripts', () => {
    expect(directive('script-src')).not.toContain("'unsafe-eval'")
    expect(directive('script-src')).not.toContain("'unsafe-inline'")
  })

  it('blocks plugins, base tag changes and form submissions', () => {
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('base-uri')).toEqual(["'none'"])
    expect(directive('form-action')).toEqual(["'none'"])
  })

  it('limits network connections to self', () => {
    expect(directive('connect-src')).toEqual(["'self'"])
  })

  it('loads no remote resource', () => {
    expect(csp).not.toMatch(/https?:|wss?:|\*/)
  })
})
