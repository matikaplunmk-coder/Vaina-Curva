import { DEFAULT_PARAMS, sanitizeParams, type SimParams } from '../sim/params'

/** Clave de localStorage (v2: parámetros con la secuencia de 10 pasos). */
export const STORAGE_KEY = 'simulador-conduit.params.v2'
const FORMAT = 'simulador-conduit/params'

/** Lee la configuración guardada; si no hay o está corrupta, devuelve los valores nominales. */
export function loadStoredParams(): SimParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeParams(JSON.parse(raw)) : { ...DEFAULT_PARAMS }
  } catch {
    return { ...DEFAULT_PARAMS }
  }
}

export function saveStoredParams(p: SimParams) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // almacenamiento no disponible (modo privado, cuota): la app sigue funcionando sin persistencia
  }
}

export function exportParamsJson(p: SimParams): string {
  return JSON.stringify({ format: FORMAT, version: 2, exportedAt: new Date().toISOString(), params: p }, null, 2)
}

/** Acepta el formato exportado ({ format, params }) o un objeto de parámetros suelto. */
export function parseParamsJson(text: string): { ok: true; params: SimParams; ignored: string[] } | { ok: false; error: string } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'El JSON no contiene un objeto de parámetros.' }
  const obj = data as Record<string, unknown>
  const raw = obj.format === FORMAT && obj.params && typeof obj.params === 'object' ? (obj.params as Record<string, unknown>) : obj
  const known = Object.keys(DEFAULT_PARAMS)
  const recognized = Object.keys(raw).filter((k) => known.includes(k))
  if (recognized.length === 0) return { ok: false, error: 'No se reconoció ningún parámetro del simulador en el archivo.' }
  const ignored = Object.keys(raw).filter((k) => !known.includes(k))
  return { ok: true, params: sanitizeParams(raw), ignored }
}
