import type { CellSimulation, OpTask } from '../sim/engine'
import { TASK_LABEL } from './labels'
import { LStation } from './LStation'
import { tempColor, TEMP_LEGEND, waterColor } from '../sim/physics'
import { fmt } from './format'
import { GlycerinCarousel } from './GlycerinCarousel'
import { RenderDefs } from './render/materials'
import type { Ref } from 'react'

type Pt = [number, number]
type Layout = Record<'pick' | 'load' | 'rack' | 'press' | 'bin' | 'rest', Pt>

/** Puestos del operario: RETIRO a la derecha (lado que sube), CARGA en el cenit o a la izquierda. */
function layout(loadTop: boolean): Layout {
  return {
    pick: [466, 196],
    load: loadTop ? [320, 70] : [40, 215],
    rack: loadTop ? [400, 30] : [53, 58],
    press: [748, 398],
    bin: [770, 440],
    rest: [560, 50],
  }
}

const lerp = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

function operatorPos(POS: Layout, task: OpTask, f: number): Pt {
  switch (task) {
    case 'UNLOAD':
      return lerp(POS.press, POS.bin, f)
    case 'PICK':
    case 'WAIT_TEMP':
    case 'WAIT_INDEX':
      return POS.pick
    case 'TRANSFER':
      return lerp(POS.pick, POS.press, f)
    case 'LOAD':
      return f < 0.4 ? lerp(POS.pick, POS.rack, f / 0.4) : lerp(POS.rack, POS.load, (f - 0.4) / 0.6)
    case 'WAIT_PRESS':
      return POS.press
    case 'PAUSED':
      return POS.rest
  }
}

export function CellView({ sim, render = false, svgRef }: { sim: CellSimulation; render?: boolean; svgRef?: Ref<SVGSVGElement> }) {
  const s = sim.state
  const p = sim.params
  const op = s.operator
  const opF = op.duration > 0 ? Math.min(1, op.elapsed / op.duration) : 0
  const loadTop = sim.stations.loadK === 0
  const POS = layout(loadTop)
  const [ox, oy] = operatorPos(POS, op.task, opF)

  const injecting = s.press.out.Y4
  const heatMJ = s.tank.heatIn / 1e6
  const glycPct = (s.tank.glycerinMl / (p.tankVolume * 1000 + s.tank.glycerinMl)) * 100
  const glycGoalMl = p.dailyGoal * p.dragOutMl
  const glycGoalPct = (glycGoalMl / (p.tankVolume * 1000 + glycGoalMl)) * 100
  const glycGoalFrac = glycGoalMl > 0 ? s.tank.glycerinMl / glycGoalMl : 0

  return (
    <svg ref={svgRef} viewBox="0 0 960 600" className="h-auto w-full select-none" role="img" aria-label={render ? 'Cámara de la celda de manufactura (modo render)' : 'Vista 2D de la celda de manufactura'}>
      {render && <RenderDefs />}
      <defs>
        <linearGradient id="tempScale" x1="0" x2="1">
          {TEMP_LEGEND.map((t, i) => (
            <stop key={t} offset={`${(i / (TEMP_LEGEND.length - 1)) * 100}%`} stopColor={tempColor(t)} />
          ))}
        </linearGradient>
        <pattern id="floor" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0V24" fill="none" stroke="#1e293b" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="960" height="600" fill={render ? 'url(#rm-floor)' : 'url(#floor)'} />
      {render && <rect width="960" height="600" fill="url(#floor)" opacity="0.45" />}

      {/* Leyenda de temperatura */}
      <g transform="translate(16 540)">
        <text x="0" y="10" className="fill-slate-400 text-[11px]">Temperatura del caño</text>
        <rect x="0" y="16" width="200" height="10" rx="3" fill="url(#tempScale)" />
        {[20, 60, 95, 125, 155].map((t) => {
          const i = TEMP_LEGEND.indexOf(t)
          const x = (i / (TEMP_LEGEND.length - 1)) * 200
          return (
            <text key={t} x={x} y="38" textAnchor="middle" className="fill-slate-400 text-[9px]">
              {t}°
            </text>
          )
        })}
      </g>

      {/* ---------------- Carrusel en batea de glicerina ---------------- */}
      <GlycerinCarousel sim={sim} render={render} />

      {/* Estiba de caños fríos */}
      <g transform={loadTop ? 'translate(355 14)' : 'translate(8 40)'}>
        {[0, 1, 2, 3, 4].map((k) => (
          <g key={k}>
            <rect x={0} y={k * 7} width={90} height={6} rx={3} fill={tempColor(p.ambientTemp)} opacity={0.9} />
            {render && <rect x={0} y={k * 7} width={90} height={6} rx={3} fill="url(#rm-cyl-shade)" />}
          </g>
        ))}
        <text x={45} y={-6} textAnchor="middle" className="fill-slate-400 text-[10px]">
          Caños fríos (860 mm)
        </text>
      </g>

      {/* ---------------- Estación de conformado en L ---------------- */}
      <LStation sim={sim} render={render} />

      {/* Bomba */}
      <g transform="translate(650 540)">
        {render && <circle cx="3" cy="5" r="18" fill="#000" fillOpacity="0.45" />}
        <circle r="18" fill={render ? 'url(#rm-disc)' : '#0f172a'} stroke={injecting ? '#38bdf8' : '#475569'} strokeWidth="2" />
        <g className={injecting ? 'spin' : undefined}>
          <path d="M 0 -11 L 3 0 L 0 11 L -3 0 Z M -11 0 L 0 3 L 11 0 L 0 -3 Z" fill={injecting ? '#38bdf8' : '#64748b'} />
        </g>
        <text x="0" y="31" textAnchor="middle" className="fill-slate-300 text-[10px]">
          Bomba 1 HP
        </text>
        <text x="0" y="43" textAnchor="middle" className="fill-slate-500 text-[9px]">
          ~2 bar · {p.pumpFlow} L/min
        </text>
      </g>

      {/* Tanque */}
      <g transform="translate(470 440)">
        {render && <rect x="4" y="6" width="140" height="130" rx="8" fill="#000" fillOpacity="0.45" />}
        <rect x="0" y="0" width="140" height="130" rx="8" fill="#0b1220" stroke={render ? '#94a3b8' : '#475569'} strokeWidth="2" />
        <rect x="4" y="24" width="132" height="102" rx="5" fill={waterColor(s.tank.temp)} opacity="0.85" />
        {render && (
          <>
            <rect x="4" y="24" width="132" height="102" rx="5" fill="url(#rm-depth)" />
            <rect x="0" y="0" width="140" height="130" rx="8" fill="url(#rm-glass)" pointerEvents="none" />
            <line x1="9" y1="30" x2="9" y2="116" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.4" />
          </>
        )}
        <path d="M 4 24 q 16 -5 33 0 t 33 0 t 33 0 t 33 0" fill="none" stroke="#e0f2fe" strokeOpacity="0.5" />
        <text x="70" y="-8" textAnchor="middle" className="fill-slate-300 text-[12px] font-semibold">
          Tanque {p.tankVolume} L
        </text>
        <text x="70" y="44" textAnchor="middle" className="fill-white text-[18px] font-bold">
          {s.tank.temp.toFixed(1)} °C
        </text>
        <text x="70" y="57" textAnchor="middle" className="fill-white/90 text-[9px]">
          calor acumulado {fmt(heatMJ, 2)} MJ
        </text>
        <text x="70" y="68" textAnchor="middle" className="fill-white/80 text-[9px]">
          inicial {p.waterInitTemp} °C · Δ {fmt(s.tank.temp - p.waterInitTemp, 1)} °C
        </text>
        {/* Glicerina arrastrada (dilución en el agua de lavado) */}
        <g transform="translate(8 74)">
          <rect width="124" height="50" rx="4" fill="#0f172a" opacity="0.9" />
          <text x="62" y="11" textAnchor="middle" className="fill-amber-300 text-[9px] font-semibold">
            Glicerina acumulada
          </text>
          <text x="62" y="24" textAnchor="middle" className="fill-amber-100 text-[11px] font-bold">
            {fmt(s.tank.glycerinMl, 0)} ml · {fmt(glycPct, 3)} %
          </text>
          <rect x="5" y="29" width="114" height="5" rx="2.5" fill="#1e293b" />
          <rect x="5" y="29" width={114 * Math.min(1, glycGoalFrac)} height="5" rx="2.5" fill="#f59e0b" />
          <text x="62" y="45" textAnchor="middle" className="fill-slate-400 text-[8px]">
            a {p.dailyGoal} pz: {fmt(glycGoalMl / 1000, 2)} L ({fmt(glycGoalPct, 2)} %)
          </text>
        </g>
        {/* Termómetro */}
        <g transform="translate(-22 10)">
          <rect x="0" y="0" width="10" height="110" rx="5" fill="#1e293b" />
          <rect
            x="2"
            y={2 + 106 * (1 - Math.min(1, Math.max(0, (s.tank.temp - 10) / 40)))}
            width="6"
            height={106 * Math.min(1, Math.max(0, (s.tank.temp - 10) / 40))}
            rx="3"
            fill={waterColor(s.tank.temp)}
          />
          <text x="5" y="124" textAnchor="middle" className="fill-slate-500 text-[8px]">
            10–50
          </text>
        </g>
      </g>

      {/* Contenedores */}
      <g transform="translate(720 460)">
        {render && <rect x="3" y="5" width="92" height="80" rx="6" fill="#000" fillOpacity="0.45" />}
        <rect width="92" height="80" rx="6" fill="#052e16" stroke="#16a34a" strokeWidth="1.5" />
        {render && <rect width="92" height="80" rx="6" fill="url(#rm-bin-shade)" />}
        <text x="46" y="-6" textAnchor="middle" className="fill-emerald-300 text-[11px] font-semibold">
          Curvas OK
        </text>
        <text x="46" y="48" textAnchor="middle" className="fill-emerald-200 text-[22px] font-bold">
          {s.good}
        </text>
      </g>
      <g transform="translate(830 460)">
        {render && <rect x="3" y="5" width="92" height="80" rx="6" fill="#000" fillOpacity="0.45" />}
        <rect width="92" height="80" rx="6" fill="#450a0a" stroke="#dc2626" strokeWidth="1.5" />
        {render && <rect width="92" height="80" rx="6" fill="url(#rm-bin-shade)" />}
        <text x="46" y="-6" textAnchor="middle" className="fill-red-300 text-[11px] font-semibold">
          Scrap
        </text>
        <text x="46" y="48" textAnchor="middle" className="fill-red-200 text-[22px] font-bold">
          {s.scrap}
        </text>
      </g>

      {/* Descanso */}
      <text x={POS.rest[0]} y={POS.rest[1] - 26} textAnchor="middle" className="fill-slate-600 text-[10px]">
        zona de descanso
      </text>

      {/* ---------------- Operario ---------------- */}
      <g style={{ transform: `translate(${ox}px, ${oy}px)`, transition: 'transform 0.25s linear' }}>
        {render && <ellipse cy="22" rx="15" ry="5" fill="#000" fillOpacity="0.45" />}
        <circle r="22" fill={op.task.startsWith('WAIT') ? '#1e293b' : op.task === 'PAUSED' ? '#3f3f46' : '#1d4ed8'} opacity="0.35" />
        <circle cy="-8" r="7" fill="#fde68a" />
        <rect x="-8" y="0" width="16" height="16" rx="5" fill={op.task === 'PAUSED' ? '#71717a' : '#facc15'} />
        {op.carrying && (
          <g>
            <rect x="-40" y="-2" width="80" height="7" rx="3.5" fill={tempColor(op.carrying.temp)} stroke="#0f172a">
              <title>{op.carrying.temp.toFixed(1)} °C</title>
            </rect>
            {render && <rect x="-40" y="-2" width="80" height="7" rx="3.5" fill="url(#rm-cyl-shade)" />}
          </g>
        )}
        {op.task === 'LOAD' && opF > 0.4 && <rect x="-40" y="-2" width="80" height="7" rx="3.5" fill={tempColor(p.ambientTemp)} />}
        <rect x="-58" y="24" width="116" height="18" rx="4" fill="#0f172a" opacity="0.9" />
        <text y="37" textAnchor="middle" className={`text-[10px] font-semibold ${op.task.startsWith('WAIT') ? 'fill-amber-300' : op.task === 'PAUSED' ? 'fill-zinc-400' : 'fill-sky-200'}`}>
          {TASK_LABEL[op.task]}
          {op.duration > 0 ? ` ${Math.max(0, op.duration - op.elapsed).toFixed(1)}s` : ''}
        </text>
      </g>
    </svg>
  )
}
