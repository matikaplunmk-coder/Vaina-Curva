export type SpeedMode = 0.25 | 0.5 | 1 | 2 | 5 | 10 | 30 | 60 | 'step'
export type TankCooling = 'none' | 'radiator' | 'chiller'
export type CoolingMode = 'timed' | 'sensor'
/** Estación de carga del caño frío: cenit (12 en punto) o última posición descendente antes de entrar al baño */
export type LoadStation = 'top' | 'preEntry'

export interface SimParams {
  // --- A. Secuencia de conformado en L (10 pasos) [ms] ---
  /** Paso 1: cierre de matriz y curvado 90° */
  seqCloseMs: number
  /** Paso 1: asentamiento tras el curvado */
  seqSettleMs: number
  /** Paso 2: bloqueo de la mordaza de fricción Ø40 */
  seqClampMs: number
  /** Paso 3: avance y aproximación del mandril abocardador */
  seqMandrelMs: number
  /** Paso 4: asiento final del cono y sellado estanco */
  seqSeatMs: number
  /** Paso 5: inyección de agua de templado (llenado y rebalse libre) */
  seqWaterMs: number
  /** Paso 6: corte de agua, soplado de purga y drenaje (total) */
  seqPurgeMs: number
  /** Paso 6: parte del paso con la electroválvula de aire abierta */
  seqBlowMs: number
  /** Paso 7: retroceso del mandril con pulso de desmoldeo */
  seqRetractMs: number
  /** Paso 8: liberación de la mordaza (siempre después del paso 7) */
  seqReleaseMs: number
  /** Paso 9: apertura de la matriz curva */
  seqOpenMs: number
  /** Paso 10: extracción de la pieza y carga del caño caliente por el operario */
  seqOperatorMs: number
  /** Carga del caño frío en el carrusel (tarea interna, durante los pasos 1–9) */
  coldLoadMs: number

  // --- B. Termodinámica y fluidos ---
  /** Temperatura de consigna de la glicerina de la batea [°C] */
  bathTemp: number
  /** Temperatura objetivo del caño al retiro [°C] */
  targetTemp: number
  /** τ de calentamiento con el caño sumergido en glicerina [s] */
  bathTau: number
  /** Caudal de la bomba [L/min] */
  pumpFlow: number
  /** Temperatura inicial del agua del tanque [°C] */
  waterInitTemp: number
  /** Película de glicerina arrastrada por cada caño retirado [ml] */
  dragOutMl: number
  /** Volumen de agua en el tanque [L] */
  tankVolume: number
  tankCooling: TankCooling
  /** Temperatura ambiente [°C] */
  ambientTemp: number
  /** Espesor de pared del caño [mm] */
  wallThickness: number

  // --- C. Mecánica y geometría ---
  /** Posiciones del carrusel */
  slots: number
  /** Vainas que entran a la vez en la glicerina (las resistencias del fondo bajan el nivel del eje) */
  bathPods: number
  /** Estación de RETIRO: 0 = automática (primera posición emergida); k > 0 = forzada a k pasos del cenit */
  pickStationK: number
  /** Dónde carga el operario el caño frío */
  loadStation: LoadStation
  /** Presión de aire de la mordaza [bar] */
  clampPressureBar: number
  /** Diámetro del cilindro de la mordaza [mm] */
  clampBoreMm: number

  // --- Lógica y operación ---
  /** Enclavamiento: el carrusel no gira hasta que el caño que va a emerger alcanzó el objetivo */
  tempInterlock: boolean
  /** timed = inyección por tiempo; sensor = inyecta hasta T < 48 °C (mín. = tiempo fijado) */
  coolingMode: CoolingMode
  /** Variabilidad aleatoria de los tiempos manuales [%] */
  variability: number
  /** Horas productivas por día */
  shiftHours: number
  /** Meta diaria [piezas] */
  dailyGoal: number
  /** Arranque en frío: carrusel vacío. Si es false se arranca en régimen */
  coldStart: boolean
}

export const DEFAULT_PARAMS: SimParams = {
  seqCloseMs: 1400,
  seqSettleMs: 200,
  seqClampMs: 400,
  seqMandrelMs: 1000,
  seqSeatMs: 300,
  seqWaterMs: 7000,
  seqPurgeMs: 1000,
  seqBlowMs: 500,
  seqRetractMs: 800,
  seqReleaseMs: 300,
  seqOpenMs: 1500,
  seqOperatorMs: 9000,
  coldLoadMs: 4000,

  bathTemp: 132,
  targetTemp: 120,
  bathTau: 75,
  pumpFlow: 60,
  waterInitTemp: 22,
  dragOutMl: 3,
  tankVolume: 500,
  tankCooling: 'none',
  ambientTemp: 25,
  wallThickness: 2.5,

  slots: 16,
  bathPods: 7.5,
  pickStationK: 0,
  loadStation: 'top',
  clampPressureBar: 6,
  clampBoreMm: 50,

  tempInterlock: true,
  coolingMode: 'timed',
  variability: 10,
  shiftHours: 8,
  dailyGoal: 500,
  coldStart: false,
}

/** Parámetros que cambian la configuración física y obligan a reiniciar la simulación. */
export const RESET_KEYS: (keyof SimParams)[] = ['slots', 'bathPods', 'coldStart', 'loadStation', 'pickStationK']

type NumericKey = { [K in keyof SimParams]: SimParams[K] extends number ? K : never }[keyof SimParams]

/** Rango de cada parámetro numérico: lo usan los sliders y la validación de importación. */
export const PARAM_RANGES: Record<NumericKey, { min: number; max: number; step: number }> = {
  seqCloseMs: { min: 600, max: 3000, step: 50 },
  seqSettleMs: { min: 0, max: 800, step: 50 },
  seqClampMs: { min: 150, max: 1200, step: 50 },
  seqMandrelMs: { min: 400, max: 2500, step: 50 },
  seqSeatMs: { min: 100, max: 1000, step: 50 },
  seqWaterMs: { min: 3000, max: 12000, step: 250 },
  seqPurgeMs: { min: 400, max: 3000, step: 50 },
  seqBlowMs: { min: 100, max: 3000, step: 50 },
  seqRetractMs: { min: 300, max: 2000, step: 50 },
  seqReleaseMs: { min: 150, max: 1000, step: 50 },
  seqOpenMs: { min: 600, max: 3500, step: 50 },
  seqOperatorMs: { min: 4000, max: 15000, step: 250 },
  coldLoadMs: { min: 2000, max: 10000, step: 250 },

  bathTemp: { min: 120, max: 135, step: 0.5 },
  targetTemp: { min: 115, max: 125, step: 0.5 },
  bathTau: { min: 40, max: 100, step: 1 },
  pumpFlow: { min: 30, max: 80, step: 1 },
  waterInitTemp: { min: 15, max: 40, step: 0.5 },
  dragOutMl: { min: 0, max: 8, step: 0.5 },
  tankVolume: { min: 100, max: 1000, step: 50 },
  ambientTemp: { min: 10, max: 40, step: 1 },
  wallThickness: { min: 2, max: 3, step: 0.1 },

  slots: { min: 10, max: 18, step: 1 },
  bathPods: { min: 6, max: 8, step: 0.25 },
  pickStationK: { min: 0, max: 8, step: 1 },
  clampPressureBar: { min: 2, max: 8, step: 0.1 },
  clampBoreMm: { min: 20, max: 100, step: 1 },

  variability: { min: 0, max: 40, step: 5 },
  shiftHours: { min: 4, max: 24, step: 0.5 },
  dailyGoal: { min: 100, max: 2000, step: 50 },
}

const ENUMS: Partial<Record<keyof SimParams, readonly string[]>> = {
  tankCooling: ['none', 'radiator', 'chiller'],
  coolingMode: ['timed', 'sensor'],
  loadStation: ['top', 'preEntry'],
}

/**
 * Normaliza un objeto externo (localStorage o JSON importado): toma sólo las claves conocidas con el
 * tipo correcto, recorta los números a su rango y completa lo faltante con los valores nominales.
 */
export function sanitizeParams(raw: unknown): SimParams {
  const out: SimParams = { ...DEFAULT_PARAMS }
  if (!raw || typeof raw !== 'object') return out
  const src = raw as Record<string, unknown>
  const target = out as unknown as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_PARAMS) as (keyof SimParams)[]) {
    const v = src[key]
    const def = DEFAULT_PARAMS[key]
    if (typeof def === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      const r = PARAM_RANGES[key as NumericKey]
      target[key] = Math.min(r.max, Math.max(r.min, v))
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') target[key] = v
    } else if (typeof v === 'string' && ENUMS[key]?.includes(v)) {
      target[key] = v
    }
  }
  // El soplado es parte del paso 6: no puede superarlo.
  out.seqBlowMs = Math.min(out.seqBlowMs, out.seqPurgeMs)
  if (out.pickStationK >= out.slots) out.pickStationK = 0
  return out
}

export interface Preset {
  id: string
  label: string
  description: string
  params: Partial<SimParams>
}

/** Perfiles de un clic. Se aplican sobre los valores nominales. */
export const PRESETS: Preset[] = [
  {
    id: 'nominal',
    label: 'Nominal 23 s (8 h ≈ 1240 pz)',
    description: 'Secuencia nominal de 10 pasos: 13,9 s de máquina + 9 s de operario.',
    params: {},
  },
  {
    id: 'conservador',
    label: 'Conservador / Confiable (templado 9 s, ciclo 26 s)',
    description: 'Más templado y operario sin apuro: margen térmico al desmoldear.',
    params: { seqWaterMs: 9000, seqOperatorMs: 10100 },
  },
  {
    id: 'verano',
    label: 'Verano crítico (agua del tanque a 32 °C)',
    description: 'Tanque que arranca a 32 °C y ambiente de 35 °C: la apertura sube a ~50–65 °C y sigue dentro del límite de 80 °C.',
    params: { waterInitTemp: 32, ambientTemp: 35 },
  },
  {
    id: 'frio',
    label: 'Arranque en frío',
    description: 'Carrusel vacío al inicio: transitorio de llenado y calentamiento.',
    params: { coldStart: true },
  },
]

export function presetParams(id: string): SimParams {
  const preset = PRESETS.find((p) => p.id === id)
  return sanitizeParams({ ...DEFAULT_PARAMS, ...(preset?.params ?? {}) })
}
