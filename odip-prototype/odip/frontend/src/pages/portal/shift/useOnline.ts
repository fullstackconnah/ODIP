import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void): () => void {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

/** Whether the browser thinks it has a connection. The shift screen is online-only: while this is false its actions are disabled and a banner says why. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
