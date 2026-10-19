// Result of "Tester la connexion", shared by main, preload and renderer.

export type ConnectionTestResult =
  | { ok: true }
  | {
      ok: false
      /** What to tell the user, in plain French. */
      message: string
      /** Raw error text for the curious; null when there is none. */
      technical: string | null
    }
