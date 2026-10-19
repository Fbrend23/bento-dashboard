import { describe, expect, it } from 'vitest'
import { confirmationText } from '../src/shared/confirm-text'

describe('confirmationText', () => {
  it('names the container and the action when stopping', () => {
    expect(confirmationText('stop', 'Series')).toEqual({
      title: 'Arrêter Series',
      message: 'Arrêter Series ?',
      detail: "Le service sera indisponible jusqu'à ce que vous le redémarriez.",
      confirmLabel: 'Arrêter'
    })
  })

  it('names the container and the action when restarting', () => {
    expect(confirmationText('restart', 'Jellyfin')).toEqual({
      title: 'Redémarrer Jellyfin',
      message: 'Redémarrer Jellyfin ?',
      detail: 'Les connexions en cours seront interrompues quelques secondes.',
      confirmLabel: 'Redémarrer'
    })
  })

  it('has a text for start too, although starting is not confirmed', () => {
    expect(confirmationText('start', 'Movies').confirmLabel).toBe('Démarrer')
  })

  it('uses the label as given, whatever characters it holds', () => {
    expect(confirmationText('stop', 'a.b_c-d').message).toBe('Arrêter a.b_c-d ?')
  })
})
