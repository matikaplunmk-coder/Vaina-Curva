import { useCallback, useState } from 'react'

export type ViewMode = 'technical' | 'render'

const KEY = 'simulador-conduit.view.v1'

function readStored(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'render' ? 'render' : 'technical'
  } catch {
    return 'technical'
  }
}

/** Vista técnica esquemática o Modo Grabación Render; la elección se recuerda entre visitas. */
export function useViewMode() {
  const [mode, setModeState] = useState<ViewMode>(readStored)
  const setMode = useCallback((m: ViewMode) => {
    setModeState(m)
    try {
      localStorage.setItem(KEY, m)
    } catch {
      // sin almacenamiento: la elección vale sólo para esta sesión
    }
  }, [])
  return [mode, setMode] as const
}
