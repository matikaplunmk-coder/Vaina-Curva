import type { CellSimulation, SimState } from '../sim/engine'
import { classifyDemold, PIPE, tempColor, waterColor } from '../sim/physics'

/** Color del rótulo de temperatura según el criterio de apertura (≤ 70 OK · 70–80 aviso · > 80 scrap). */
const DEMOLD_TEXT = { ok: '#86efac', warn: '#fcd34d', scrap: '#fca5a5' }
import { readInputs, STEPS, stepDurations } from '../sim/sequence'
import { fmt } from './format'
import { Pipe3D } from './render/materials'
import { shade } from './render/color'

/**
 * Estación de conformado en "L" vertical, a escala 0,33 px/mm:
 * brazo horizontal inferior (mordaza Ø40 + campana y cono abocardador) → curva 90° R200 hacia
 * arriba → brazo vertical abierto con vaso colector de rebalse Ø90 y manguera de drenaje.
 */
const S = 0.33
const X0 = 650 // extremo del caño (asiento del cono)
const Y0 = 330 // eje del brazo horizontal
const HL = 300 * S // tramo recto horizontal
const R = 200 * S // radio de curvado
const XC = X0 + HL // inicio de la curva
const CY = Y0 - R // centro de la curva
const LEN = PIPE.length * S
const TUBE_W = 14

/** Eje del caño con curvado parcial: 0 = recto, 1 = L a 90°. */
function tubePath(bend: number): string {
  const th = (Math.PI / 2) * Math.min(1, Math.max(0, bend))
  const px = XC + R * Math.sin(th)
  const py = CY + R * Math.cos(th)
  const tail = LEN - HL - R * th
  const ex = px + tail * Math.cos(th)
  const ey = py - tail * Math.sin(th)
  return th > 1e-4 ? `M ${X0} ${Y0} H ${XC} A ${R} ${R} 0 0 0 ${px} ${py} L ${ex} ${ey}` : `M ${X0} ${Y0} H ${X0 + LEN}`
}

const TOP_Y = CY - (LEN - HL - (R * Math.PI) / 2) // extremo superior del brazo vertical
const VX = XC + R // abscisa del brazo vertical
const CUP = { x: VX - 17, w: 34, top: TOP_Y - 22, bottom: TOP_Y + 14 }
const DRAIN = `M ${CUP.x + CUP.w} ${CUP.bottom - 4} H 942 V 410 H 545 V 440`

// ---- Matriz bipartida: dos zapatas con canaleta semicilíndrica R20 (media caña del Ø40) ----
const TUBE_R = TUBE_W / 2
const T = 24 // espesor visible de cada zapata (~73 mm)
const XL = X0 // cara de entrada de la matriz
const YS = CUP.bottom + 3 // las zapatas terminan debajo del vaso de rebalse
const BELL_L = 17 // largo de la campana (~50 mm)
const BELL_R = 9.5 // radio del mecanizado de la campana (enchufe Ø ~58 mm)
const OPEN = 30 // apertura de la zapata móvil (~90 mm), a 45° hacia arriba y afuera de la curva
const OPEN_D = OPEN / Math.SQRT2

/** Línea de partición = eje de la cavidad en L (tramo recto, curva R200, salida vertical). */
const CAVITY = `M ${XL - 2} ${Y0} H ${XC} A ${R} ${R} 0 0 0 ${VX} ${CY} V ${YS - 2}`
/** Zapata fija: exterior de la curva (debajo del tramo horizontal y a la derecha del vertical). */
const FIXED = `M ${XL} ${Y0} H ${XC} A ${R} ${R} 0 0 0 ${VX} ${CY} V ${YS} H ${VX + T} V ${CY} A ${R + T} ${R + T} 0 0 1 ${XC} ${Y0 + T} H ${XL} Z`
/** Zapata móvil: interior de la curva (arriba del tramo horizontal y a la izquierda del vertical). */
const MOBILE = `M ${XL} ${Y0} H ${XC} A ${R} ${R} 0 0 0 ${VX} ${CY} V ${YS} H ${VX - T} V ${CY} A ${R - T} ${R - T} 0 0 1 ${XC} ${Y0 - T} H ${XL} Z`

// ---- Cilindro de la zapata móvil (a 45°, empuja hacia el centro de la curva) ----
const DIE_ANCHOR: [number, number] = [XC + (R - T) * Math.SQRT1_2, CY + (R - T) * Math.SQRT1_2]
const DIE_CYL_BASE: [number, number] = [XC - 44, CY - 44]
const DIE_CYL_LEN = 26

// ---- Conjunto de abocardado (de la punta hacia atrás) ----
const NOZZLE_L = 3
const GUIDE_L = 12
const GUIDE_R = 5.5 // guía de centrado ≈ Ø interior del caño
const CONE_R = BELL_R - 1
const CONE_L = (CONE_R - GUIDE_R) / Math.tan((10 * Math.PI) / 180) // cono a 10°
const HEAD_L = 14
const HEAD_R = 12
const TIP_BACK = XL - 46 // punta con el mandril atrás (B4)
const TIP_SEATED = XL + BELL_L + 9 // punta con el cono asentado en la campana (B3)
const CYL = { x0: 490, x1: 540, r: 9 }

function Groove({ clip }: { clip: string }) {
  // media caña Ø40 a lo largo de la L + mecanizado ensanchado de la campana en la entrada
  return (
    <g clipPath={`url(#${clip})`}>
      <path d={CAVITY} fill="none" stroke="#0b1220" strokeWidth={TUBE_W + 1} />
      <path
        d={`M ${XL - 1} ${Y0 - BELL_R} H ${XL + BELL_L - 4} L ${XL + BELL_L} ${Y0 - TUBE_R - 0.5} V ${Y0 + TUBE_R + 0.5} L ${XL + BELL_L - 4} ${Y0 + BELL_R} H ${XL - 1} Z`}
        fill="#0b1220"
      />
      <path d={CAVITY} fill="none" stroke="#1e293b" strokeWidth={1} strokeDasharray="3 3" />
    </g>
  )
}

/** Pseudoaleatorio determinista (0..1): las partículas dependen del tiempo simulado, no del reloj real. */
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Tornillo de cabeza cilíndrica con ranura. */
function Bolt({ x, y, r = 2.4 }: { x: number; y: number; r?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="url(#rm-bolt)" stroke="#0b1220" strokeWidth="0.5" />
      <line x1={-r * 0.6} y1={r * 0.25} x2={r * 0.6} y2={-r * 0.25} stroke="#0b1220" strokeWidth="0.7" />
    </g>
  )
}

/** Bisel de una zapata: borde claro hacia la luz (arriba a la izquierda) y oscuro del lado opuesto. */
function Bevel({ d, clip }: { d: string; clip: string }) {
  return (
    <g clipPath={`url(#${clip})`}>
      <path d={d} fill="none" stroke="#020617" strokeOpacity="0.6" strokeWidth="3.6" transform="translate(-1.1 -1.1)" />
      <path d={d} fill="none" stroke="#f1f5f9" strokeOpacity="0.75" strokeWidth="3" transform="translate(1 1)" />
      <path d={CAVITY} fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth={TUBE_W + 13} />
    </g>
  )
}

function GripInsert({ y, locked, flip, render }: { y: number; locked: boolean; flip: boolean; render?: boolean }) {
  // inserto de agarre dentado, justo detrás de la campana
  const x0 = XL + BELL_L + 3
  const w = 14
  const teeth = Array.from({ length: 5 }, (_, i) => {
    const tx = x0 + 1.4 + i * 2.8
    const ty = flip ? y + 4 : y
    return `M ${tx - 1.2} ${ty} L ${tx} ${ty + (flip ? 1.8 : -1.8)} L ${tx + 1.2} ${ty}`
  }).join(' ')
  return (
    <g>
      <rect x={x0} y={y} width={w} height={4} fill={render ? `url(#${locked ? 'rm-brass' : 'rm-brass-off'})` : locked ? '#f59e0b' : '#a16207'} stroke={render ? '#1c1004' : undefined} strokeWidth={0.5} />
      <path d={teeth} fill={locked ? '#fbbf24' : '#ca8a04'} />
    </g>
  )
}

/** Vaso de rebalse Ø90 de vidrio: agua con gradiente de profundidad, oleaje, burbujas, surtidor y vapor. */
function RenderCup({ press, tt, tank, amp }: { press: SimState['press']; tt: number; tank: number; amp: number }) {
  const inner = CUP.bottom - CUP.top - 6
  const level = press.cup
  const yTop = CUP.bottom - 2 - inner * level
  const x0 = CUP.x + 2
  const x1 = CUP.x + CUP.w - 2
  const wave = (x: number) => yTop + Math.sin(x * 0.55 + tt * 5.5) * (press.overflow ? 1.5 : 0.7)
  const pts: string[] = []
  for (let x = x0; x <= x1 + 0.01; x += 2) pts.push(`${x.toFixed(1)} ${wave(x).toFixed(2)}`)
  const surface = `M ${pts.join(' L ')}`
  const body = `${surface} L ${x1} ${CUP.bottom - 2} L ${x0} ${CUP.bottom - 2} Z`
  return (
    <g>
      {/* fondo interior del vaso */}
      <rect x={CUP.x} y={CUP.top} width={CUP.w} height={CUP.bottom - CUP.top} fill="#06101c" fillOpacity="0.75" />
      {level > 0.01 && (
        <>
          <path d={body} fill="url(#rm-water-cup)" />
          <path d={surface} fill="none" stroke="#e0f7ff" strokeOpacity="0.85" strokeWidth="1" />
          <rect x={x0} y={yTop + 1} width={x1 - x0} height={Math.max(0, CUP.bottom - 2 - yTop - 1)} fill={waterColor(tank)} fillOpacity="0.18" />
          {level > 0.15 &&
            Array.from({ length: 6 }, (_, i) => {
              const ph = (tt * (0.5 + 0.4 * rnd(i + 40)) + rnd(i + 44)) % 1
              return (
                <circle
                  key={i}
                  cx={x0 + 3 + rnd(i + 50) * (x1 - x0 - 6)}
                  cy={CUP.bottom - 3 - (CUP.bottom - 3 - yTop) * ph}
                  r={0.6 + rnd(i + 60) * 1.1}
                  fill="#f0f9ff"
                  fillOpacity={0.8 * (1 - ph * 0.6)}
                />
              )
            })}
        </>
      )}
      {/* vidrio: paredes con brillo, base metálica y borde superior */}
      <path d={`M ${CUP.x} ${CUP.top} V ${CUP.bottom} H ${CUP.x + CUP.w} V ${CUP.top}`} fill="none" stroke="#cbd5e1" strokeOpacity="0.85" strokeWidth="2" />
      <rect x={CUP.x} y={CUP.top} width={CUP.w} height={CUP.bottom - CUP.top} fill="url(#rm-glass)" />
      <rect x={CUP.x - 2} y={CUP.bottom - 1} width={CUP.w + 4} height={4} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
      <line x1={CUP.x + 4} y1={CUP.top + 3} x2={CUP.x + 4} y2={CUP.bottom - 5} stroke="#fff" strokeOpacity="0.45" strokeWidth="1.2" />
      {/* surtidor: el agua sale libre por el extremo abierto del caño y cae al vaso */}
      {press.overflow &&
        Array.from({ length: 7 }, (_, i) => {
          const ph = (tt * 1.7 + rnd(i)) % 1
          const spread = (rnd(i + 20) - 0.5) * 2
          return (
            <circle
              key={i}
              cx={VX + spread * ph * 9}
              cy={TOP_Y - 15 * Math.sin(Math.PI * ph) * (0.6 + 0.4 * rnd(i + 30))}
              r={1.1}
              fill="#e0f7ff"
              fillOpacity={0.9 * (1 - ph * 0.5)}
            />
          )
        })}
      {/* vapor sutil cuando el agua toca el caño caliente */}
      {amp > 0.02 && (
        <g filter="url(#rm-steam)">
          {Array.from({ length: 7 }, (_, i) => {
            const ph = (tt * 0.28 + i / 7) % 1
            return (
              <circle
                key={i}
                cx={VX + (rnd(i) - 0.5) * 22 + Math.sin(tt * 1.3 + i) * 3 * ph}
                cy={CUP.top - 4 - ph * 34}
                r={5 + ph * 9}
                fill="#f1f5f9"
                fillOpacity={amp * 0.42 * Math.sin(Math.PI * ph)}
              />
            )
          })}
        </g>
      )}
    </g>
  )
}

/** Campana conformada en la boca del caño (f = 0 sin conformar → 1 contra la matriz). */
const bellPath = (f: number) =>
  `M ${X0} ${Y0 - TUBE_R - 2.5 * f} H ${X0 + BELL_L - 4} L ${X0 + BELL_L} ${Y0 - TUBE_R} V ${Y0 + TUBE_R} L ${X0 + BELL_L - 4} ${Y0 + TUBE_R + 2.5 * f} H ${X0} Z`

export function LStation({ sim, render = false }: { sim: CellSimulation; render?: boolean }) {
  const s = sim.state
  const tt = s.t
  const p = sim.params
  const press = s.press
  const b = readInputs(press.act)
  const d = stepDurations(p)
  const tube = press.tube
  const step = STEPS[press.step - 1]
  const pumping = press.out.Y4
  const flowing = pumping && b.B3
  const air = press.out.Y5
  const running = !press.manual && press.step <= 9
  const stepDur = press.step === 5 && p.coolingMode === 'sensor' ? null : d[press.step]

  // Zapata móvil: desplazamiento a 45° (0 = cerrada contra la fija).
  const open = 1 - press.act.die
  const dx = -OPEN_D * open
  const dy = -OPEN_D * open
  const anchor: [number, number] = [DIE_ANCHOR[0] + dx, DIE_ANCHOR[1] + dy]
  const cylEnd: [number, number] = [DIE_CYL_BASE[0] + DIE_CYL_LEN * Math.SQRT1_2, DIE_CYL_BASE[1] + DIE_CYL_LEN * Math.SQRT1_2]
  // Mordaza: los insertos aprietan radialmente (~1 mm de carrera visible).
  const grip = (1 - press.act.clamp) * 3
  // Mandril: punta del cono entre atrás (B4) y asentado en la campana (B3).
  const tip = TIP_BACK + (TIP_SEATED - TIP_BACK) * press.act.mandrel
  const guide0 = tip - NOZZLE_L - GUIDE_L
  const cone0 = guide0 - CONE_L
  const head0 = cone0 - HEAD_L
  const coneColor = b.B3 ? '#38bdf8' : '#cbd5e1'
  const conePath = `M ${cone0} ${Y0 - CONE_R} L ${guide0} ${Y0 - GUIDE_R} V ${Y0 + GUIDE_R} L ${cone0} ${Y0 + CONE_R} Z`
  const hose = `M 650 522 V 400 C 600 400 ${head0 + HEAD_L / 2} 392 ${head0 + HEAD_L / 2} ${Y0 + HEAD_R}`
  const f = press.flare
  // Vapor: aparece cuando el agua toca el caño caliente (más intenso cuanto más caliente y con caudal).
  const steamAmp = tube ? clamp01((tube.temp - 50) / 70) * (press.fill > 0.05 ? 1 : 0) * (flowing ? 1 : 0.5) : 0

  return (
    <g>
      <defs>
        <clipPath id="clip-fixed">
          <path d={FIXED} />
        </clipPath>
        <clipPath id="clip-mobile">
          <path d={MOBILE} />
        </clipPath>
        <linearGradient id="steel-fixed" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
        <linearGradient id="steel-mobile" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        {/* Presión hidrostática: el agua es más clara en la superficie (arriba) y más profunda abajo */}
        <linearGradient id="rm-water-depth" gradientUnits="userSpaceOnUse" x1="0" y1={TOP_Y} x2="0" y2={Y0 + 8}>
          <stop offset="0%" stopColor="#bae6fd" />
          <stop offset="40%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#075985" />
        </linearGradient>
      </defs>

      {/* Título y paso activo */}
      <text x={775} y={104} textAnchor="middle" className="fill-slate-200 text-[12px] font-semibold">
        Estación de conformado en L · R200 · Ø40
      </text>
      <text x={775} y={120} textAnchor="middle" className={`text-[11px] font-semibold ${press.manual ? 'fill-fuchsia-300' : running ? 'fill-sky-300' : 'fill-emerald-300'}`}>
        {press.homing
          ? 'RETORNO A REPOSO…'
          : press.manual
            ? 'MODO MANUAL · salidas forzadas con enclavamientos'
            : `Paso ${press.step}/10 · ${step.short}${stepDur !== null && running ? ` · ${fmt(Math.max(0, stepDur - press.elapsed), 1)} s` : ''}`}
      </text>
      <rect x={650} y={127} width={250} height={4} rx={2} fill="#1e293b" />
      {running && stepDur !== null && (
        <rect x={650} y={127} width={250 * Math.min(1, press.elapsed / stepDur)} height={4} rx={2} fill="#38bdf8" />
      )}

      {/* Circuito de agua: bomba → manguera flexible → cabezal del mandril; vaso colector → tanque */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={hose} stroke={render ? '#0a1a30' : '#1e3a5f'} strokeWidth={render ? 8 : 7} />
        <path d={DRAIN} stroke={render ? '#0a1a30' : '#1e3a5f'} strokeWidth={render ? 8 : 7} />
        {render && (
          <>
            <path d={hose} stroke="#3b6ea5" strokeOpacity="0.45" strokeWidth="2" transform="translate(-1.6 -1.6)" />
            <path d={DRAIN} stroke="#3b6ea5" strokeOpacity="0.45" strokeWidth="2" transform="translate(-1.6 -1.6)" />
          </>
        )}
        {pumping && (
          <path
            d={hose}
            stroke="#38bdf8"
            strokeWidth="3"
            className={render ? undefined : 'flow'}
            strokeDasharray={render ? '8 8' : undefined}
            strokeDashoffset={render ? -((tt * 32) % 16) : undefined}
          />
        )}
        {press.cup > 0.05 && (
          <path
            d={DRAIN}
            stroke={waterColor(s.tank.waterOut)}
            strokeWidth="3"
            className={render ? undefined : 'flow'}
            strokeDasharray={render ? '8 8' : undefined}
            strokeDashoffset={render ? -((tt * 32) % 16) : undefined}
          />
        )}
      </g>
      <text x={948} y={300} className="fill-slate-500 text-[9px]" transform="rotate(90 948 300)">
        drenaje por gravedad
      </text>

      {/* Matriz fija: zapata exterior con su media caña, la campana y el inserto inferior de la mordaza */}
      {render ? (
        <>
          <g filter="url(#rm-shadow)">
            <path d={FIXED} fill="url(#rm-steel)" />
          </g>
          <Bevel d={FIXED} clip="clip-fixed" />
          <path d={FIXED} fill="none" stroke="#0b1220" strokeWidth="1.1" />
        </>
      ) : (
        <path d={FIXED} fill="url(#steel-fixed)" stroke="#94a3b8" strokeWidth="1" />
      )}
      <Groove clip="clip-fixed" />
      <GripInsert y={Y0 + TUBE_R + grip} locked={b.B2} flip={false} render={render} />
      <rect x={XL + BELL_L + 6} y={Y0 + T} width={8} height={9} fill={render ? 'url(#rm-cyl-body)' : '#1e293b'} stroke={render ? '#0b1220' : '#475569'} />
      {[0.25, 0.6].map((k) =>
        render ? <Bolt key={k} x={XL + 30 + (XC - XL - 30) * k} y={Y0 + T - 6} /> : <circle key={k} cx={XL + 30 + (XC - XL - 30) * k} cy={Y0 + T - 6} r={2} fill="#1e293b" />,
      )}
      {render && <Bolt x={VX + T - 6} y={CY + 30} r={2.6} />}

      {/* Matriz móvil: zapata interior, se desplaza ~90 mm a 45° (B6 abierta) y cierra sobre la fija (B1) */}
      {render ? (
        <g transform={`translate(${DIE_CYL_BASE[0]} ${DIE_CYL_BASE[1]}) rotate(45)`} filter="url(#rm-shadow-soft)">
          <rect x={-6} y={-9.5} width={5} height={19} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
          <rect x={-2} y={-8.5} width={DIE_CYL_LEN + 4} height={17} rx={2.5} fill="url(#rm-cyl-body)" stroke="#0b1220" strokeWidth="0.8" />
          <rect x={DIE_CYL_LEN + 2} y={-9.5} width={5} height={19} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
          <rect x={DIE_CYL_LEN + 7} y={-2.4} width={Math.hypot(anchor[0] - cylEnd[0], anchor[1] - cylEnd[1]) + 2} height={4.8} fill="url(#rm-chrome)" />
        </g>
      ) : (
        <>
          <line x1={DIE_CYL_BASE[0]} y1={DIE_CYL_BASE[1]} x2={cylEnd[0]} y2={cylEnd[1]} stroke="#1e293b" strokeWidth={16} />
          <line x1={DIE_CYL_BASE[0]} y1={DIE_CYL_BASE[1]} x2={cylEnd[0]} y2={cylEnd[1]} stroke="#475569" strokeWidth={16} strokeOpacity="0.4" strokeDasharray="1 3" />
          <line x1={cylEnd[0]} y1={cylEnd[1]} x2={anchor[0]} y2={anchor[1]} stroke="#cbd5e1" strokeWidth={4} />
        </>
      )}
      {render ? <Bolt x={DIE_CYL_BASE[0]} y={DIE_CYL_BASE[1]} r={4.5} /> : <circle cx={DIE_CYL_BASE[0]} cy={DIE_CYL_BASE[1]} r={5} fill="#334155" stroke="#94a3b8" />}
      <g transform={`translate(${dx} ${dy})`}>
        {render ? (
          <>
            <g filter="url(#rm-shadow)">
              <path d={MOBILE} fill="url(#rm-alu)" />
            </g>
            <Bevel d={MOBILE} clip="clip-mobile" />
            <path d={MOBILE} fill="none" stroke={b.B1 ? '#22c55e' : '#0b1220'} strokeOpacity={b.B1 ? 0.85 : 1} strokeWidth="1.1" />
          </>
        ) : (
          <path d={MOBILE} fill="url(#steel-mobile)" stroke={b.B1 ? '#22c55e' : '#cbd5e1'} strokeWidth="1" />
        )}
        <Groove clip="clip-mobile" />
        <GripInsert y={Y0 - TUBE_R - 4 - grip} locked={b.B2} flip={true} render={render} />
        <rect x={XL + BELL_L + 6} y={Y0 - T - 9} width={8} height={9} fill={render ? 'url(#rm-cyl-body)' : '#1e293b'} stroke={render ? '#0b1220' : '#475569'} />
        {render ? <Bolt x={anchor[0] - dx} y={anchor[1] - dy} r={3.2} /> : <circle cx={anchor[0] - dx} cy={anchor[1] - dy} r={3} fill="#cbd5e1" />}
        {render && <Bolt x={XC - 20} y={Y0 - T + 6} />}
      </g>
      {/* Caño (color según temperatura), campana conformada y agua de templado */}
      {tube && (
        <g>
          {render ? (
            <>
              <Pipe3D d={tubePath(press.bend)} color={tempColor(tube.temp)} width={TUBE_W} region={{ x: 630, y: 140, w: 340, h: 230 }} />
              {f > 0.01 && (
                <>
                  <path d={bellPath(f)} fill={tempColor(tube.temp)} stroke={shade(tempColor(tube.temp), -0.6)} strokeWidth="0.8" />
                  <path d={bellPath(f)} fill="url(#rm-cyl-shade)" />
                </>
              )}
            </>
          ) : (
            <>
              <path d={tubePath(press.bend)} fill="none" stroke={tempColor(tube.temp)} strokeWidth={TUBE_W} strokeLinecap="butt">
                <title>
                  Caño #{tube.id} · {tube.temp.toFixed(1)} °C
                </title>
              </path>
              {f > 0.01 && <path d={bellPath(f)} fill={tempColor(tube.temp)} />}
            </>
          )}
          {render && (
            <path d={tubePath(press.bend)} fill="none" stroke="transparent" strokeWidth={TUBE_W}>
              <title>
                Caño #{tube.id} · {tube.temp.toFixed(1)} °C
              </title>
            </path>
          )}
          {press.fill > 0.001 && !render && (
            <path d={tubePath(press.bend)} fill="none" stroke="#38bdf8" strokeOpacity="0.85" strokeWidth={6} pathLength={1} strokeDasharray={`${press.fill} 1`} />
          )}
          {press.fill > 0.001 && render && (
            <>
              <path d={tubePath(press.bend)} fill="none" stroke="url(#rm-water-depth)" strokeOpacity="0.86" strokeWidth={8} pathLength={1} strokeDasharray={`${press.fill} 1`} />
              <path d={tubePath(press.bend)} fill="none" stroke="#e0f7ff" strokeOpacity="0.55" strokeWidth={1.6} pathLength={1} strokeDasharray={`${press.fill} 1`} transform="translate(-1.6 -1.6)" />
            </>
          )}
          {flowing && press.fill > 0.02 && !render && (
            <path d={tubePath(press.bend)} fill="none" stroke="#e0f2fe" strokeOpacity="0.6" strokeWidth={2} pathLength={1} strokeDasharray="0.02 0.03" className="flow-l" />
          )}
          {flowing && press.fill >= 0.98 && render && (
            <path d={tubePath(press.bend)} fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth={1.4} pathLength={1} strokeDasharray="0.012 0.045" strokeDashoffset={-((tt * 0.9) % 0.057)} />
          )}
          {air && (
            <path
              d={tubePath(press.bend)}
              fill="none"
              stroke="#f8fafc"
              strokeWidth={2.5}
              strokeDasharray="4 6"
              className={render ? undefined : 'flow'}
              strokeDashoffset={render ? -((tt * 60) % 10) : undefined}
            />
          )}
          {/* Burbujas que suben por la rama vertical mientras el agua circula */}
          {render &&
            flowing &&
            press.fill >= 0.9 &&
            Array.from({ length: 8 }, (_, i) => {
              const ph = (tt * (0.35 + 0.3 * rnd(i)) + rnd(i + 9)) % 1
              return (
                <circle
                  key={i}
                  cx={VX + (rnd(i + 3) - 0.5) * 5}
                  cy={CY - (CY - TOP_Y) * ph}
                  r={0.7 + rnd(i + 5) * 1.1}
                  fill="#f0f9ff"
                  fillOpacity={0.8 * Math.sin(Math.PI * ph)}
                />
              )
            })}
          <text x={VX + T + 6} y={CY + 14} className="text-[11px] font-semibold" fill={DEMOLD_TEXT[classifyDemold(tube.temp)]}>
            {tube.temp.toFixed(1)} °C
          </text>
        </g>
      )}

      <text x={DIE_CYL_BASE[0] - 8} y={DIE_CYL_BASE[1] - 10} textAnchor="middle" className="fill-slate-400 text-[9px]">
        cilindro matriz
      </text>
      <text x={XC - 10} y={CY + R - T - 8 + dy} textAnchor="middle" className="fill-slate-300 text-[9px]" transform={`translate(${dx} 0)`}>
        matriz móvil
      </text>
      <text x={XC + 8} y={Y0 + T + 12} className="fill-slate-400 text-[9px]">
        matriz fija · R200
      </text>
      <text x={XL + 2} y={Y0 + T + 12} className="fill-slate-400 text-[9px]">
        campana
      </text>
      <text x={XL + BELL_L + 10} y={Y0 + T + 22} textAnchor="middle" className={`text-[9px] ${b.B2 ? 'fill-amber-300' : 'fill-slate-400'}`}>
        mordaza
      </text>

      {/* Vaso colector de rebalse Ø90 */}
      {render ? (
        <RenderCup press={press} tt={tt} tank={s.tank.waterOut} amp={steamAmp} />
      ) : (
        <>
          <path d={`M ${CUP.x} ${CUP.top} V ${CUP.bottom} H ${CUP.x + CUP.w} V ${CUP.top}`} fill="#0b1220" stroke="#94a3b8" strokeWidth="2" />
          {press.cup > 0.01 && (
            <rect
              x={CUP.x + 2}
              y={CUP.bottom - 2 - (CUP.bottom - CUP.top - 6) * press.cup}
              width={CUP.w - 4}
              height={(CUP.bottom - CUP.top - 6) * press.cup}
              fill={waterColor(s.tank.waterOut)}
              opacity={0.8}
            />
          )}
          {press.overflow && <path d={`M ${VX} ${TOP_Y} q -6 -10 -12 -2 M ${VX} ${TOP_Y} q 6 -10 12 -2`} stroke="#7dd3fc" strokeWidth="2" fill="none" className="flow" />}
        </>
      )}
      <text x={CUP.x + CUP.w + 4} y={CUP.top + 8} className="fill-slate-400 text-[9px]">
        vaso rebalse Ø90
      </text>

      {/* Abocardado: cilindro neumático → vástago → cabezal portaconos → cono 10° → guía de centrado → tobera */}
      {render ? (
        <g filter="url(#rm-shadow-soft)">
          <rect x={CYL.x0} y={Y0 - CYL.r} width={CYL.x1 - CYL.x0} height={CYL.r * 2} rx={3} fill="url(#rm-cyl-body)" stroke="#0b1220" strokeWidth="0.8" />
          <rect x={CYL.x0 - 4} y={Y0 - CYL.r - 3} width={5} height={CYL.r * 2 + 6} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
          <rect x={CYL.x1 - 1} y={Y0 - CYL.r - 3} width={5} height={CYL.r * 2 + 6} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
          {/* vástago cromado con reflejo cilíndrico */}
          <rect x={CYL.x1 + 4} y={Y0 - 2.5} width={Math.max(0, head0 - CYL.x1 - 4)} height={5} fill="url(#rm-chrome)" />
          <rect x={CYL.x1 + 4} y={Y0 - 1.9} width={Math.max(0, head0 - CYL.x1 - 4)} height={0.8} fill="#fff" fillOpacity="0.85" />
          {/* cabezal portaconos */}
          <rect x={head0} y={Y0 - HEAD_R} width={HEAD_L} height={HEAD_R * 2} rx={2} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.7" />
          <rect x={head0 + 3} y={Y0 - 3} width={HEAD_L - 6} height={6} fill="#0c2a4a" stroke="#0b1220" strokeWidth="0.5" />
          <Bolt x={head0 + 3.5} y={Y0 - HEAD_R + 3} r={1.6} />
          <Bolt x={head0 + 3.5} y={Y0 + HEAD_R - 3} r={1.6} />
          {/* cono expansor 10° cromado espejo */}
          <path d={conePath} fill="url(#rm-chrome)" stroke="#0b1220" strokeWidth="0.6" />
          <line x1={cone0} y1={Y0 - CONE_R + 1} x2={guide0} y2={Y0 - GUIDE_R + 0.9} stroke="#fff" strokeOpacity="0.9" strokeWidth="0.9" />
          {b.B3 && <path d={conePath} fill="none" stroke="#38bdf8" strokeOpacity="0.85" strokeWidth="1.4" />}
          {/* guía cilíndrica de centrado y tobera frontal */}
          <rect x={guide0} y={Y0 - GUIDE_R} width={GUIDE_L} height={GUIDE_R * 2} fill="url(#rm-chrome)" stroke="#0b1220" strokeWidth="0.6" />
          <rect x={tip - NOZZLE_L} y={Y0 - 2.5} width={NOZZLE_L} height={5} rx={1} fill="url(#rm-metal-h)" stroke="#0b1220" strokeWidth="0.5" />
          <circle cx={tip} cy={Y0} r={1.4} fill={flowing ? '#e0f7ff' : '#0ea5e9'} />
          {flowing && <path d={`M ${tip} ${Y0} h 10`} stroke="#7dd3fc" strokeWidth="2.5" strokeDasharray="4 3" strokeDashoffset={-((tt * 40) % 7)} />}
        </g>
      ) : (
        <>
          <rect x={CYL.x0} y={Y0 - CYL.r} width={CYL.x1 - CYL.x0} height={CYL.r * 2} rx={3} fill="#1e293b" stroke="#475569" />
          <rect x={CYL.x0 - 4} y={Y0 - CYL.r - 3} width={5} height={CYL.r * 2 + 6} fill="#334155" />
          <rect x={CYL.x1 - 1} y={Y0 - CYL.r - 3} width={5} height={CYL.r * 2 + 6} fill="#334155" />
          <line x1={CYL.x1 + 4} y1={Y0} x2={head0} y2={Y0} stroke="#cbd5e1" strokeWidth="4" />
          <rect x={head0} y={Y0 - HEAD_R} width={HEAD_L} height={HEAD_R * 2} rx={2} fill="#475569" stroke="#94a3b8" />
          <rect x={head0 + 3} y={Y0 - 3} width={HEAD_L - 6} height={6} fill="#1e3a5f" />
          <path d={conePath} fill={coneColor} stroke="#0f172a" strokeWidth="0.8" />
          <rect x={guide0} y={Y0 - GUIDE_R} width={GUIDE_L} height={GUIDE_R * 2} fill="#94a3b8" stroke="#0f172a" strokeWidth="0.8" />
          <rect x={tip - NOZZLE_L} y={Y0 - 2.5} width={NOZZLE_L} height={5} fill="#0ea5e9" />
          {flowing && <path d={`M ${tip} ${Y0} h 10`} stroke="#7dd3fc" strokeWidth="2.5" className="flow" />}
        </>
      )}
      <text x={(CYL.x0 + CYL.x1) / 2} y={Y0 - CYL.r - 7} textAnchor="middle" className="fill-slate-400 text-[9px]">
        cilindro abocardador
      </text>
      <text x={(CYL.x0 + CYL.x1) / 2 + 20} y={Y0 + CYL.r + 22} textAnchor="middle" className={`text-[9px] ${b.B3 ? 'fill-sky-300' : 'fill-slate-400'}`}>
        cono 10° + guía + tobera
      </text>
    </g>
  )
}
