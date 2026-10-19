import type { UpdateState } from './updates'

/** One French sentence describing where the update process stands. */
export function updateSummary(state: UpdateState): string {
  switch (state.phase) {
    case 'unavailable':
      return "Les mises à jour ne fonctionnent que dans l'application installée."
    case 'idle':
      return `Version ${state.currentVersion}. Aucune vérification pour le moment.`
    case 'checking':
      return 'Vérification en cours…'
    case 'up-to-date':
      return `Version ${state.currentVersion} : vous avez la dernière version.`
    case 'downloading':
      return state.percent === null
        ? `Téléchargement de la version ${state.version}…`
        : `Téléchargement de la version ${state.version} : ${state.percent} %.`
    case 'ready':
      return `La version ${state.version} est prête. Redémarrez l'application pour l'installer.`
    case 'error':
      return state.error ?? 'La vérification des mises à jour a échoué.'
  }
}
