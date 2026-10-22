/** Utilidades de color para el sombreado del Modo Render. */

function parseColor(c: string): [number, number, number] | null {
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).replace(/./g, (x) => x + x) : c.slice(1)
    const n = parseInt(h, 16)
    return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = c.match(/\d+(\.\d+)?/g)
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : null
}

/** Aclara (k > 0, hacia blanco) u oscurece (k < 0, hacia negro) un color `rgb()` o `#rrggbb`. */
export function shade(color: string, k: number): string {
  const rgb = parseColor(color)
  if (!rgb) return color
  const target = k < 0 ? 0 : 255
  const f = Math.min(1, Math.abs(k))
  const [r, g, b] = rgb.map((c) => Math.round(c + (target - c) * f))
  return `rgb(${r}, ${g}, ${b})`
}
