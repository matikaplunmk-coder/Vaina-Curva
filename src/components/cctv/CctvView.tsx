import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimController } from '../../hooks/useSimulation'
import type { SimState } from '../../sim/engine'
import { replayView } from '../../sim/frames'
import { CellView } from '../CellView'
import { fmt } from '../format'
import type { OverlayInfo } from './clip'
import { CAM_LABEL, formatDuration, formatTimecode } from './timecode'
import { useClip } from './useClip'

const SPEEDS = [0.25, 0.5, 1, 2] as const

/** Ruido fino (grano de sensor) como imagen SVG embebida. */
const GRAIN_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`

interface Cursor {
  t: number
  epoch: number
  runs: number
}

/** Cuadros por segundo con los que el navegador está refrescando la vista (medido cada 0,5 s). */
function useFps(): number {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    let count = 0
    let start = performance.now()
    const loop = (now: number) => {
      count++
      if (now - start >= 500) {
        setFps(Math.round((count * 1000) / (now - start)))
        count = 0
        start = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return fps
}

function Toggle({ on, onChange, children, label }: { on: boolean; onChange: (v: boolean) => void; children: string; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={label}
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${on ? 'border-sky-500 bg-sky-900/50 text-sky-200' : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
    >
      {children}
    </button>
  )
}

/**
 * Modo Grabación Render: la celda con materiales realistas dentro de un marco de cámara CCTV, con
 * barra de reproducción (pausa, velocidad, línea de tiempo cuadro por cuadro) y grabación de clips.
 * La simulación no se toca: la cámara sólo lee cuadros que el hook va guardando.
 */
export function CctvView({ c }: { c: SimController }) {
  const { sim, frames, running, speed, setRunning, setSpeed } = c
  const svgRef = useRef<SVGSVGElement>(null)
  // Instante que se está reviendo (null = en vivo). Guarda el "epoch" y las "corridas" del buffer con que
  // se fijó: si la simulación se reinicia o se pone a correr, el replay deja de valer sin necesitar efectos.
  const [cursor, setCursorState] = useState<Cursor | null>(null)
  const cursorRef = useRef<Cursor | null>(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [scanlines, setScanlines] = useState(true)
  const [postFx, setPostFx] = useState(true)
  const [showClip, setShowClip] = useState(false)
  const [baseMs] = useState(() => Date.now())
  const fps = useFps()

  const setCursor = useCallback(
    (t: number | null) => {
      const v = t === null ? null : { t, epoch: frames.epoch, runs: frames.runs }
      cursorRef.current = v
      setCursorState(v)
    },
    [frames],
  )

  /** Vuelve al directo y sigue reproduciendo. */
  const goLive = useCallback(() => {
    setCursor(null)
    setReplayPlaying(false)
    setRunning(true)
  }, [setCursor, setRunning])

  // ---- qué cuadro se muestra ------------------------------------------------------------
  const first = frames.first
  const last = frames.last
  const epoch = frames.epoch
  const cursorValid = cursor !== null && cursor.epoch === epoch && cursor.runs === frames.runs && frames.covers(cursor.t)
  const activeCursor = cursorValid ? cursor.t : null
  let state: SimState = sim.state
  if (activeCursor !== null) state = frames.stateAt(activeCursor) ?? sim.state
  else if (running && typeof speed === 'number' && speed <= 2) state = frames.liveState() ?? sim.state // suave a baja velocidad
  const view = state === sim.state ? sim : replayView(sim, state)
  const replayOffset = activeCursor !== null && last ? Math.max(0, last.t - activeCursor) : null
  const timecode = formatTimecode(baseMs + state.t * 1000)

  // Reproducción del replay: el cursor avanza a la velocidad elegida hasta alcanzar el directo.
  useEffect(() => {
    if (!replayPlaying) return
    let raf = 0
    let prev = performance.now()
    const rate = typeof speed === 'number' ? speed : 1
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      const cur = cursorRef.current
      const end = frames.last?.t
      if (cur === null || end === undefined || cur.epoch !== frames.epoch || cur.runs !== frames.runs) {
        setReplayPlaying(false) // reinicio o arranque de la simulación: el replay ya no vale
        return
      }
      const next = cur.t + dt * rate
      if (next >= end) {
        goLive()
        return
      }
      setCursor(next)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [replayPlaying, speed, frames, goLive, setCursor])

  // ---- overlay que también se dibuja en los clips ------------------------------------------
  const info: OverlayInfo = { timecode, fps, speed, replayOffset, scanlines, postFx }
  const infoRef = useRef<OverlayInfo>(info)
  useEffect(() => {
    infoRef.current = info
  })
  const getOverlay = useCallback(() => infoRef.current, [])
  const getSvg = useCallback(() => svgRef.current, [])
  const clip = useClip(getSvg, getOverlay)

  // ---- controles ------------------------------------------------------------------------------
  const playing = activeCursor === null ? running : replayPlaying
  const canScrub = frames.length >= 2

  const togglePlay = () => {
    if (activeCursor === null) {
      if (speed === 'step') setSpeed(1)
      setRunning(!running)
    } else if (replayPlaying) setReplayPlaying(false)
    else setReplayPlaying(true)
  }

  const seek = (t: number) => {
    setRunning(false)
    setReplayPlaying(false)
    setCursor(t)
  }

  const stepFrame = (dir: -1 | 1) => {
    if (!canScrub || !last) return
    const base = activeCursor ?? last.t
    let i = frames.indexAt(base)
    if (dir < 0 && i >= 0 && frames.frame(i).t >= base - 1e-6) i -= 1
    else if (dir > 0) i += 1
    i = Math.min(frames.length - 1, Math.max(0, i))
    seek(frames.frame(i).t)
  }

  const sizeLabel = clip.result ? (clip.result.size > 1e6 ? `${fmt(clip.result.size / 1e6, 1)} MB` : `${fmt(clip.result.size / 1e3, 0)} kB`) : ''

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
      {/* Filtro de aberración cromática (canales R y B desplazados ±0,7 px) */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="cctv-ca" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feOffset in="r" dx="-0.7" dy="0" result="r2" />
          <feOffset in="b" dx="0.7" dy="0" result="b2" />
          <feBlend in="r2" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b2" mode="screen" />
        </filter>
      </svg>

      <div className="relative" style={{ aspectRatio: '960 / 600' }} data-testid="cctv-frame">
        <div style={postFx ? { filter: 'url(#cctv-ca)' } : undefined}>
          <CellView sim={view} render svgRef={svgRef} />
        </div>
        {postFx && (
          <>
            <div className="cctv-vignette" aria-hidden="true" />
            <div className="cctv-grain" aria-hidden="true" style={{ backgroundImage: GRAIN_URL }} />
          </>
        )}
        {scanlines && <div className="cctv-scanlines" aria-hidden="true" data-testid="cctv-scanlines" />}

        {/* Marcas de encuadre de lente */}
        <div className="cctv-corner tl" aria-hidden="true" />
        <div className="cctv-corner tr" aria-hidden="true" />
        <div className="cctv-corner bl" aria-hidden="true" />
        <div className="cctv-corner br" aria-hidden="true" />
        <div className="cctv-cross" aria-hidden="true" />

        {/* HUD */}
        <div className="cctv-hud" data-testid="cctv-hud">
          <div className="absolute top-[16px] left-[42px] flex flex-col gap-1 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="cctv-rec-dot" data-testid="cctv-rec-dot" />
              <b className="text-[13px] tracking-wider text-red-400">REC</b>
              <span className="tracking-wide">{CAM_LABEL}</span>
            </div>
            {replayOffset !== null && (
              <span className="text-amber-300" data-testid="cctv-replay">
                ◀◀ REPLAY -{fmt(replayOffset, 1)} s
              </span>
            )}
            {clip.status === 'recording' && (
              <span className="text-red-400" data-testid="cctv-clip-rec">
                ● GRABANDO CLIP {formatDuration(clip.seconds)}
              </span>
            )}
          </div>
          <div className="absolute top-[16px] right-[42px] text-right text-[12px]">
            <div className="tabular-nums tracking-wide" data-testid="cctv-timecode">
              {timecode}
            </div>
            <div className="text-slate-300 tabular-nums" data-testid="cctv-fps">
              FPS {fps} · ×{speed === 'step' ? 'paso' : speed}
            </div>
          </div>
        </div>
      </div>

      {/* Barra de reproducción tipo video */}
      <div className="space-y-2 border-t border-slate-800 bg-slate-950 px-3 py-2" role="group" aria-label="Controles de reproducción de la cámara">
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label="Línea de tiempo"
            className="h-1.5 flex-1 accent-red-500"
            min={first ? first.t : 0}
            max={last ? Math.max(last.t, (first?.t ?? 0) + 0.1) : 1}
            step={0.01}
            value={activeCursor ?? last?.t ?? 0}
            disabled={!canScrub}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="w-28 shrink-0 text-right font-mono text-[11px] text-slate-300 tabular-nums" data-testid="cctv-position">
            {activeCursor === null ? '● EN VIVO' : `-${fmt(last ? last.t - activeCursor : 0, 1)} s`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => stepFrame(-1)} disabled={!canScrub} className="btn px-2" aria-label="Cuadro anterior" title="Cuadro anterior (0,1 s)">
            ◀❘
          </button>
          <button onClick={togglePlay} className="btn btn-primary min-w-20 justify-center" aria-label={playing ? 'Pausar' : 'Reproducir'}>
            {playing ? '❚❚ Pausa' : '▶ Play'}
          </button>
          <button onClick={() => stepFrame(1)} disabled={!canScrub} className="btn px-2" aria-label="Cuadro siguiente" title="Cuadro siguiente (0,1 s)">
            ❘▶
          </button>
          <div className="flex overflow-hidden rounded-lg border border-slate-700" role="group" aria-label="Velocidad de reproducción">
            {SPEEDS.map((v) => (
              <button
                key={v}
                onClick={() => setSpeed(v)}
                aria-pressed={speed === v}
                className={`px-2 py-1.5 text-xs font-semibold ${speed === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                title={v < 1 ? 'Cámara lenta para analizar la matricería' : undefined}
              >
                {v}×
              </button>
            ))}
          </div>
          {activeCursor !== null && (
            <button onClick={goLive} className="btn border-red-600 text-red-200">
              ● En vivo
            </button>
          )}
          <span className="hidden text-[11px] text-slate-500 md:inline" data-testid="cctv-buffer">
            {frames.length} cuadros · {first && last ? fmt(last.t - first.t, 0) : 0} s
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Toggle on={scanlines} onChange={setScanlines} label="Scanlines">
              Scanlines
            </Toggle>
            <Toggle on={postFx} onChange={setPostFx} label="Post-proceso">
              Viñeta · grano · aberración
            </Toggle>
            <button
              onClick={clip.status === 'recording' ? clip.stop : clip.start}
              className={`btn ${clip.status === 'recording' ? 'border-red-500 bg-red-900/50 text-red-100' : ''}`}
              aria-label={clip.status === 'recording' ? 'Detener grabación' : 'Grabar clip'}
              title={clip.video ? 'Graba hasta 12 s de la cámara en un archivo .webm' : 'Este navegador no puede grabar video: se guarda el cuadro actual como PNG'}
            >
              {clip.status === 'recording' ? `⏹ Detener · ${formatDuration(clip.seconds)}` : clip.video ? '⏺ Grabar clip' : '📷 Capturar cuadro'}
            </button>
          </div>
        </div>
        {(clip.result || clip.error) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]" data-testid="cctv-clip-result">
            {clip.error && <span className="text-red-300">{clip.error}</span>}
            {clip.result && (
              <>
                <span className="text-emerald-300">
                  Clip listo · {clip.result.ext === 'webm' ? `${fmt(clip.result.seconds, 1)} s · ` : ''}
                  {sizeLabel}
                </span>
                <a href={clip.result.url} download={clip.result.name} className="btn py-0.5 text-[11px]">
                  ⬇ Descargar .{clip.result.ext}
                </a>
                {clip.result.ext === 'webm' && (
                  <button onClick={() => setShowClip(!showClip)} className="btn py-0.5 text-[11px]">
                    {showClip ? 'Ocultar' : 'Ver'}
                  </button>
                )}
                <button onClick={clip.discard} className="btn py-0.5 text-[11px]" aria-label="Descartar clip">
                  ✕
                </button>
                <span className="text-slate-500">Si el visor bloquea la descarga, usá «Ver» y clic derecho → Guardar video como…</span>
              </>
            )}
          </div>
        )}
        {clip.result && clip.result.ext === 'webm' && showClip && (
          <video src={clip.result.url} controls loop autoPlay muted playsInline className="w-full max-w-xl rounded-lg border border-slate-800" />
        )}
      </div>
    </div>
  )
}
