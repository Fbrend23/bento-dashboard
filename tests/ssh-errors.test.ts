import { describe, expect, it } from 'vitest'
import { explainSshError } from '@shared/ssh-errors'

describe('explainSshError', () => {
  it.each([
    ['Host denied (verification failed)', "L'empreinte du serveur ne correspond pas"],
    ['All configured authentication methods failed', 'a refusé la clé'],
    ['Agent connection failed', "L'agent SSH de Windows est indisponible"],
    ['getaddrinfo ENOTFOUND bento.example.ts.net', "nom de l'hôte est introuvable"],
    ['connect EHOSTUNREACH 192.0.2.7:22', 'bento ne répond pas'],
    ['connect ETIMEDOUT 192.0.2.7:22', 'bento ne répond pas'],
    ['Timed out while waiting for handshake', 'bento ne répond pas'],
    ['connect ECONNREFUSED 192.0.2.7:22', 'Connexion refusée'],
    ['Connection closed before it was ready', 'La connexion a été interrompue'],
    ['Connection closed', 'La connexion a été interrompue'],
    ['read ECONNRESET', 'La connexion a été interrompue']
  ])('explains "%s"', (raw, expected) => {
    expect(explainSshError(raw)).toContain(expected)
  })

  it('tells a slow command from an unreachable server', () => {
    expect(explainSshError('Command timed out after 100000 ms')).toBe(
      'bento a mis trop de temps à répondre.'
    )
  })

  it('suggests what to check for the usual causes', () => {
    expect(explainSshError('All configured authentication methods failed')).toContain('ssh-add -l')
    expect(explainSshError('connect EHOSTUNREACH 192.0.2.7:22')).toContain('Tailscale')
  })

  it('never repeats the raw message, which may hold an address', () => {
    for (const raw of [
      'connect EHOSTUNREACH 192.0.2.7:22',
      'getaddrinfo ENOTFOUND secret-host.ts.net',
      'connect ECONNREFUSED 192.0.2.7:22'
    ]) {
      const text = explainSshError(raw)
      expect(text).not.toContain('192.0.2.7')
      expect(text).not.toContain('secret-host')
    }
  })

  it('has nothing to say about an unknown or missing error', () => {
    expect(explainSshError(null)).toBeNull()
    expect(explainSshError('')).toBeNull()
    expect(explainSshError('something unexpected happened')).toBeNull()
  })

  it('is not case sensitive', () => {
    expect(explainSshError('HOST DENIED')).not.toBeNull()
    expect(explainSshError('connect econnrefused 1.2.3.4:22')).not.toBeNull()
  })
})
