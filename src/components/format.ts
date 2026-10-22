export function fmtClock(t: number): string {
  const s = Math.floor(t)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export const fmt = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d })

/** Colores de series (paleta categórica validada, variante oscura). */
export const SERIES = {
  blue: '#3987e5',
  orange: '#d95926',
  aqua: '#199e70',
  yellow: '#c98500',
  violet: '#9085e9',
}

export const STATUS = {
  ok: '#22c55e',
  warn: '#f59e0b',
  crit: '#ef4444',
}

export const AXIS = { stroke: '#475569', tick: '#94a3b8', grid: '#1e293b' }

/** Horas decimales → "h:mm". */
export function fmtHM(h: number): string {
  const total = Math.round(h * 60)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Milisegundos sin decimales, con separador de miles. */
export const fmtMs = (v: number) => v.toLocaleString('es-AR', { maximumFractionDigits: 0 })
