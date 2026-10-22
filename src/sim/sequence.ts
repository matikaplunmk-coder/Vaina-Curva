/**
 * Estación de conformado en "L" vertical: secuencia de 10 pasos, actuadores neumáticos,
 * señales de E/S del PLC y enclavamientos de seguridad. Lógica pura (sin estado global).
 */
import type { SimParams } from './params'

export type PressStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface StepInfo {
  n: PressStep
  label: string
  short: string
}

export const STEPS: StepInfo[] = [
  { n: 1, label: 'Cierre de matriz y curvado 90° (+ asentamiento)', short: 'Cierre/curvado' },
  { n: 2, label: 'Bloqueo de mordaza de fricción Ø40', short: 'Mordaza' },
  { n: 3, label: 'Avance y aproximación del mandril abocardador', short: 'Avance mandril' },
  { n: 4, label: 'Asiento final del cono y sellado estanco', short: 'Asiento cono' },
  { n: 5, label: 'Inyección de agua de templado: llenado y rebalse libre', short: 'Templado' },
  { n: 6, label: 'Corte de agua, soplado de purga y drenaje', short: 'Purga' },
  { n: 7, label: 'Retroceso del mandril con pulso de desmoldeo', short: 'Retroceso' },
  { n: 8, label: 'Liberación de la mordaza (siempre después del paso 7)', short: 'Libera mordaza' },
  { n: 9, label: 'Apertura de la matriz curva', short: 'Apertura' },
  { n: 10, label: 'Extracción de la pieza y carga del nuevo caño (operario)', short: 'Operario' },
]

export const STEP_LABEL: Record<PressStep, string> = Object.fromEntries(STEPS.map((s) => [s.n, `${s.n} · ${s.short}`])) as Record<
  PressStep,
  string
>

/** Posición relativa del mandril al final del paso 3 (aproximación); el resto es el asiento del paso 4. */
export const MANDREL_APPROACH = 0.85
/** Pulso de aire de desmoldeo al comenzar el retroceso del mandril [s]. */
export const DEMOLD_PULSE = 0.15
/** Reparto del paso 10 entre las tareas del operario. */
export const OPERATOR_SPLIT = { unload: 0.3, pick: 0.3, transfer: 0.4 }

/** Duración de cada paso [s], índice 1..10 (el 5 es el mínimo si la inyección es por sensor). */
export function stepDurations(p: SimParams): Record<PressStep, number> {
  return {
    1: (p.seqCloseMs + p.seqSettleMs) / 1000,
    2: p.seqClampMs / 1000,
    3: p.seqMandrelMs / 1000,
    4: p.seqSeatMs / 1000,
    5: p.seqWaterMs / 1000,
    6: p.seqPurgeMs / 1000,
    7: p.seqRetractMs / 1000,
    8: p.seqReleaseMs / 1000,
    9: p.seqOpenMs / 1000,
    10: p.seqOperatorMs / 1000,
  }
}

/** Tiempo de máquina: pasos 1 a 9 [s]. */
export function machineTime(p: SimParams, waterS = p.seqWaterMs / 1000): number {
  const d = stepDurations(p)
  return d[1] + d[2] + d[3] + d[4] + waterS + d[6] + d[7] + d[8] + d[9]
}

// ------------------------------------------------------------------ Actuadores y E/S

export interface Actuators {
  /** Matriz curva: 0 abierta, 1 cerrada (el curvado acompaña al cierre) */
  die: number
  /** Mordaza de fricción: 0 abierta, 1 trabada */
  clamp: number
  /** Mandril abocardador: 0 atrás, 1 cono asentado */
  mandrel: number
}

export type OutputId = 'Y1' | 'Y2' | 'Y3' | 'Y4' | 'Y5'
export type InputId = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6'
export type Outputs = Record<OutputId, boolean>
export type Inputs = Record<InputId, boolean>

export const OUTPUT_LABEL: Record<OutputId, string> = {
  Y1: 'Cilindro matriz',
  Y2: 'Cilindro mordaza',
  Y3: 'Cilindro mandril',
  Y4: 'Bomba de agua',
  Y5: 'Electroválvula aire',
}

export const INPUT_LABEL: Record<InputId, string> = {
  B1: 'Matriz cerrada',
  B2: 'Mordaza trabada',
  B3: 'Cono asentado',
  B4: 'Cono atrás',
  B5: 'Mordaza abierta',
  B6: 'Matriz abierta',
}

export const HOME_ACTUATORS: Actuators = { die: 0, clamp: 0, mandrel: 0 }
export const ALL_OFF: Outputs = { Y1: false, Y2: false, Y3: false, Y4: false, Y5: false }

const EPS = 1e-6

/** Finales de carrera (sensores magnéticos de los cilindros). */
export function readInputs(a: Actuators): Inputs {
  return {
    B1: a.die >= 1 - EPS,
    B2: a.clamp >= 1 - EPS,
    B3: a.mandrel >= 1 - EPS,
    B4: a.mandrel <= EPS,
    B5: a.clamp <= EPS,
    B6: a.die <= EPS,
  }
}

/** Mueve los cilindros hacia la posición que ordenan las salidas, a la velocidad de cada paso. */
export function moveActuators(a: Actuators, y: Outputs, p: SimParams, dt: number): Actuators {
  const d = stepDurations(p)
  const toward = (pos: number, target: number, rateUp: number, rateDown: number) =>
    target > pos ? Math.min(target, pos + rateUp * dt) : Math.max(target, pos - rateDown * dt)
  const mandrelRate = a.mandrel < MANDREL_APPROACH - EPS ? MANDREL_APPROACH / d[3] : (1 - MANDREL_APPROACH) / d[4]
  let mandrel = a.mandrel
  if (y.Y3) {
    // dos velocidades: aproximación rápida y asiento lento del cono
    mandrel = Math.min(1, a.mandrel + mandrelRate * dt)
    if (a.mandrel < MANDREL_APPROACH - EPS) mandrel = Math.min(mandrel, MANDREL_APPROACH)
  } else {
    mandrel = Math.max(0, a.mandrel - dt / d[7])
  }
  return {
    die: toward(a.die, y.Y1 ? 1 : 0, 1000 / p.seqCloseMs, 1 / d[9]),
    clamp: toward(a.clamp, y.Y2 ? 1 : 0, 1 / d[2], 1 / d[8]),
    mandrel,
  }
}

export interface InterlockResult {
  ok: boolean
  reason?: string
}

/**
 * Enclavamientos de seguridad del PLC. Se evalúan tanto para la secuencia automática como para
 * los forzados manuales: ningún cambio de salida que viole estas reglas llega a los actuadores.
 */
export function checkOutput(id: OutputId, value: boolean, a: Actuators, y: Outputs): InterlockResult {
  const b = readInputs(a)
  if (y[id] === value) return { ok: true }
  switch (id) {
    case 'Y4':
      if (value && !b.B3) return { ok: false, reason: 'Bomba de agua bloqueada: el cono no está asentado (B3).' }
      if (value && !b.B2) return { ok: false, reason: 'Bomba de agua bloqueada: la mordaza no está trabada (B2).' }
      if (value && y.Y5) return { ok: false, reason: 'Bomba de agua bloqueada: soplado de aire activo (Y5).' }
      return { ok: true }
    case 'Y2':
      if (!value && !b.B4) return { ok: false, reason: 'No se puede abrir la mordaza con el cono adentro (falta B4 cono atrás).' }
      if (!value && y.Y3) return { ok: false, reason: 'No se puede abrir la mordaza con el mandril ordenado adelante (Y3).' }
      return { ok: true }
    case 'Y3':
      if (value && !(b.B1 && b.B2)) return { ok: false, reason: 'El mandril sólo avanza con matriz cerrada (B1) y mordaza trabada (B2).' }
      if (!value && y.Y4) return { ok: false, reason: 'No se puede retroceder el mandril con la bomba de agua en marcha (Y4).' }
      return { ok: true }
    case 'Y1':
      if (!value && !(b.B4 && b.B5)) return { ok: false, reason: 'La matriz sólo abre con el cono atrás (B4) y la mordaza abierta (B5).' }
      if (value && !b.B4) return { ok: false, reason: 'La matriz sólo cierra con el cono atrás (B4).' }
      return { ok: true }
    case 'Y5':
      if (value && y.Y4) return { ok: false, reason: 'Soplado bloqueado: la bomba de agua está en marcha (Y4).' }
      return { ok: true }
  }
}

// ------------------------------------------------------------------ Mordaza

export const CLAMP = {
  /** Coeficiente de rozamiento mordaza–PEAD */
  mu: 0.35,
  /** Caras de contacto (mordaza fija + móvil) */
  faces: 2,
  /** Diámetro del cilindro del mandril (misma línea de aire) [mm] */
  mandrelBoreMm: 32,
  /** Presión de la bomba sobre la sección interior [bar] */
  waterBar: 2,
}

export interface ClampEstimate {
  force: number // N
  friction: number // N de retención
  mandrelPush: number // N
  waterPush: number // N
  margin: number // retención / empuje
}

/** Fuerza de la mordaza y margen de retención frente al empuje del mandril + presión de agua. */
export function clampEstimate(pressureBar: number, boreMm: number, innerDiameterMm: number): ClampEstimate {
  const area = (dMm: number) => (Math.PI * (dMm / 1000) ** 2) / 4
  const force = pressureBar * 1e5 * area(boreMm)
  const friction = CLAMP.mu * CLAMP.faces * force
  const mandrelPush = pressureBar * 1e5 * area(CLAMP.mandrelBoreMm)
  const waterPush = CLAMP.waterBar * 1e5 * area(innerDiameterMm)
  return { force, friction, mandrelPush, waterPush, margin: friction / (mandrelPush + waterPush) }
}
