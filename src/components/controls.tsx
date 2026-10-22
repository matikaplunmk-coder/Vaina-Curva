import type { ReactNode } from 'react'
import { PARAM_RANGES, type SimParams } from '../sim/params'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
  hint?: ReactNode
  /** Formato del valor mostrado (por defecto hasta 2 decimales) */
  format?: (v: number) => string
}

export function Slider({ label, value, min, max, step, unit, onChange, hint, format }: SliderProps) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="shrink-0 font-mono font-semibold text-sky-300">
          {format ? format(value) : value.toLocaleString('es-AR', { maximumFractionDigits: 2 })} {unit}
        </span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-sky-500"
      />
      {hint && <p className="text-[11px] leading-tight text-slate-500">{hint}</p>}
    </label>
  )
}

type NumericKey = keyof typeof PARAM_RANGES

/** Slider ligado a un parámetro: toma el rango de PARAM_RANGES. */
export function ParamSlider({
  k,
  params,
  set,
  label,
  unit,
  hint,
  format,
  max,
}: {
  k: NumericKey
  params: SimParams
  set: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void
  label: string
  unit: string
  hint?: ReactNode
  format?: (v: number) => string
  max?: number
}) {
  const r = PARAM_RANGES[k]
  return (
    <Slider
      label={label}
      value={params[k]}
      min={r.min}
      max={max ?? r.max}
      step={r.step}
      unit={unit}
      hint={hint}
      format={format}
      onChange={(v) => set(k, v as SimParams[typeof k])}
    />
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-sky-500" />
      <span>
        <span className="text-slate-300">{label}</span>
        {hint && <span className="block text-[11px] leading-tight text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="block text-xs">
      <span className="text-slate-300">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}
