// Plain-French explanations of the raw errors ssh2 and Node report, shown next to (never instead
// of) the raw text. The explanation never repeats the raw message, which may hold an address.

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // A command that ran too long, as opposed to a server that never answered.
  [/command timed out/i, 'bento a mis trop de temps à répondre.'],
  [
    /host denied|verification failed|host key/i,
    "L'empreinte du serveur ne correspond pas à celle enregistrée dans les réglages. Vérifiez-la avant de continuer."
  ],
  [
    /authentication (methods )?failed|all configured authentication/i,
    "bento a refusé la clé. Vérifiez qu'elle est chargée dans l'agent SSH (ssh-add -l) et que le compte bento-dash l'accepte."
  ],
  [
    /agent/i,
    "L'agent SSH de Windows est indisponible. Vérifiez que le service « OpenSSH Authentication Agent » est démarré."
  ],
  [
    /enotfound|getaddrinfo/i,
    "Le nom de l'hôte est introuvable. Vérifiez l'adresse dans les réglages et que Tailscale est connecté."
  ],
  [/econnrefused/i, 'Connexion refusée : le service SSH ne répond pas sur ce port.'],
  [
    /ehostunreach|enetunreach|etimedout|timed out|handshake/i,
    'bento ne répond pas. Vérifiez que le serveur est allumé et que Tailscale est connecté.'
  ],
  [/econnreset|connection closed|closed before/i, 'La connexion a été interrompue.']
]

/** French explanation of a raw connection error, or null when it is not a known one. */
export function explainSshError(raw: string | null): string | null {
  if (!raw) return null
  for (const [pattern, text] of RULES) {
    if (pattern.test(raw)) return text
  }
  return null
}
