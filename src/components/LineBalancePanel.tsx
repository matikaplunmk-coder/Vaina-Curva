import type { LineBalance } from '../sim/balance'
import type { Hydraulics } from '../sim/physics'
import { fmt, SERIES } from './format'
import { STEP_COLOR } from './labels'

const BOTTLENECK_LABEL = {
  carrusel: 'Carrusel (inmersión en glicerina)',
  prensa: 'Prensa (cierre + enfriamiento)',
  operario: 'Operario (manipulación)',
}

function Row({ k, v, strong, testId }: { k: string; v: string; strong?: boolean; testId?: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5" data-testid={testId}>
      <span className="text-slate-400">{k}</span>
      <span className={`font-mono ${strong ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{v}</span>
    </div>
  )
}

export function LineBalancePanel({
  b,
  hyd,
  measuredCycle,
  interlock,
  ambient,
  target,
  bath,
}: {
  b: LineBalance
  hyd: Hydraulics
  measuredCycle: number | null
  interlock: boolean
  ambient: number
  target: number
  bath: number
}) {
  const finite = Number.isFinite(b.cycle)
  const scale = finite ? b.cycle : 1
  // Barras del ciclo: tareas del operario en serie vs. máquina.
  const opBars = [
    { label: 'Descarga', v: b.unload, c: SERIES.blue },
    { label: 'Toma', v: b.pick, c: SERIES.orange },
    { label: 'Carga en matriz', v: b.transfer, c: SERIES.yellow },
    { label: 'Carga frío', v: b.load, c: SERIES.aqua },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
      <div>
        <div className="mb-3 space-y-2">
          <BarRow label="Operario" parts={opBars} scale={scale} />
          <BarRow
            label="Prensa"
            offset={b.unload + b.pick + b.transfer}
            parts={b.steps.filter((st) => st.n <= 9).map((st) => ({ label: `${st.n} · ${st.label}`, v: st.s, c: STEP_COLOR[st.n] }))}
            scale={scale}
          />
          <BarRow label="Carrusel" parts={[{ label: 'Permanencia mínima / posición', v: b.cycleCarousel, c: '#e87ba4' }]} scale={scale} />
        </div>
        <table className="mb-2 w-full text-[11px]">
          <tbody>
            {b.steps.map((st) => (
              <tr key={st.n} className="border-b border-slate-800/60">
                <td className="py-0.5 pr-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: STEP_COLOR[st.n] }} />
                </td>
                <td className="py-0.5 text-slate-400">
                  {st.n}. {st.label}
                </td>
                <td className="py-0.5 text-right font-mono text-slate-300">{fmt(st.s * 1000, 0)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Row k="Máquina: pasos 1–9" v={`${fmt(b.pressCycle)} s`} />
        <Row k="Operario: paso 10 + carga en frío (en paralelo)" v={`${fmt(b.steps[9].s)} + ${fmt(b.load)} s`} />
        <Row k="Ciclo operario + prensa = paso 10 + máx(1–9, carga frío)" v={`${fmt(b.cycleOperator)} s`} />
        <Row k={`Tiempo sumergido ${fmt(ambient, 0)} → ${fmt(target, 0)} °C (baño ${fmt(bath, 0)} °C)`} v={Number.isFinite(b.heatTime) ? `${fmt(b.heatTime, 0)} s` : '∞'} />
        <Row k={`Retención mínima por estación (÷ ${fmt(b.submergedPositions, 1)} pos. sumergidas)`} v={`${fmt(b.cycleCarousel)} s`} />
        <Row k="Ciclo teórico" v={finite ? `${fmt(b.cycle)} s` : '∞ (glicerina < objetivo)'} strong testId="balance-cycle" />
        <Row k="Residencia carga → retiro" v={finite ? `${fmt(b.residence, 0)} s` : '—'} />
        <Row k="  · aire previo / glicerina / giro" v={finite ? `${fmt(b.airBeforeBath, 0)} / ${fmt(b.inBath, 0)} / ${fmt(b.transitToPick, 0)} s` : '—'} />
        <Row
          k="Estaciones: retiro / carga"
          v={`${fmt(b.stations.pickAngle, 0)}° / ${fmt(b.stations.loadAngle, 0)}° · ${b.stations.journey} pasos`}
        />
        <Row k="Ciclo medido (últimos 10)" v={measuredCycle ? `${fmt(measuredCycle)} s` : '—'} strong />
      </div>
      <div>
        <div className={`mb-2 rounded-lg border px-3 py-2 ${b.meetsGoal ? 'border-emerald-700 bg-emerald-950/40' : 'border-red-700 bg-red-950/40'}`}>
          <div className="text-[11px] text-slate-400">Cuello de botella</div>
          <div className="text-sm font-semibold text-slate-100">{BOTTLENECK_LABEL[b.bottleneck]}</div>
          <div className="mt-1 text-[11px] text-slate-300">
            {b.meetsGoal ? '✔ ' : '✖ '}
            Capacidad {fmt(b.capacityPerDay, 0)} pz/día vs meta · takt {fmt(b.takt)} s
          </div>
        </div>
        <Row k="Capacidad teórica" v={`${fmt(b.capacityPerHour)} pz/h`} strong />
        <Row k="Ocupación teórica operario" v={`${fmt(b.occupancy * 100, 0)} %`} />
        <Row k={interlock ? 'Temp. estimada al retirar (con enclavamiento)' : 'Temp. estimada al retirar (ritmo fijo)'} v={`${fmt(b.pickTemp)} °C`} />
        <Row k="Temp. al emerger / pérdida al retiro" v={`${fmt(b.bathExitTemp)} °C / −${fmt(b.airLoss, 2)} °C`} />
        <Row k="Glicerina arrastrada al agua por día" v={`${fmt(b.dragOutPerDay, 2)} L`} />
        <Row k="Temp. estimada al abrir matriz (paso 9)" v={`${fmt(b.demoldTemp)} °C`} />
        <Row k="Llenado de la L / templado efectivo" v={`${fmt(b.fillTime, 2)} s / ${fmt(b.pressInject)} s`} />
        <div className="mt-2 border-t border-slate-800 pt-2">
          <div className="mb-1 font-semibold text-slate-300">Mordaza de fricción Ø40</div>
          <Row k="Fuerza del cilindro" v={`${fmt(b.clamp.force, 0)} N (${fmt(b.clamp.force / 9.81, 0)} kgf)`} />
          <Row k="Retención por rozamiento (μ 0,35 × 2 caras)" v={`${fmt(b.clamp.friction, 0)} N`} />
          <Row k="Empuje mandril + presión de agua" v={`${fmt(b.clamp.mandrelPush, 0)} + ${fmt(b.clamp.waterPush, 0)} N`} />
          <Row
            k="Margen de retención"
            v={`${fmt(b.clamp.margin, 2)} ${b.clamp.margin < 1 ? '✖ desliza' : b.clamp.margin < 1.5 ? '⚠ justo' : '✔'}`}
            strong
          />
        </div>
        <div className="mt-2 border-t border-slate-800 pt-2">
          <div className="mb-1 font-semibold text-slate-300">Hidráulica del lavado interno</div>
          <Row k="Ø interior" v={`${fmt(hyd.diMm)} mm`} />
          <Row k="Velocidad del agua" v={`${fmt(hyd.velocity, 2)} m/s`} />
          <Row k="Reynolds" v={`${fmt(hyd.reynolds, 0)} (turbulento)`} />
          <Row k="h convectivo (Dittus-Boelter)" v={`${fmt(hyd.hWater, 0)} W/m²K`} />
          <Row k="Potencia hidráulica / rend. s/1 HP" v={`${fmt(hyd.hydraulicPower, 0)} W · ${fmt(hyd.pumpEfficiency * 100, 0)} %`} />
          <Row k="Volumen por disparo" v={`${fmt(hyd.shotVolume(b.pressInject))} L`} />
        </div>
      </div>
    </div>
  )
}

function BarRow({ label, parts, scale, offset = 0 }: { label: string; parts: { label: string; v: number; c: string }[]; scale: number; offset?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-slate-400">{label}</span>
      <div className="relative flex h-5 flex-1 overflow-hidden rounded bg-slate-950">
        {offset > 0 && <div style={{ width: `${(offset / scale) * 100}%` }} />}
        {parts.map((p) => (
          <div
            key={p.label}
            title={`${p.label}: ${fmt(p.v)} s`}
            className="h-full border-r-2 border-slate-900"
            style={{ width: `${Math.min(100, (p.v / scale) * 100)}%`, background: p.c }}
          />
        ))}
      </div>
    </div>
  )
}
