import { describe, expect, it } from 'vitest'
import { authorize, type AuthRequest } from '../src/agent/auth'

const LOGIN = 'owner@example.com'
const ORIGIN = 'https://bento.example.ts.net'

const get = (headers: AuthRequest['headers'] = {}): AuthRequest => ({
  method: 'GET',
  headers: { 'tailscale-user-login': LOGIN, ...headers }
})

const post = (headers: AuthRequest['headers'] = {}): AuthRequest => ({
  method: 'POST',
  headers: {
    'tailscale-user-login': LOGIN,
    host: 'bento.example.ts.net',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-bento-agent': '1',
    ...headers
  }
})

const options = { allowedLogin: LOGIN }

describe('authorize: identity', () => {
  it('lets the allowed Tailscale login read', () => {
    expect(authorize(get(), options)).toEqual({ ok: true })
  })

  it('refuses a missing, empty or foreign login with 403', () => {
    for (const request of [
      { method: 'GET', headers: {} },
      get({ 'tailscale-user-login': '' }),
      get({ 'tailscale-user-login': 'someone@example.com' }),
      get({ 'tailscale-user-login': [LOGIN, LOGIN] })
    ]) {
      expect(authorize(request, options)).toEqual({ ok: false, status: 403 })
    }
  })

  it('refuses everything when no login is configured', () => {
    expect(authorize(get(), { allowedLogin: '' })).toEqual({ ok: false, status: 403 })
    expect(authorize(get({ 'tailscale-user-login': '' }), { allowedLogin: '' })).toEqual({
      ok: false,
      status: 403
    })
  })
})

describe('authorize: cross-site reads', () => {
  it('allows same-origin and direct navigation, refuses cross-site fetches', () => {
    expect(authorize(get({ 'sec-fetch-site': 'same-origin' }), options).ok).toBe(true)
    expect(authorize(get({ 'sec-fetch-site': 'none' }), options).ok).toBe(true)
    expect(authorize(get({ 'sec-fetch-site': 'cross-site' }), options)).toEqual({
      ok: false,
      status: 403
    })
    expect(authorize(get({ 'sec-fetch-site': 'same-site' }), options)).toEqual({
      ok: false,
      status: 403
    })
  })
})

describe('authorize: opening the page from elsewhere', () => {
  it('allows a top-level navigation whatever the origin (a link, a shortcut, another app)', () => {
    for (const site of ['cross-site', 'same-site', 'same-origin', 'none']) {
      const request = get({
        'sec-fetch-site': site,
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document'
      })
      expect(authorize(request, options)).toEqual({ ok: true })
    }
  })

  it('still needs the login for a navigation', () => {
    const request = get({
      'tailscale-user-login': 'someone@example.com',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document'
    })
    expect(authorize(request, options)).toEqual({ ok: false, status: 403 })
  })

  it('does not extend to subresources, scripts or fetches from another site', () => {
    for (const [mode, dest] of [
      ['no-cors', 'image'],
      ['cors', 'empty'],
      ['no-cors', 'script'],
      ['navigate', 'iframe']
    ]) {
      const request = get({
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': mode,
        'sec-fetch-dest': dest
      })
      expect(authorize(request, options)).toEqual({ ok: false, status: 403 })
    }
  })

  it('never lets a navigation through for an action', () => {
    const request = post({
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document'
    })
    expect(authorize(request, options)).toEqual({ ok: false, status: 403 })
  })
})

describe('authorize: actions (POST)', () => {
  it('accepts a same-origin JSON request carrying the custom header', () => {
    expect(authorize(post(), options)).toEqual({ ok: true })
  })

  it('accepts a JSON content type with a charset', () => {
    expect(authorize(post({ 'content-type': 'application/json; charset=utf-8' }), options).ok).toBe(
      true
    )
  })

  it('refuses a missing or wrong custom header with 403', () => {
    expect(authorize(post({ 'x-bento-agent': undefined }), options)).toEqual({
      ok: false,
      status: 403
    })
    expect(authorize(post({ 'x-bento-agent': '0' }), options)).toEqual({ ok: false, status: 403 })
  })

  it('refuses anything but same-origin, including a missing Sec-Fetch-Site', () => {
    for (const value of ['cross-site', 'same-site', 'none', undefined]) {
      expect(authorize(post({ 'sec-fetch-site': value }), options)).toEqual({
        ok: false,
        status: 403
      })
    }
  })

  it('refuses a missing or foreign Origin', () => {
    expect(authorize(post({ origin: undefined }), options)).toEqual({ ok: false, status: 403 })
    expect(authorize(post({ origin: 'https://evil.example' }), options)).toEqual({
      ok: false,
      status: 403
    })
    expect(authorize(post({ origin: 'null' }), options)).toEqual({ ok: false, status: 403 })
  })

  it('refuses an Origin whose host differs from the Host header', () => {
    expect(authorize(post({ host: 'other.example.ts.net' }), options)).toEqual({
      ok: false,
      status: 403
    })
  })

  it('compares with the configured origin when there is one', () => {
    const configured = { ...options, allowedOrigin: ORIGIN }
    // Host rewritten by the proxy: the configured origin is what counts.
    expect(authorize(post({ host: '127.0.0.1:8484' }), configured).ok).toBe(true)
    expect(authorize(post({ origin: 'https://evil.example' }), configured)).toEqual({
      ok: false,
      status: 403
    })
  })

  it('refuses a form-style content type with 415', () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', undefined]) {
      expect(authorize(post({ 'content-type': type }), options)).toEqual({
        ok: false,
        status: 415
      })
    }
  })

  it('checks identity before anything else', () => {
    expect(
      authorize(
        post({ 'tailscale-user-login': 'x@example.com', 'content-type': 'text/plain' }),
        options
      )
    ).toEqual({ ok: false, status: 403 })
  })
})
