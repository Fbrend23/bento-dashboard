import type { BentoApi } from '../shared/ipc'

declare global {
  interface Window {
    bento: BentoApi
  }
}
