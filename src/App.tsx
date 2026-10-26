import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlarmPanel } from './components/AlarmPanel'
import { CalibrationDrawer } from './components/CalibrationDrawer'
import { CctvView } from './components/cctv/CctvView'
import { CellView } from './components/CellView'
import { ALARM_META, TASK_LABEL } from './components/labels'
import { Card, CoolingChart, HeatingChart, ManMachineChart, OccupancyChart, ProductionChart, RateChart } from './components/Charts'
import { ControlPanel, SimulationControls } from './components/ControlPanel'
import { fmt, fmtClock } from './components/format'
import { LineBalancePanel } from './components/LineBalancePanel'
import { PlcPanel } from './components/PlcPanel'
import { useSimulation } from './hooks/useSimulation'
import { useViewMode } from './hooks/viewMode'
import { computeBalance, trajectoryCurve, trajectoryPositions } from './sim/balance'
import type { OpTask } from './sim/engine'
import { bathTau, EMERGED_TAU, HDPE, hydraulics, levelDropFor, PIPE } from './sim/physics'

const BREAKDOWN: { k: OpTask; c: string }[] = [
  { k: 'UNLOAD', c: '#3987e5' },
  { k: 'PICK', c: '#d95926' },
  { k: 'TRANSFER', c: '#c98500' },
  { k: 'LOAD', c: '#199e70' },
  { k: 'WAIT_PRESS', c: '#475569' },
  { k: 'WAIT_TEMP', c: '#7f1d1d' },
  { k: 'WAIT_INDEX', c: '#64748b' },
  { k: 'PAUSED', c: '#3f3f46' },
]

function Kpi({
  label,
  value,
  sub,
  tone = 'default',
  testId,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'ok' | 'bad'
  testId?: string
}) {
  const color = tone === 'ok' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-50'
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2" data-testid={testId}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

export default function App() {
  const c = useSimulation()
  const [drawer, setDrawer] = useState(false)
  const [viewMode, setViewMode] = useViewMode()
  const renderMode = viewMode === 'render'
  // La cámara sólo graba cuadros mientras el Modo Render está activo (la vista técnica no paga nada).
  const { frames, sim: engine } = c
  useEffect(() => {
    frames.setEnabled(renderMode, engine)
  }, [renderMode, frames, engine])
  const openDrawer = useCallback(() => setDrawer(true), [])
  const closeDrawer = useCallback(() => setDrawer(false), [])
  const { sim, params: p, charts } = c
  const s = sim.state
  const m = sim.metrics()

  const balance = useMemo(() => computeBalance(p), [p])
  // Trayectoria térmica teórica de un caño en el carrusel con el ciclo de régimen.
  const trajCycle = Number.isFinite(balance.cycle) ? balance.cycle : 60
  const trajectory = useMemo(() => {
    const curve = trajectoryCurve(p, trajCycle)
    const spans: [number, number][] = []
    trajectoryPositions(p.slots, p.loadStation, 0, levelDropFor(p.bathPods, p.slots)).forEach((pos, j) => {
      if (pos.f <= 0) return
      const a = j * trajCycle
      const last = spans[spans.length - 1]
      if (last && Math.abs(last[1] - a) < 1e-6) last[1] = a + trajCycle
      else spans.push([a, a + trajCycle])
    })
    return { curve, spans }
  }, [p, trajCycle])
  const glycPct = (s.tank.glycerinMl / (p.tankVolume * 1000 + s.tank.glycerinMl)) * 100
  const hyd = useMemo(() => hydraulics(p.pumpFlow, p.wallThickness), [p.pumpFlow, p.wallThickness])

  const needed = p.dailyGoal / p.shiftHours
  const goalNow = (p.dailyGoal * s.t) / (p.shiftHours * 3600)
  const latestAlarm = s.alarms.find((a) => a.kind !== 'INFO')
  const breakdownTotal = BREAKDOWN.reduce((a, b) => a + s.opTime[b.k], 0)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-slate-50">Simulador de celda · Curvas conduit PEAD</h1>
            <p className="text-xs text-slate-400">
              Caño Ø{PIPE.od} mm · e {fmt(p.wallThickness)} mm · {PIPE.length} mm · 1 operario · carrusel {p.slots} pos. en batea de glicerina {p.bathTemp} °C
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <div className="font-mono text-xl font-bold text-sky-300 tabular-nums">{fmtClock(s.t)}</div>
              <div className="text-[11px] text-slate-500">
                de {fmtClock(p.shiftHours * 3600)} · {c.speed === 'step' ? 'paso a paso' : `${c.speed}×`}
              </div>
            </div>
            <div className="flex overflow-hidden rounded-lg border border-slate-700" role="group" aria-label="Modo de vista">
              <button
                onClick={() => setViewMode('technical')}
                aria-pressed={!renderMode}
                className={`px-2.5 py-1.5 text-xs font-semibold ${!renderMode ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                Vista técnica
              </button>
              <button
                onClick={() => setViewMode('render')}
                aria-pressed={renderMode}
                className={`px-2.5 py-1.5 text-xs font-semibold ${renderMode ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                ● Modo render
              </button>
            </div>
            <button onClick={openDrawer} className="btn border-sky-700" aria-expanded={drawer}>
              ⚙ Parámetros y calibración
            </button>
            <SimulationControls c={c} />
          </div>
        </div>
        {s.unackedAlarms > 0 && latestAlarm && (
          <div className={`border-t px-4 py-1.5 text-xs ${ALARM_META[latestAlarm.kind].cls} alarm-flash`}>
            <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-3">
              <span>
                <b>ALARMA · {ALARM_META[latestAlarm.kind].title}</b> ({fmtClock(latestAlarm.t)}): {latestAlarm.message}
              </span>
              <button onClick={c.ackAlarms} className="btn shrink-0 py-0.5 text-xs">
                Reconocer ({s.unackedAlarms})
              </button>
            </div>
          </div>
        )}
        {s.shiftEnded && (
          <div className="border-t border-sky-700 bg-sky-950/60 px-4 py-1.5 text-center text-xs text-sky-200">
            Jornada finalizada: {s.good} piezas OK · {s.scrap} scrap · meta {p.dailyGoal} {s.good >= p.dailyGoal ? '✔ cumplida' : '✖ no cumplida'}. Reinicie para una nueva corrida.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1800px] space-y-4 p-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-9">
          <Kpi label="Piezas OK" value={String(s.good)} sub={`meta a esta hora ${fmt(goalNow, 0)}`} tone={s.t < 300 ? 'default' : s.good >= goalNow ? 'ok' : 'bad'} />
          <Kpi label="Meta del día" value={`${fmt((s.good / p.dailyGoal) * 100, 0)} %`} sub={`${s.good} / ${p.dailyGoal} pz`} />
          <Kpi label="Scrap" value={String(s.scrap)} sub={`frío ${s.scrapBy.frio} · sobrec. ${s.scrapBy.sobrecalentado} · desm. ${s.scrapBy['desmoldeo-caliente']}`} tone={s.scrap ? 'bad' : 'default'} />
          <Kpi label="Tasa horaria real" value={`${fmt(m.rateAvg, 1)} pz/h`} sub={`necesaria ${fmt(needed, 1)} pz/h`} tone={m.rateAvg && m.rateAvg >= needed ? 'ok' : 'default'} />
          <Kpi label="Proyección del día" value={`${fmt(m.projectedDay, 0)} pz`} sub={`teórica ${fmt(balance.capacityPerDay, 0)} pz`} tone={m.projectedDay ? (m.projectedDay >= p.dailyGoal ? 'ok' : 'bad') : 'default'} />
          <Kpi
            label="Ciclo medido"
            value={m.avgCycle ? `${fmt(m.avgCycle)} s` : '—'}
            sub={`teórico ${fmt(balance.cycle)} s · takt ${fmt(balance.takt)} s`}
            testId="kpi-cycle"
          />
          <Kpi label="Ocupación operario" value={`${fmt(m.occupancy * 100, 0)} %`} sub={`espera ${fmt((1 - m.occupancy) * 100, 0)} %`} />
          <Kpi
            label="Glicerina en el agua"
            value={`${fmt(s.tank.glycerinMl / 1000, 2)} L`}
            sub={`${fmt(glycPct, 3)} % v/v · ${p.dragOutMl} ml/caño`}
          />
          <Kpi label="Agua del tanque" value={`${fmt(s.tank.temp)} °C`} sub={`última apertura ${s.lastDemold ? fmt(s.lastDemold.temp) + ' °C' : '—'}`} tone={s.lastDemold && s.lastDemold.temp > HDPE.demoldMax ? 'bad' : 'default'}
            testId="kpi-water"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 lg:row-span-2 2xl:row-span-1">
            <ControlPanel c={c} onOpenCalibration={openDrawer} />
          </aside>

          <div className="space-y-4">
            <Card
              title="Celda de manufactura"
              subtitle="Carrusel en batea de glicerina (vista frontal a escala) → prensa neumática con lavado interno → contenedor"
              right={
                <span className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                  Operario: <b className="text-sky-300">{TASK_LABEL[s.operator.task]}</b>
                </span>
              }
            >
              {renderMode ? <CctvView c={c} /> : <CellView sim={sim} />}
            </Card>
            <Card title="Lógica PLC · enclavamientos y diagnóstico" subtitle="Secuencia de la estación en L, señales de E/S virtuales y forzado manual">
              <PlcPanel c={c} />
            </Card>
            <Card title="Diagrama hombre-máquina" subtitle="Últimos 120 s de simulación">
              <ManMachineChart segments={sim.liveSegments()} now={s.t} />
            </Card>
          </div>

          <Card title="Sistema de alarmas" subtitle={`Scrap > ${HDPE.overheatAlarm} °C · reblandecimiento > ${HDPE.softeningWarn} °C con línea detenida > ${HDPE.stopWarnSeconds} s · retiro < ${HDPE.softMin} °C · apertura > ${HDPE.demoldMax} °C = scrap (aviso desde ${HDPE.demoldWarn} °C)`}>
            <AlarmPanel alarms={s.alarms} counts={s.alarmCounts} unacked={s.unackedAlarms} onAck={c.ackAlarms} />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Curva de temperatura del caño en la prensa" subtitle="Desde el cierre hasta la apertura. Franja celeste = inyección de agua.">
            <CoolingChart current={charts.curve} previous={charts.lastCurve} injectWindow={charts.injectWindow} demoldMax={HDPE.demoldMax} />
          </Card>
          <Card
            title="Calentamiento en el carrusel"
            subtitle={`Temperatura vs. residencia · τ sumergido ${fmt(bathTau(p.bathTau, p.wallThickness), 0)} s en glicerina a ${p.bathTemp} °C · τ al aire ${fmt(EMERGED_TAU, 0)} s`}
          >
            <HeatingChart tubes={charts.tubes} curve={trajectory.curve} spans={trajectory.spans} cycle={balance.cycle} bathTemp={p.bathTemp} target={p.targetTemp} />
          </Card>
          <Card title="Producción acumulada vs. meta" subtitle={`Meta ${p.dailyGoal} piezas en ${p.shiftHours} h`}>
            <ProductionChart history={charts.history} goal={p.dailyGoal} shiftHours={p.shiftHours} />
          </Card>
          <Card title="Tasa horaria real" subtitle="Piezas OK por hora">
            <RateChart history={charts.history} needed={needed} capacity={balance.capacityPerHour} />
          </Card>
          <Card title="Ocupación del operario vs. esperas" subtitle="Distribución acumulada del tiempo del operario y evolución de la ocupación">
            <div className="mb-2 flex h-6 overflow-hidden rounded bg-slate-950">
              {BREAKDOWN.map(({ k, c: color }) =>
                s.opTime[k] > 0 ? (
                  <div
                    key={k}
                    title={`${TASK_LABEL[k]}: ${fmt((s.opTime[k] / breakdownTotal) * 100, 1)} %`}
                    className="h-full border-r-2 border-slate-900"
                    style={{ width: `${(s.opTime[k] / breakdownTotal) * 100}%`, background: color }}
                  />
                ) : null,
              )}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-4">
              {BREAKDOWN.map(({ k, c: color }) => (
                <span key={k} className="flex items-center justify-between gap-1 text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
                    {TASK_LABEL[k]}
                  </span>
                  <span className="font-mono text-slate-200">{breakdownTotal ? fmt((s.opTime[k] / breakdownTotal) * 100, 0) : 0}%</span>
                </span>
              ))}
            </div>
            <OccupancyChart history={charts.history} />
          </Card>
          <Card title="Balance de línea (analítico, 1 operario)" subtitle="Valores teóricos sin variabilidad, con la temperatura inicial del agua">
            <LineBalancePanel b={balance} hyd={hyd} measuredCycle={m.avgCycle} interlock={p.tempInterlock} ambient={p.ambientTemp} target={p.targetTemp} bath={p.bathTemp} />
          </Card>
        </div>

        <footer className="pb-6 text-[11px] leading-relaxed text-slate-500">
          Modelo de parámetros concentrados: calentamiento y enfriamiento de primer orden T(t) = T∞ + (T₀ − T∞)·e^(−t/τ). Batea: la mitad inferior del carrusel
          va sumergida en glicerina (τ = {p.bathTau} s a 2,5 mm, escala con el espesor) y la superior al aire (τ = {EMERGED_TAU} s). El caño
          se retira en la primera posición emergida del lado que sube (sin arco aéreo: sólo los 2 s del giro) y el frío se carga en una
          estación separada; cada caño arrastra {p.dragOutMl} ml de glicerina al agua de lavado;
          τ de lavado interno calibrado en 4,5 s (e = 2,5 mm, 60 L/min) y escalado con e² y h^−0,35 (Dittus-Boelter). El calor extraído del caño
          (m·cp·ΔT) se acumula en el tanque; éste pierde calor al ambiente según el sistema de enfriamiento elegido. Valores orientativos para
          análisis de sensibilidad, no reemplazan ensayos en planta.
        </footer>
      </main>
      <CalibrationDrawer c={c} open={drawer} onClose={closeDrawer} />
    </div>
  )
}
