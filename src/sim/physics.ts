/**
 * Modelos térmicos e hidráulicos simplificados (parámetros concentrados).
 *
 * Todos los calentamientos / enfriamientos siguen una ley de primer orden:
 *   T(t) = T∞ + (T0 − T∞)·e^(−t/τ)
 * con constantes de tiempo τ calibradas para un caño de PEAD Ø40 mm × e (2–3 mm) × 860 mm.
 */

export const PIPE = { od: 40, length: 860 } // mm

export const HDPE = {
  rho: 950, // kg/m³
  cp: 2300, // J/kg·K (sólido, valor medio 25–125 °C)
  softMin: 115, // por debajo no se deja conformar
  ready: 125, // temperatura objetivo de conformado
  overheatAlarm: 135, // scrap crítico en carrusel
  softeningWarn: 128, // advertencia de reblandecimiento superficial con la línea detenida
  stopWarnSeconds: 90, // s sin indexar que se consideran detención de línea
  degrade: 140, // sobrecalentado / degradado
  demoldMax: 80, // apertura de matriz: por encima es scrap (sin rigidez para manipular, se deforma)
  demoldWarn: 70, // apertura entre 70 y 80 °C: pieza OK con advertencia preventiva
}

export const WATER = { rho: 998, cp: 4186, nu: 1.0e-6, k: 0.6, pr: 7 }

export const CAROUSEL_INDEX_TIME = 2.0 // s, giro de una posición
export const SENSOR_STOP_TEMP = 48 // °C, corte de inyección en modo sensor
export const SENSOR_MAX_INJECT = 25 // s, tope de seguridad en modo sensor

/** Masa de un caño [kg]. */
export function tubeMass(wallMm: number): number {
  const od = PIPE.od / 1000
  const e = wallMm / 1000
  const area = Math.PI * (od - e) * e
  return area * (PIPE.length / 1000) * HDPE.rho
}

/** Volumen interior del caño (lo que llena el agua de templado) [L]. */
export function tubeInnerVolumeL(wallMm: number): number {
  const di = innerDiameter(wallMm) / 1000
  return ((Math.PI * di * di) / 4) * (PIPE.length / 1000) * 1000
}

/** Diámetro interior [mm]. */
export function innerDiameter(wallMm: number): number {
  return PIPE.od - 2 * wallMm
}

// ------------------------------------------------------------------ Batea de glicerina

/**
 * Batea semicilíndrica de calentamiento: R 323 mm × L 900 mm, llena de glicerina hasta el nivel
 * del eje del carrusel (media circunferencia sumergida). Los caños van montados en la periferia,
 * paralelos al eje (Ø40 mm), sobre un radio de montaje de 270 mm.
 */
export const BATH = {
  radius: 323, // mm
  length: 900, // mm
  mountRadius: 270, // mm, centro de los caños
  shaftDiameter: 40, // mm, eje central
  volumeL: 120, // L de glicerina
  rho: 1.26, // kg/L
  cp: 2430, // J/kg·K
  heaterMax: 6000, // W, resistencias de la batea
  heaterGain: 20000, // W/K, control proporcional sobre la consigna
  ua: 10, // W/K, pérdidas de la batea al ambiente
}

/**
 * τ con el caño sumergido en glicerina (convección líquida). El parámetro se da para 2,5 mm
 * y escala linealmente con el espesor (masa térmica por unidad de superficie).
 */
export function bathTau(tauRef: number, wallMm: number): number {
  return tauRef * (wallMm / 2.5)
}

/**
 * τ en la mitad superior emergida: convección natural con aire, amortiguada por la película de
 * glicerina caliente y la pluma de aire sobre la batea. Calibrado para perder ~1–2 °C durante
 * el tramo al aire antes de la estación de extracción.
 */
export const EMERGED_TAU = 5000

/**
 * Fracción sumergida de un caño según su ángulo en el carrusel (0° = estación superior,
 * sentido horario). El líquido llega al nivel del eje: por debajo, sumergido; en ±90° el caño
 * queda a medias en la superficie.
 */
export function submergedFraction(angleDeg: number, levelDrop = 0): number {
  const depth = -BATH.mountRadius * Math.cos((angleDeg * Math.PI) / 180) - levelDrop // mm bajo el nivel
  return Math.min(1, Math.max(0, depth / PIPE.od + 0.5))
}

/** Vainas en la glicerina a la vez cuando el nivel llega justo al eje (media circunferencia). */
export const BATH_PODS_AT_AXIS = 8

/** Vainas equivalentes en la glicerina (Σ fracción sumergida de las `n` posiciones) con el nivel `drop` mm bajo el eje. */
function podsAtLevel(n: number, drop: number): number {
  let sum = 0
  for (let k = 0; k < n; k++) sum += submergedFraction((k * 360) / n, drop)
  return sum
}

const dropCache = new Map<string, number>()

/**
 * Cuánto queda el nivel de la glicerina por debajo del eje del carrusel [mm] para que entren
 * `pods` vainas a la vez en la batea de `n` posiciones. Las resistencias ocupan el fondo, así que
 * el carrusel no queda al ras. `pods` cuenta vainas equivalentes (Σ fracción sumergida: una vaina
 * a medias en la superficie cuenta 0,5); con el nivel en el eje entran 8 de 16. Se busca por
 * bisección porque las posiciones son discretas y el caño tiene 40 mm de diámetro. El nivel nunca
 * sube del eje: pedir 8 o más da 0.
 */
export function levelDropFor(pods: number, n: number): number {
  const key = `${pods}|${n}`
  const hit = dropCache.get(key)
  if (hit !== undefined) return hit
  let drop = 0
  if (pods < podsAtLevel(n, 0) - 1e-6) {
    let lo = 0
    let hi = BATH.mountRadius
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (podsAtLevel(n, mid) > pods) lo = mid
      else hi = mid
    }
    // +0,005 mm: si el nivel cae justo sobre el borde de una vaina (p. ej. 7,0), ésta queda seca de verdad
    // y no "mojada en 1e-17", lo que dejaría una posición casi seca como parada previa al retiro.
    drop = (lo + hi) / 2 + 0.005
  }
  dropCache.set(key, drop)
  return drop
}

/** Paso térmico de un caño en el carrusel con fracción sumergida f. */
export function carouselStep(
  T: number,
  f: number,
  dt: number,
  bathT: number,
  ambient: number,
  tauLiquid: number,
): number {
  const gL = f / tauLiquid
  const gA = (1 - f) / EMERGED_TAU
  const g = gL + gA
  const Tinf = (gL * bathT + gA * ambient) / g
  return relax(T, Tinf, dt, 1 / g)
}

/** τ de enfriamiento al aire libre (traslado, caño esperando). */
export const AIR_TAU = 360
/** τ del contacto con la matriz cerrada sin agua (conducción a la matriz de aluminio). */
export const DIE_TAU = 45

export interface Hydraulics {
  diMm: number
  velocity: number // m/s
  reynolds: number
  hWater: number // W/m²K (Dittus-Boelter)
  hydraulicPower: number // W
  pumpEfficiency: number // sobre 1 HP = 746 W
  shotVolume: (injectTime: number) => number // L
}

const PUMP_PRESSURE = 2e5 // Pa (~2 bar)

export function hydraulics(flowLpm: number, wallMm: number): Hydraulics {
  const di = innerDiameter(wallMm) / 1000
  const q = flowLpm / 60000 // m³/s
  const area = (Math.PI * di * di) / 4
  const velocity = q / area
  const reynolds = (velocity * di) / WATER.nu
  const nu = 0.023 * Math.pow(reynolds, 0.8) * Math.pow(WATER.pr, 0.4)
  const hWater = (nu * WATER.k) / di
  const hydraulicPower = PUMP_PRESSURE * q
  return {
    diMm: di * 1000,
    velocity,
    reynolds,
    hWater,
    hydraulicPower,
    pumpEfficiency: hydraulicPower / 746,
    shotVolume: (t) => (flowLpm / 60) * t,
  }
}

const H_NOMINAL = hydraulics(60, 2.5).hWater

/**
 * τ de enfriamiento interno por agua. Calibrado: 4,5 s con e = 2,5 mm y 60 L/min.
 * Escala con e² (conducción a través de la pared) y con h^−0,35 (la resistencia
 * dominante es la pared, así que el caudal influye poco).
 */
export function coolingTau(wallMm: number, flowLpm: number): number {
  const h = hydraulics(flowLpm, wallMm).hWater
  return 4.5 * Math.pow(wallMm / 2.5, 2) * Math.pow(H_NOMINAL / h, 0.35)
}

/** Paso exacto de un sistema de primer orden. */
export function relax(T: number, Tinf: number, dt: number, tau: number): number {
  return Tinf + (T - Tinf) * Math.exp(-dt / tau)
}

/** Temperatura tras un tiempo t. */
export function firstOrder(T0: number, Tinf: number, t: number, tau: number): number {
  return Tinf + (T0 - Tinf) * Math.exp(-t / tau)
}

/** Tiempo para llegar a Ttarget (Infinity si no se alcanza). */
export function timeToReach(T0: number, Tinf: number, Ttarget: number, tau: number): number {
  const num = T0 - Tinf
  const den = Ttarget - Tinf
  if (den === 0 || num / den <= 0) return Infinity
  const t = tau * Math.log(num / den)
  return t < 0 ? 0 : t
}

/** Coeficiente UA [W/K] del tanque hacia el ambiente según el sistema de enfriamiento. */
export const TANK_UA = { none: 15, radiator: 150, chiller: 15 }
export const CHILLER_CAPACITY = 3000 // W
export const CHILLER_GAIN = 800 // W/K sobre el setpoint

/** Escala de color de los caños según temperatura. */
const COLOR_STOPS: [number, [number, number, number]][] = [
  [20, [37, 99, 235]], // azul
  [60, [56, 189, 248]], // celeste
  [95, [250, 204, 21]], // amarillo
  [115, [251, 146, 60]], // naranja
  [125, [249, 115, 22]], // naranja intenso — listo
  [135, [220, 38, 38]], // rojo
  [140, [127, 29, 29]], // bordó
  [155, [28, 10, 10]], // casi negro
]

export function tempColor(T: number): string {
  if (T <= COLOR_STOPS[0][0]) return rgb(COLOR_STOPS[0][1])
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [t1, c1] = COLOR_STOPS[i]
    if (T <= t1) {
      const [t0, c0] = COLOR_STOPS[i - 1]
      const f = (T - t0) / (t1 - t0)
      return rgb([c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f])
    }
  }
  return rgb(COLOR_STOPS[COLOR_STOPS.length - 1][1])
}

export type DemoldClass = 'ok' | 'warn' | 'scrap'

/** Criterio de calidad al abrir la matriz: ≤ 70 °C OK · 70–80 °C OK con advertencia · > 80 °C scrap. */
export function classifyDemold(temp: number): DemoldClass {
  if (temp > HDPE.demoldMax) return 'scrap'
  if (temp >= HDPE.demoldWarn) return 'warn'
  return 'ok'
}

/** Color del agua del tanque (15 °C azul → 50 °C rojo). */
export function waterColor(T: number): string {
  const f = Math.min(1, Math.max(0, (T - 15) / 35))
  return rgb([30 + f * 190, 120 - f * 70, 230 - f * 180])
}

function rgb(c: [number, number, number] | number[]): string {
  return `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`
}

export const TEMP_LEGEND = COLOR_STOPS.map(([t]) => t)
