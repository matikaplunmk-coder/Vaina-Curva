import { useCallback, useEffect, useState } from 'react'
import { CellSimulation, DT } from '../sim/engine'
import { FrameBuffer, frameStride } from '../sim/frames'
import { DEFAULT_PARAMS, presetParams, RESET_KEYS, sanitizeParams, type SimParams, type SpeedMode } from '../sim/params'
import type { OutputId } from '../sim/sequence'
import { exportParamsJson, loadStoredParams, parseParamsJson, saveStoredParams } from './paramStore'

/** Máximo de tiempo simulado por cuadro (evita saltos enormes si la pestaña estuvo oculta). */
const MAX_FRAME_REAL = 0.1

/** Copia de los datos que consumen los gráficos (se toma a menor frecuencia que la animación). */
function chartSnapshot(sim: CellSimulation) {
  const s = sim.state
  return {
    history: [...s.history],
    curve: [...s.curve],
    lastCurve: s.lastCurve,
    injectWindow: s.curve.length ? s.injectWindow : s.lastInjectWindow,
    tubes: s.slots.flatMap((t) => (t ? [{ id: t.id, temp: t.temp, residence: s.t - t.loadedAt }] : [])),
  }
}

export function useSimulation() {
  // Instancia única y mutable del motor; React sólo se entera de los cambios vía `frame`.
  // La configuración personalizada se recupera de localStorage al cargar la página.
  const [initial] = useState(loadStoredParams)
  const [sim] = useState(() => new CellSimulation(initial))

  // Cuadros para la cámara del Modo Render (sólo se capturan con la cámara activa).
  const [frames] = useState(() => new FrameBuffer())

  const [params, setParamsState] = useState<SimParams>(initial)
  const [running, setRunningState] = useState(false)
  const setRunning = useCallback(
    (v: boolean) => {
      if (v) frames.markRun()
      setRunningState(v)
    },
    [frames],
  )
  const [speed, setSpeed] = useState<SpeedMode>(5)
  const [frame, setFrame] = useState(0)
  // Los gráficos se refrescan más lento que la animación de la celda.
  const [charts, setCharts] = useState(() => chartSnapshot(sim))

  useEffect(() => {
    if (!running || speed === 'step') return
    let raf = 0
    let last = performance.now()
    let lastChart = 0
    // El tiempo simulado se acumula y se consume en ticks exactos de DT: a 0,25× o 0,5× una fracción
    // de tick por cuadro no se pierde (redondear cada cuadro dejaba las velocidades bajas sin avanzar).
    let acc = 0
    let ticks = 0
    const stride = frameStride(speed)
    const loop = (now: number) => {
      const realDt = Math.min(MAX_FRAME_REAL, (now - last) / 1000)
      last = now
      acc += realDt * speed
      while (acc >= DT - 1e-9 && !sim.state.shiftEnded) {
        sim.advance(DT)
        acc -= DT
        ticks++
        if (frames.enabled && ticks % stride === 0) frames.push(sim)
      }
      frames.alpha = Math.min(1, Math.max(0, acc / DT))
      setFrame((f) => f + 1)
      if (now - lastChart > 400) {
        lastChart = now
        setCharts(chartSnapshot(sim))
      }
      if (sim.state.shiftEnded) {
        setRunning(false)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, sim, frames, setRunning])

  // Cada cambio de parámetros se guarda para que no se pierda al recargar.
  useEffect(() => saveStoredParams(params), [params])

  const refresh = useCallback(() => {
    setFrame((f) => f + 1)
    setCharts(chartSnapshot(sim))
  }, [sim])

  /** Tras reiniciar la simulación se descarta lo grabado y se guarda el cuadro inicial. */
  const restartFrames = useCallback(() => {
    if (!frames.enabled) return
    frames.clear()
    frames.push(sim)
  }, [frames, sim])

  const setParam = useCallback(
    <K extends keyof SimParams>(key: K, value: SimParams[K]) => {
      const next = sanitizeParams({ ...sim.params, [key]: value })
      if (RESET_KEYS.includes(key)) {
        sim.reset(next)
        restartFrames()
      } else sim.setParams(next)
      setParamsState(next)
      refresh()
    },
    [sim, refresh, restartFrames],
  )

  /** Reemplaza toda la configuración (preset, importación, valores nominales) y reinicia la corrida. */
  const applyParams = useCallback(
    (next: SimParams) => {
      sim.reset(next)
      restartFrames()
      setParamsState(next)
      setRunning(false)
      refresh()
    },
    [sim, refresh, restartFrames, setRunning],
  )

  const resetParams = useCallback(() => applyParams({ ...DEFAULT_PARAMS }), [applyParams])
  const applyPreset = useCallback((id: string) => applyParams(presetParams(id)), [applyParams])
  const exportParams = useCallback(() => exportParamsJson(sim.params), [sim])
  const importParams = useCallback(
    (text: string) => {
      const r = parseParamsJson(text)
      if (r.ok) applyParams(r.params)
      return r
    },
    [applyParams],
  )

  const setManual = useCallback(
    (on: boolean) => {
      const r = sim.setManual(on)
      refresh()
      return r
    },
    [sim, refresh],
  )

  const forceOutput = useCallback(
    (id: OutputId, value: boolean) => {
      const r = sim.forceOutput(id, value)
      refresh()
      return r
    },
    [sim, refresh],
  )

  const reset = useCallback(() => {
    sim.reset()
    restartFrames()
    setRunning(false)
    refresh()
  }, [sim, refresh, restartFrames, setRunning])

  const step = useCallback(() => {
    sim.stepToNextEvent()
    if (frames.enabled) frames.push(sim)
    refresh()
  }, [sim, refresh, frames])

  const togglePause = useCallback(() => {
    sim.togglePause()
    refresh()
  }, [sim, refresh])

  const ackAlarms = useCallback(() => {
    sim.ackAlarms()
    refresh()
  }, [sim, refresh])

  const changeSpeed = useCallback((s: SpeedMode) => {
    setSpeed(s)
    if (s === 'step') setRunning(false)
  }, [setRunning])

  return {
    sim,
    params,
    setParam,
    resetParams,
    applyPreset,
    exportParams,
    importParams,
    setManual,
    forceOutput,
    running,
    setRunning,
    speed,
    setSpeed: changeSpeed,
    frame,
    frames,
    charts,
    reset,
    step,
    togglePause,
    ackAlarms,
  }
}

export type SimController = ReturnType<typeof useSimulation>
