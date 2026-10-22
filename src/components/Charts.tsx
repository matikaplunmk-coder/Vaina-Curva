import { memo, type ReactNode } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CurvePoint, HistoryPoint, Segment } from '../sim/engine'
import { HDPE, tempColor } from '../sim/physics'
import { STEP_LABEL, STEPS } from '../sim/sequence'
import { AXIS, fmt, fmtHM, SERIES, STATUS } from './format'
import { STEP_COLOR } from './labels'

export function Card({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

const tooltipStyle = {
  contentStyle: { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#cbd5e1' },
  itemStyle: { color: '#e2e8f0' },
}
const axisProps = {
  stroke: AXIS.stroke,
  tick: { fill: AXIS.tick, fontSize: 11 },
  tickLine: false,
}
const legendProps = { wrapperStyle: { fontSize: 11, color: '#cbd5e1' }, iconSize: 10 }

// ------------------------------------------------------------------ Enfriamiento

export const CoolingChart = memo(function CoolingChart({
  current,
  previous,
  injectWindow,
  demoldMax,
}: {
  current: CurvePoint[]
  previous: CurvePoint[]
  injectWindow: [number, number]
  demoldMax: number
}) {
  const water = previous.length ? previous : current
  const maxT = Math.max(12, ...[current, previous].map((c) => (c.length ? c[c.length - 1].t : 0)))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={AXIS.grid} vertical={false} />
        <XAxis
          type="number"
          dataKey="t"
          domain={[0, Math.ceil(maxT)]}
          {...axisProps}
          unit=" s"
          allowDuplicatedCategory={false}
        />
        <YAxis type="number" domain={[0, 140]} {...axisProps} unit="°" />
        <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v), 1)} °C`} labelFormatter={(l) => `t = ${fmt(Number(l), 1)} s`} />
        <Legend {...legendProps} />
        {injectWindow[1] > injectWindow[0] && (
          <ReferenceArea x1={injectWindow[0]} x2={injectWindow[1]} fill="#38bdf8" fillOpacity={0.07} />
        )}
        <ReferenceLine y={HDPE.demoldWarn} stroke={STATUS.warn} strokeDasharray="3 4" label={{ value: `aviso ${HDPE.demoldWarn} °C`, fill: '#fcd34d', fontSize: 10, position: 'insideBottomRight' }} />
        <ReferenceLine y={demoldMax} stroke={STATUS.crit} strokeDasharray="5 4" label={{ value: `scrap si abre > ${demoldMax} °C`, fill: '#fca5a5', fontSize: 10, position: 'insideTopRight' }} />
        <Line data={previous} dataKey="temp" name="Ciclo anterior" stroke={SERIES.blue} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        <Line data={current} dataKey="temp" name="Ciclo actual" stroke={SERIES.orange} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line data={water} dataKey="water" name="Agua (salida)" stroke={SERIES.aqua} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
})

// ------------------------------------------------------------------ Producción

export const ProductionChart = memo(function ProductionChart({ history, goal, shiftHours }: { history: HistoryPoint[]; goal: number; shiftHours: number }) {
  const maxH = Math.max(1, Math.ceil(history.length ? history[history.length - 1].h : 1))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={history} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={AXIS.grid} vertical={false} />
        <XAxis type="number" dataKey="h" domain={[0, Math.min(shiftHours, maxH)]} {...axisProps} tickFormatter={fmtHM} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => `t = ${fmtHM(Number(l))} h`} formatter={(v) => fmt(Number(v), 0)} />
        <Legend {...legendProps} />
        <ReferenceLine y={goal} stroke="#64748b" strokeDasharray="2 4" />
        <Line dataKey="good" name="Producción OK" stroke={SERIES.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="goal" name={`Meta (${goal}/día, lineal)`} stroke={SERIES.yellow} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
        <Line dataKey="scrap" name="Scrap" stroke={SERIES.violet} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
})

// ------------------------------------------------------------------ Tasa horaria

export const RateChart = memo(function RateChart({ history, needed, capacity }: { history: HistoryPoint[]; needed: number; capacity: number }) {
  const data = history.slice(1)
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={AXIS.grid} vertical={false} />
        <XAxis type="number" dataKey="h" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={fmtHM} />
        <YAxis {...axisProps} domain={[0, (max: number) => Math.ceil(Math.max(max, capacity, needed) * 1.15)]} />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => `t = ${fmtHM(Number(l))} h`} formatter={(v) => `${fmt(Number(v), 1)} pz/h`} />
        <Legend {...legendProps} />
        <ReferenceLine y={needed} stroke={SERIES.yellow} strokeDasharray="6 4" label={{ value: `necesaria ${fmt(needed, 1)}`, fill: '#fcd34d', fontSize: 10, position: 'insideBottomRight' }} />
        {Number.isFinite(capacity) && (
          <ReferenceLine y={capacity} stroke="#64748b" strokeDasharray="2 4" label={{ value: `teórica ${fmt(capacity, 0)}`, fill: '#94a3b8', fontSize: 10, position: 'insideTopRight' }} />
        )}
        <Line dataKey="rate" name="Tasa móvil (10 min)" stroke={SERIES.blue} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="rateAvg" name="Promedio acumulado" stroke={SERIES.orange} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
})

export const OccupancyChart = memo(function OccupancyChart({ history }: { history: HistoryPoint[] }) {
  const data = history.slice(1)
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={AXIS.grid} vertical={false} />
        <XAxis type="number" dataKey="h" domain={['dataMin', 'dataMax']} {...axisProps} tickFormatter={fmtHM} />
        <YAxis {...axisProps} domain={[0, 100]} unit="%" />
        <Tooltip {...tooltipStyle} labelFormatter={(l) => `t = ${fmtHM(Number(l))} h`} formatter={(v) => `${fmt(Number(v), 1)} %`} />
        <Line dataKey="occupancy" name="Ocupación operario (10 min)" stroke={SERIES.aqua} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
})

// ------------------------------------------------------------------ Calentamiento

export const HeatingChart = memo(function HeatingChart({
  tubes,
  curve,
  spans,
  cycle,
  bathTemp,
  target,
}: {
  tubes: { residence: number; temp: number; id: number }[]
  curve: { t: number; temp: number }[]
  spans: [number, number][]
  cycle: number
  bathTemp: number
  target: number
}) {
  const maxRes = Math.max(curve.length ? curve[curve.length - 1].t : 60, ...tubes.map((t) => t.residence)) * 1.03
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <CartesianGrid stroke={AXIS.grid} vertical={false} />
        <XAxis type="number" dataKey="t" domain={[0, Math.ceil(maxRes / 60) * 60]} {...axisProps} unit=" s" />
        <YAxis type="number" domain={[0, Math.max(150, Math.ceil((bathTemp + 10) / 10) * 10)]} {...axisProps} unit="°" />
        <Tooltip {...tooltipStyle} formatter={(v) => `${fmt(Number(v), 1)} °C`} labelFormatter={(l) => `residencia ${fmt(Number(l), 0)} s`} />
        <Legend {...legendProps} />
        {spans.map(([x1, x2], i) => (
          <ReferenceArea
            key={i}
            x1={x1}
            x2={x2}
            fill="#f59e0b"
            fillOpacity={0.08}
            label={i === 0 ? { value: 'sumergido en glicerina', fill: '#fcd34d', fontSize: 10, position: 'insideBottom' } : undefined}
          />
        ))}
        <ReferenceLine y={target} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `objetivo ${target} °C`, fill: '#cbd5e1', fontSize: 10, position: 'insideTopRight' }} />
        <ReferenceLine y={HDPE.overheatAlarm} stroke={STATUS.crit} strokeDasharray="5 4" label={{ value: `alarma ${HDPE.overheatAlarm} °C`, fill: '#fca5a5', fontSize: 10, position: 'insideBottomLeft' }} />
        <ReferenceLine y={HDPE.softMin} stroke={STATUS.warn} strokeDasharray="5 4" label={{ value: `mín. ${HDPE.softMin} °C`, fill: '#fcd34d', fontSize: 10, position: 'insideTopLeft' }} />
        <Line
          data={curve}
          dataKey="temp"
          name={Number.isFinite(cycle) ? `Trayectoria teórica (${fmt(cycle, 1)} s/posición)` : 'Trayectoria teórica'}
          stroke={SERIES.blue}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Scatter
          data={tubes.map((t) => ({ t: t.residence, temp: t.temp, id: t.id }))}
          dataKey="temp"
          name="Caños en carrusel"
          fill={SERIES.orange}
          isAnimationActive={false}
          shape={(props: { cx?: number; cy?: number; payload?: { temp: number } }) => (
            <circle cx={props.cx} cy={props.cy} r={5} fill={tempColor(props.payload?.temp ?? 0)} stroke="#0f172a" strokeWidth={2} />
          )}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
})

// ------------------------------------------------------------------ Diagrama hombre-máquina

const SEG_COLORS: Record<string, string> = {
  UNLOAD: '#3987e5',
  PICK: '#d95926',
  TRANSFER: '#c98500',
  LOAD: '#199e70',
  WAIT_PRESS: '#334155',
  WAIT_TEMP: '#7f1d1d',
  WAIT_INDEX: '#475569',
  PAUSED: '#3f3f46',
  // prensa: un color por paso de la secuencia
  ...Object.fromEntries(STEPS.map((st) => [STEP_LABEL[st.n], STEP_COLOR[st.n]])),
  Manual: '#a21caf',
  Detenido: '#1e293b',
  Indexando: '#e87ba4',
}

const OP_LEGEND: [string, string][] = [
  ['UNLOAD', 'Descarga'],
  ['PICK', 'Toma'],
  ['TRANSFER', 'Carga en matriz'],
  ['LOAD', 'Carga frío'],
  ['WAIT_PRESS', 'Esp. prensa'],
  ['WAIT_TEMP', 'Esp. temperatura'],
  ['PAUSED', 'Pausa'],
]

export function ManMachineChart({ segments, now, windowSec = 120 }: { segments: Segment[]; now: number; windowSec?: number }) {
  const W = 1000
  const rows: { res: Segment['res']; label: string }[] = [
    { res: 'op', label: 'Operario' },
    { res: 'press', label: 'Prensa' },
    { res: 'carousel', label: 'Carrusel' },
  ]
  const x0 = Math.max(0, now - windowSec)
  const LABEL_W = 80
  const sx = (t: number) => LABEL_W + ((t - x0) / windowSec) * (W - LABEL_W - 10)
  const ticks: number[] = []
  for (let t = Math.ceil(x0 / 10) * 10; t <= now; t += 10) ticks.push(t)
  return (
    <div>
      <svg viewBox={`0 0 ${W} 120`} className="h-auto w-full" role="img" aria-label="Diagrama hombre-máquina de los últimos 2 minutos">
        {rows.map((r, i) => (
          <g key={r.res} transform={`translate(0 ${i * 32 + 4})`}>
            <text x={0} y={17} className="fill-slate-300 text-[12px]">
              {r.label}
            </text>
            <rect x={LABEL_W} y={2} width={W - LABEL_W - 10} height={22} fill="#0b1220" rx={3} />
            {segments
              .filter((sg) => sg.res === r.res && sg.end > x0)
              .map((sg, k) => {
                const a = sx(Math.max(sg.start, x0))
                const b = sx(sg.end)
                if (b - a < 0.5) return null
                return (
                  <rect key={k} x={a} y={2} width={Math.max(0.5, b - a - 1)} height={22} rx={2} fill={SEG_COLORS[sg.label] ?? '#475569'}>
                    <title>
                      {sg.label} · {fmt(sg.end - sg.start, 1)} s
                    </title>
                  </rect>
                )
              })}
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={100} y2={104} stroke="#475569" />
            <text x={sx(t)} y={116} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {Math.round(t)} s
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        {OP_LEGEND.map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEG_COLORS[k] }} />
            {l}
          </span>
        ))}
        <span className="text-slate-600">|</span>
        {STEPS.filter((st) => st.n <= 9).map((st) => (
          <span key={st.n} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STEP_COLOR[st.n] }} />
            {st.n}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEG_COLORS.Indexando }} />
          Giro carrusel
        </span>
      </div>
    </div>
  )
}
