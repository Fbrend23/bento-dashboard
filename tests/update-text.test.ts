import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@shared/updates'
import { updateSummary } from '../src/shared/update-text'

const state = (overrides: Partial<UpdateState> = {}): UpdateState => ({
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  percent: null,
  error: null,
  checkedAt: null,
  ...overrides
})

describe('updateSummary', () => {
  it.each([
    [
      { phase: 'unavailable' },
      "Les mises à jour ne fonctionnent que dans l'application installée."
    ],
    [{ phase: 'idle' }, 'Version 1.0.0. Aucune vérification pour le moment.'],
    [{ phase: 'checking' }, 'Vérification en cours…'],
    [{ phase: 'up-to-date' }, 'Version 1.0.0 : vous avez la dernière version.'],
    [
      { phase: 'downloading', version: '1.1.0', percent: 42 },
      'Téléchargement de la version 1.1.0 : 42 %.'
    ],
    [
      { phase: 'downloading', version: '1.1.0', percent: null },
      'Téléchargement de la version 1.1.0…'
    ],
    [
      { phase: 'ready', version: '1.1.0' },
      "La version 1.1.0 est prête. Redémarrez l'application pour l'installer."
    ],
    [
      { phase: 'error', error: 'GitHub est injoignable pour le moment.' },
      'GitHub est injoignable pour le moment.'
    ]
  ] as const)('describes %j', (overrides, expected) => {
    expect(updateSummary(state(overrides))).toBe(expected)
  })

  it('has a fallback for an error without message', () => {
    expect(updateSummary(state({ phase: 'error', error: null }))).toBe(
      'La vérification des mises à jour a échoué.'
    )
  })
})
