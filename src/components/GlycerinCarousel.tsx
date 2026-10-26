import { interlockThreshold } from '../sim/balance'
import type { CellSimulation } from '../sim/engine'
import { BATH, HDPE, levelDropFor, PIPE, submergedFraction, tempColor } from '../sim/physics'
import { fmt } from './format'
import { shade } from './render/color'

/** Vista frontal (en el eje del carrusel), a escala: 0,6 px por mm. */
const SCALE = 0.6
const CX = 250
const CY = 285
const R_BATH = BATH.radius * SCALE
const R_MOUNT = BATH.mountRadius * SCALE
const R_TUBE = (PIPE.od / 2) * SCALE
const R_SHAFT = (BATH.shaftDiameter / 2) * SCALE

const polar = (angleDeg: number, r: number): [number, number] => {
  const a = (angleDeg * Math.PI) / 180
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)]
}

/** Superficie ondulada de la glicerina al nivel del eje. */
/** Ángulo sin decimales si es entero (0°, 60°) y con uno si no (67,5°). */
const fmtAngle = (a: number) => fmt(a, Number.isInteger(Math.round(a * 10) / 10) ? 0 : 1)

/** Arco en el sentido de avance de los caños (ángulo decreciente = antihorario en pantalla). */
function arcCCW(fromDeg: number, toDeg: number, r: number) {
  const [x0, y0] = polar(fromDeg, r)
  const [x1, y1] = polar(toDeg, r)
  return `M ${x0} ${y0} A ${r} ${r} 0 0 0 ${x1} ${y1}`
}

function surfacePath(phase: number, level: { y: number; half: number }) {
  const x0 = CX - level.half
  const w = 2 * level.half
  let d = `M ${x0} ${level.y}`
  for (let x = 0; x <= w; x += 6) d += ` L ${x0 + x} ${level.y + Math.sin((x + phase) / 9) * 1.4}`
  return d
}

/** Segmento de batea ocupado por la glicerina: el nivel queda `drop` mm bajo el eje (resistencias en el fondo). */
function bathLevel(drop: number) {
  const y = CY + drop * SCALE
  return { y, half: Math.sqrt(R_BATH * R_BATH - (y - CY) * (y - CY)) }
}

export function GlycerinCarousel({ sim, render = false }: { sim: CellSimulation; render?: boolean }) {
  const s = sim.state
  const p = sim.params
  const n = s.slots.length
  const bath = s.bath
  const drop = levelDropFor(p.bathPods, n)
  const level = bathLevel(drop)
  const liquidShape = `M ${CX - level.half} ${level.y} A ${R_BATH} ${R_BATH} 0 0 0 ${CX + level.half} ${level.y} Z`
  const st = sim.stations
  const pickTube = sim.pickTube()
  const loadEmpty = s.indexProgress === null && s.slots[sim.loadSlot()] === null
  const emerging = sim.emergingTube()
  const threshold = interlockThreshold(p)
  const blocked = sim.indexBlocked()
  const stoppedFor = sim.lineStoppedFor()
  const atRisk = s.slots.filter((t) => sim.softeningRisk(t)).length
  let submerged = 0
  let inAir = 0
  const tubes = s.slots.map((tube, i) => {
    const angle = sim.slotAngle(i)
    const f = submergedFraction(angle, drop)
    if (tube) {
      if (f > 0.5) submerged++
      else if (f === 0) inAir++
    }
    return { tube, i, angle, f }
  })
  const [pickX, pickY] = polar(st.pickAngle, R_MOUNT)
  const [loadX, loadY] = polar(st.loadAngle, R_MOUNT)
  const loadTop = st.loadK === 0
  // Recuadros de las estaciones (fuera de la batea).
  const pickBox = { x: 384, y: 92, w: 212, h: 50 }
  const loadBox = loadTop ? { x: CX - 58, y: 50, w: 116, h: 34 } : { x: 6, y: 140, w: 112, h: 34 }
  const liquidTop = '#f59e0b'
  const liquidBottom = '#92400e'

  return (
    <g>
      <defs>
        <linearGradient id="glycerin" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={liquidTop} stopOpacity="0.55" />
          <stop offset="100%" stopColor={liquidBottom} stopOpacity="0.85" />
        </linearGradient>
        <marker id="arrowOrange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#fb923c" />
        </marker>
        <marker id="arrowBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#60a5fa" />
        </marker>
        <marker id="arrowGrey" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
        </marker>
        {/* Glicerina con profundidad: clara y translúcida arriba, ámbar oscuro hacia el fondo de la batea */}
        <radialGradient id="rm-amber" gradientUnits="userSpaceOnUse" cx={CX} cy={CY - 30} r={R_BATH + 30}>
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.6" />
          <stop offset="55%" stopColor="#b45309" stopOpacity="0.84" />
          <stop offset="100%" stopColor="#2f1503" stopOpacity="0.97" />
        </radialGradient>
        <linearGradient id="rm-rim" gradientUnits="userSpaceOnUse" x1={CX - R_BATH} y1={CY} x2={CX + R_BATH} y2={CY + R_BATH}>
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="35%" stopColor="#7b8ba1" />
          <stop offset="70%" stopColor="#3a475b" />
          <stop offset="100%" stopColor="#8b99ad" />
        </linearGradient>
        <radialGradient id="airPlume" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.10" />
          <stop offset="70%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Zona emergida (aire) */}
      <path d={`M ${CX - R_BATH} ${CY} A ${R_BATH} ${R_BATH} 0 0 1 ${CX + R_BATH} ${CY} Z`} fill="url(#airPlume)" />
      <text x={14} y={90} className="fill-slate-400 text-[10px]">
        Zona emergida · aire
      </text>
      <text x={14} y={102} className="fill-slate-500 text-[9px]">
        convección natural · {inAir} caños
      </text>

      {/* Glicerina: el nivel queda por debajo del eje porque las resistencias ocupan el fondo */}
      <path d={liquidShape} fill={render ? 'url(#rm-amber)' : 'url(#glycerin)'} />
      {render && <path d={liquidShape} fill="url(#rm-depth)" fillOpacity="0.45" />}
      <path d={surfacePath(s.t * 8, level)} fill="none" stroke="#fde68a" strokeOpacity={render ? 0.9 : 0.7} strokeWidth={render ? 1.6 : 1.2} />
      {render && <path d={surfacePath(s.t * 8 + 40, level)} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="0.8" transform="translate(0 2.6)" />}

      {/* Batea semicilíndrica */}
      {render && (
        <path
          d={`M ${CX - R_BATH - 16} ${CY - 6} H ${CX - R_BATH - 4} V ${CY} A ${R_BATH + 4} ${R_BATH + 4} 0 0 0 ${CX + R_BATH + 4} ${CY} V ${CY - 6} H ${CX + R_BATH + 16}`}
          fill="none"
          stroke="#05080d"
          strokeWidth="8.5"
          strokeLinejoin="round"
          filter="url(#rm-shadow)"
        />
      )}
      <path
        d={`M ${CX - R_BATH - 16} ${CY - 6} H ${CX - R_BATH - 4} V ${CY} A ${R_BATH + 4} ${R_BATH + 4} 0 0 0 ${CX + R_BATH + 4} ${CY} V ${CY - 6} H ${CX + R_BATH + 16}`}
        fill="none"
        stroke={render ? 'url(#rm-rim)' : '#94a3b8'}
        strokeWidth={render ? 6 : 5}
        strokeLinejoin="round"
      />
      {render && (
        <path
          d={`M ${CX - R_BATH - 16} ${CY - 6} H ${CX - R_BATH - 4} V ${CY} A ${R_BATH + 4} ${R_BATH + 4} 0 0 0 ${CX + R_BATH + 4} ${CY} V ${CY - 6} H ${CX + R_BATH + 16}`}
          fill="none"
          stroke="#fff"
          strokeOpacity="0.5"
          strokeWidth="1.2"
          strokeLinejoin="round"
          transform="translate(-1.4 -1.6)"
        />
      )}
      {/* Resistencias */}
      <path
        d={`M ${CX - 60} ${CY + R_BATH - 14} ${Array.from({ length: 12 }, (_, k) => `l 5 ${k % 2 ? 5 : -5} l 5 ${k % 2 ? -5 : 5}`).join(' ')}`}
        fill="none"
        stroke={bath.heaterPower > 50 ? '#f87171' : '#57534e'}
        strokeWidth="2"
      />

      {/* Estructura del carrusel: aro y rayos */}
      <circle cx={CX} cy={CY} r={R_MOUNT} fill="none" stroke="#64748b" strokeWidth="1.2" strokeDasharray="2 3" />
      {tubes.map(({ i, angle }) => {
        const [x, y] = polar(angle, R_MOUNT)
        return render ? (
          <g key={`r${i}`}>
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="#0b1220" strokeWidth="3.4" />
            <line x1={CX} y1={CY} x2={x} y2={y} stroke="#8a99ae" strokeWidth="1.3" transform="translate(-0.5 -0.6)" />
          </g>
        ) : (
          <line key={`r${i}`} x1={CX} y1={CY} x2={x} y2={y} stroke="#64748b" strokeWidth="1.5" />
        )
      })}

      {/* Sentido de giro (los caños bajan por la izquierda y suben por la derecha) */}
      <path d={arcCCW(200, 160, R_MOUNT + 20)} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowGrey)" />
      <path d={arcCCW(335, 305, R_MOUNT + 20)} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrowGrey)" />
      {/* Emersión: de la última posición sumergida al RETIRO */}
      <path
        d={arcCCW(st.pickAngle + st.step - 6, st.pickAngle + 8, R_MOUNT + 20)}
        fill="none"
        stroke="#fb923c"
        strokeWidth="2"
        markerEnd="url(#arrowOrange)"
      />

      {/* Estaciones fijas (no giran con el carrusel) */}
      <circle cx={pickX} cy={pickY} r={R_TUBE + 6} fill="none" stroke="#fb923c" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx={loadX} cy={loadY} r={R_TUBE + 6} fill="none" stroke="#60a5fa" strokeWidth="2" strokeDasharray="4 3" />

      {/* Caños (vista de punta Ø40) */}
      {tubes.map(({ tube, i, angle, f }) => {
        const [x, y] = polar(angle, R_MOUNT)
        const [lx, ly] = polar(angle, R_MOUNT - 27)
        const atStation = tube !== null && tube === pickTube
        const hot = tube !== null && tube.temp > HDPE.overheatAlarm
        const softening = !hot && sim.softeningRisk(tube)
        const isEmerging = tube !== null && tube === emerging
        return (
          <g key={`t${i}`}>
            {tube ? (
              <>
                {render && <circle cx={x + 2.4} cy={y + 3.4} r={R_TUBE} fill="#000" fillOpacity="0.4" />}
                <circle
                  cx={x}
                  cy={y}
                  r={R_TUBE}
                  fill={tempColor(tube.temp)}
                  stroke={hot ? '#fecaca' : softening ? '#facc15' : atStation ? '#f8fafc' : f > 0.5 ? '#fde68a' : f > 0 ? '#fbbf24' : '#94a3b8'}
                  strokeWidth={atStation || hot || isEmerging ? 2.5 : 1.5}
                  className={hot ? 'blink' : softening ? 'blink-warn' : undefined}
                >
                  <title>
                    Posición {i + 1} · caño #{tube.id} · {tube.temp.toFixed(1)} °C ·{' '}
                    {f > 0.5 ? 'sumergido' : f > 0 ? 'en la superficie' : 'al aire'} · residencia {fmt(s.t - tube.loadedAt, 0)} s
                  </title>
                </circle>
                {render ? (
                  <>
                    {/* pared del caño (anillo), interior hueco más oscuro y brillo especular de luz cenital */}
                    <circle cx={x} cy={y} r={R_TUBE - 2.6} fill={shade(tempColor(tube.temp), -0.2)} />
                    <circle cx={x} cy={y} r={R_TUBE - 2.6} fill="url(#rm-bore)" />
                    <circle cx={x} cy={y} r={R_TUBE - 2.6} fill="none" stroke="#000" strokeOpacity="0.55" strokeWidth="0.8" />
                    <circle cx={x} cy={y} r={R_TUBE} fill="url(#rm-tube-rim)" pointerEvents="none" />
                    <ellipse
                      cx={x - R_TUBE * 0.3}
                      cy={y - R_TUBE * 0.4}
                      rx={R_TUBE * 0.44}
                      ry={R_TUBE * 0.24}
                      fill="url(#rm-tube-spec)"
                      transform={`rotate(-32 ${x - R_TUBE * 0.3} ${y - R_TUBE * 0.4})`}
                      pointerEvents="none"
                    />
                  </>
                ) : (
                  <circle cx={x} cy={y} r={R_TUBE - 2.5} fill="none" stroke="#0f172a" strokeOpacity="0.5" />
                )}
                <text
                  x={lx}
                  y={ly + 3.5}
                  textAnchor="middle"
                  className="pointer-events-none text-[10px] font-semibold"
                  fill="#f8fafc"
                  stroke="#0f172a"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {tube.temp.toFixed(0)}°
                </text>
              </>
            ) : (
              <circle cx={x} cy={y} r={R_TUBE} fill="none" stroke="#475569" strokeDasharray="3 2" />
            )}
          </g>
        )
      })}

      {/* Eje central Ø40 */}
      {render && <circle cx={CX + 2} cy={CY + 3} r={R_SHAFT} fill="#000" fillOpacity="0.4" />}
      <circle cx={CX} cy={CY} r={R_SHAFT} fill={render ? 'url(#rm-disc)' : '#334155'} stroke={render ? '#0b1220' : '#cbd5e1'} strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={2} fill={render ? 'url(#rm-bolt)' : '#cbd5e1'} />
      <text
        x={CX}
        y={CY - R_SHAFT - 6}
        textAnchor="middle"
        className="fill-slate-200 text-[9px]"
        stroke="#0f172a"
        strokeWidth="3"
        paintOrder="stroke"
      >
        eje Ø{BATH.shaftDiameter}
      </text>

      {/* RETIRO: el caño se toma apenas se descubre del baño, en el lado que sube */}
      <path
        d={`M ${pickX + R_TUBE + 7} ${pickY - 6} L ${pickBox.x - 4} ${pickBox.y + pickBox.h / 2}`}
        fill="none"
        stroke="#fb923c"
        strokeWidth="2"
        markerEnd="url(#arrowOrange)"
      />
      <g transform={`translate(${pickBox.x} ${pickBox.y})`}>
        <rect width={pickBox.w} height={pickBox.h} rx={6} fill="#1c1208" stroke="#fb923c" strokeWidth="1.5" />
        <text x={8} y={14} className="fill-orange-300 text-[10px] font-bold">
          RETIRO · salida del baño ({fmtAngle(st.pickAngle)}°)
        </text>
        <text x={8} y={29} className="text-[11px] font-semibold" fill={pickTube ? (pickTube.temp < HDPE.softMin ? '#fcd34d' : '#fdba74') : '#64748b'}>
          {pickTube ? `caño #${pickTube.id} · ${pickTube.temp.toFixed(1)} °C → operario` : s.indexProgress !== null ? 'emergiendo…' : 'vacío (ya retirado)'}
        </text>
        <text x={8} y={43} className={`text-[9px] ${blocked ? 'fill-red-300' : 'fill-slate-400'}`}>
          próximo: {emerging ? `${emerging.temp.toFixed(1)} °C` : '—'}
          {p.tempInterlock ? ` · enclavamiento ≥ ${threshold.toFixed(0)} °C` : ''}
        </text>
      </g>

      {/* CARGA FRÍO */}
      <path
        d={
          loadTop
            ? `M ${CX} ${loadBox.y + loadBox.h + 2} L ${loadX} ${loadY - R_TUBE - 8}`
            : `M ${loadBox.x + loadBox.w - 20} ${loadBox.y + loadBox.h + 2} L ${loadX - R_TUBE - 5} ${loadY - R_TUBE - 3}`
        }
        fill="none"
        stroke="#60a5fa"
        strokeWidth="2"
        markerEnd="url(#arrowBlue)"
      />
      <g transform={`translate(${loadBox.x} ${loadBox.y})`}>
        <rect width={loadBox.w} height={loadBox.h} rx={6} fill="#0b1a2e" stroke="#60a5fa" strokeWidth="1.5" />
        <text x={loadBox.w / 2} y={14} textAnchor="middle" className="fill-blue-300 text-[10px] font-bold">
          CARGA FRÍO ({fmtAngle(st.loadAngle)}°)
        </text>
        <text x={loadBox.w / 2} y={27} textAnchor="middle" className={`text-[9px] ${loadEmpty ? 'fill-blue-200' : 'fill-slate-400'}`}>
          {loadEmpty ? 'posición vacía: cargar' : 'cargado'}
        </text>
      </g>

      <text x={CX - R_BATH - 6} y={CY - 12} textAnchor="middle" className="fill-slate-500 text-[9px]">
        entrada ↓
      </text>

      {/* Detención de línea: el baño (132 °C) está sobre la consigna y los caños siguen subiendo */}
      {stoppedFor > HDPE.stopWarnSeconds && (
        <text x={CX} y={CY + R_BATH + 52} textAnchor="middle" className="blink-text fill-yellow-300 text-[10px] font-bold">
          ⚠ Detenida {fmt(stoppedFor, 0)} s · {atRisk} caño{atRisk === 1 ? '' : 's'} &gt; {HDPE.softeningWarn} °C · riesgo de reblandecimiento
        </text>
      )}

      {/* Estado de la batea y del carrusel */}
      <text x={CX} y={CY + R_BATH + 22} textAnchor="middle" className="fill-amber-200 text-[10px] font-semibold">
        Glicerina {fmt(bath.temp, 1)} °C · {fmt(bath.volumeL, 2)} L · calefacción {fmt(bath.heaterPower / 1000, 1)} kW · {submerged} sumergidos
      </text>
      <text x={CX} y={CY + R_BATH + 36} textAnchor="middle" className="fill-slate-400 text-[10px]">
        Batea R{BATH.radius} × L{BATH.length} mm · carrusel {n} pos. ·{' '}
        <tspan className={s.indexProgress !== null ? 'fill-sky-300' : blocked ? 'fill-amber-300' : 'fill-slate-400'}>
          {s.indexProgress !== null ? '↺ girando' : blocked ? '⏸ giro retenido (enclavamiento)' : 'detenido'}
        </tspan>
      </text>
    </g>
  )
}
