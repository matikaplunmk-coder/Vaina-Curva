import { useCallback, useEffect, useRef, useState } from 'react'
import { captureFrame, ClipRecorder, clipSupport, type ClipResult, type OverlayInfo } from './clip'

export type ClipStatus = 'idle' | 'recording' | 'ready' | 'error'

/** Estado de la grabación de clips de la cámara (video .webm o, sin MediaRecorder, un cuadro PNG). */
export function useClip(getSvg: () => SVGSVGElement | null, getOverlay: () => OverlayInfo) {
  const [status, setStatus] = useState<ClipStatus>('idle')
  const [seconds, setSeconds] = useState(0)
  const [result, setResult] = useState<ClipResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<ClipRecorder | null>(null)
  const support = clipSupport()

  const discard = useCallback(() => {
    setResult((r) => {
      if (r) URL.revokeObjectURL(r.url)
      return null
    })
    setStatus('idle')
    setError(null)
  }, [])

  // Contador de segundos mientras se graba.
  useEffect(() => {
    if (status !== 'recording') return
    const id = window.setInterval(() => setSeconds(recorder.current?.seconds ?? 0), 200)
    return () => window.clearInterval(id)
  }, [status])

  // Al desmontar, se corta la grabación en curso.
  useEffect(
    () => () => {
      void recorder.current?.stop()
    },
    [],
  )

  const start = useCallback(async () => {
    discard()
    setError(null)
    try {
      if (!support.video) {
        // Sin MediaRecorder: se guarda el cuadro actual como imagen.
        setResult(await captureFrame({ getSvg, getOverlay }))
        setStatus('ready')
        return
      }
      const rec = new ClipRecorder({ getSvg, getOverlay })
      recorder.current = rec
      await rec.start()
      setSeconds(0)
      setStatus('recording')
      rec.result
        .then((r) => {
          setResult(r)
          setStatus('ready')
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : 'Falló la grabación.')
          setStatus('error')
        })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo grabar.')
      setStatus('error')
    }
  }, [discard, getOverlay, getSvg, support.video])

  const stop = useCallback(() => {
    void recorder.current?.stop()
  }, [])

  return { status, seconds, result, error, video: support.video, start, stop, discard }
}
