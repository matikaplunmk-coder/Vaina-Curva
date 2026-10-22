/** Marca de tiempo estilo cámara de planta: YYYY-MM-DD HH:MM:SS.mmm (hora local). */
export function formatTimecode(epochMs: number): string {
  const d = new Date(epochMs)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Segundos → "mm:ss" (duración de un clip). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const CAM_LABEL = 'CAM 01 - PRENSA L & CARRUSEL'
