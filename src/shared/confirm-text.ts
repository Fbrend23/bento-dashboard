import type { ContainerAction } from '@shared/actions'

export interface ConfirmationText {
  title: string
  message: string
  detail: string
  confirmLabel: string
}

/** Wording of the native confirmation box. The label is the friendly name chosen by main. */
export function confirmationText(action: ContainerAction, label: string): ConfirmationText {
  switch (action) {
    case 'stop':
      return {
        title: `Arrêter ${label}`,
        message: `Arrêter ${label} ?`,
        detail: "Le service sera indisponible jusqu'à ce que vous le redémarriez.",
        confirmLabel: 'Arrêter'
      }
    case 'restart':
      return {
        title: `Redémarrer ${label}`,
        message: `Redémarrer ${label} ?`,
        detail: 'Les connexions en cours seront interrompues quelques secondes.',
        confirmLabel: 'Redémarrer'
      }
    case 'start':
      return {
        title: `Démarrer ${label}`,
        message: `Démarrer ${label} ?`,
        detail: 'Le conteneur va être démarré.',
        confirmLabel: 'Démarrer'
      }
  }
}
