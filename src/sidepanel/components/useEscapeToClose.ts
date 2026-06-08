import { useEffect } from 'react'

/** Call `onEscape` when the user presses Escape (for dismissable dialogs). */
export function useEscapeToClose(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape])
}
