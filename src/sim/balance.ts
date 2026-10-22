import type { LoadStation, SimParams } from './params'
import {
  CAROUSEL_INDEX_TIME,
  coolingTau,
  DIE_TAU,
  bathTau,
  carouselStep,
  firstOrder,
  AIR_TAU,
  submergedFraction,
  relax,
  SENSOR_MAX_INJECT,
  SENSOR_STOP_TEMP,
  timeToReach,
  innerDiameter,
  tubeInnerVolumeL,
  tubeMass,
  HDPE,
  WATER,
  TANK_UA,
  CHILLER_CAPACITY,
  CHILLER_GAIN,
  classifyDemold,
  type DemoldClass,
} from './physics'
import { clampEstimate, machineTime, OPERATOR_SPLIT, STEPS, stepDurations, type ClampEstimate, type PressStep } from './sequence'

export type Bottleneck = 'carrusel' | 'prensa' | 'operario'

export interface LineBalance {
  /** Paso 10 repartido entre las tareas del operario [s] */
  unload: number
  pick: number
  transfer: number
  /** Carga del caño frío en el carrusel (en paralelo con los pasos 1–9) [s] */
  load: number
  operatorWork: number
  /** Duración de cada paso de la secuencia [s] (el 5 ya considera la inyección por sensor) */
  steps: { n: PressStep; label: string; s: number }[]
  /** Paso 5 efectivo con agua en contacto (descuenta el llenado de la L) [s] */
  pressInject: number
  /** Tiempo de llenado de la L con el caudal de la bomba [s] */
  fillTime: number
  /** Tiempo de máquina: pasos 1–9 [s] */
  pressCycle: number
  /** Ciclo impuesto por operario + prensa: paso 10 + max(pasos 1–9, carga en frío) */
  cycleOperator: number
  /** Tiempo sumergido en glicerina que necesita el caño para llegar al objetivo en la estación */
  heatTime: number
  /** Posiciones equivalentes sumergidas (Σ fracción sumergida del recorrido) */
  submergedPositions: number
  /** Ciclo mínimo impuesto por el carrusel para que el caño llegue al objetivo a la estación */
  cycleCarousel: number
  /** Tiempo total de residencia en el carrusel con el ciclo resultante (carga → retiro) */
  residence: number
  /** Tiempo por tramo: al aire antes de entrar, en contacto con la glicerina, giro hasta el retiro */
  airBeforeBath: number
  inBath: number
  transitToPick: number
  /** Estaciones y ocupación del carrusel */
  stations: CarouselStations
  /** Temperatura al terminar la última posición sumergida y pérdida en el giro hasta el retiro */
  bathExitTemp: number
  airLoss: number
  /** Glicerina arrastrada al tanque de agua por día [L] */
  dragOutPerDay: number
  cycle: number
  bottleneck: Bottleneck
  capacityPerHour: number
  capacityPerDay: number
  takt: number
  meetsGoal: boolean
  occupancy: number
  /** Temperatura estimada del caño al abrir la matriz (comienzo del paso 9) */
  demoldTemp: number
  /** Temperatura estimada del caño al retirarlo del carrusel con ese ciclo */
  pickTemp: number
  /** Mordaza de fricción: fuerza y margen de retención */
  clamp: ClampEstimate
  /** Calor que cada pieza entrega al agua del tanque durante el templado [J] */
  heatPerPiece: number
}

/** Balance de línea analítico (determinístico, sin variabilidad) para 1 operario. */
export function computeBalance(p: SimParams, waterTemp = p.waterInitTemp): LineBalance {
  const d = stepDurations(p)
  const unload = d[10] * OPERATOR_SPLIT.unload
  const pick = d[10] * OPERATOR_SPLIT.pick
  const transfer = d[10] * OPERATOR_SPLIT.transfer
  const load = p.coldLoadMs / 1000
  const operatorWork = d[10] + load

  const stations = carouselStations(p.slots, p.loadStation, p.pickStationK)
  const positions = trajectoryPositions(p.slots, p.loadStation, p.pickStationK)
  const submergedPositions = positions.reduce((a, x) => a + x.f, 0)
  const bathPositions = positions.filter((x) => x.f > 0).length

  // Historia térmica del caño en la estación de conformado hasta el comienzo del paso 9 (apertura).
  let T = relax(p.targetTemp, p.ambientTemp, pick / 2 + transfer, AIR_TAU)
  T = relax(T, p.ambientTemp + 5, d[1] + d[2] + d[3] + d[4], DIE_TAU)
  const tauC = coolingTau(p.wallThickness, p.pumpFlow)
  const fillTime = tubeInnerVolumeL(p.wallThickness) / (p.pumpFlow / 60)
  let water = d[5]
  if (p.coolingMode === 'sensor') {
    const tSensor = timeToReach(T, waterTemp, SENSOR_STOP_TEMP, tauC) + fillTime / 2
    water = Math.max(d[5], Math.min(SENSOR_MAX_INJECT, tSensor))
  }
  const inject = Math.max(0, water - fillTime / 2)
  const beforeWater = T
  T = firstOrder(T, waterTemp, inject, tauC)
  const heatPerPiece = tubeMass(p.wallThickness) * HDPE.cp * (beforeWater - T)
  T = relax(T, p.ambientTemp + 5, d[6] + d[7] + d[8], DIE_TAU)

  const pressCycle = machineTime(p, water)
  // Mientras la máquina ejecuta los pasos 1–9, el operario carga el caño frío en el carrusel.
  const cycleOperator = d[10] + Math.max(pressCycle, load)
  const cycleCarousel = minCarouselCycle(p, CAROUSEL_INDEX_TIME + 1)
  const heatTime = cycleCarousel * submergedPositions

  const cycle = p.tempInterlock ? Math.max(cycleOperator, cycleCarousel) : cycleOperator
  let bottleneck: Bottleneck
  if (p.tempInterlock && cycleCarousel >= cycleOperator) bottleneck = 'carrusel'
  else if (pressCycle >= load) bottleneck = 'prensa'
  else bottleneck = 'operario'

  const capacityPerHour = 3600 / cycle
  const capacityPerDay = capacityPerHour * p.shiftHours
  const takt = (p.shiftHours * 3600) / p.dailyGoal
  const arrival = Number.isFinite(cycle) ? arrivalTemps(p, cycle) : { exit: NaN, station: NaN }

  return {
    unload,
    pick,
    transfer,
    load,
    operatorWork,
    steps: STEPS.map((st) => ({ n: st.n, label: st.short, s: st.n === 5 ? water : d[st.n] })),
    pressInject: inject,
    fillTime,
    pressCycle,
    cycleOperator,
    heatTime,
    cycleCarousel,
    cycle,
    bottleneck,
    capacityPerHour,
    capacityPerDay,
    takt,
    meetsGoal: capacityPerDay >= p.dailyGoal,
    occupancy: operatorWork / cycle,
    demoldTemp: T,
    pickTemp: arrival.station,
    submergedPositions,
    residence: cycle * positions.length + CAROUSEL_INDEX_TIME,
    airBeforeBath: cycle * (positions.length - bathPositions),
    inBath: cycle * bathPositions,
    transitToPick: CAROUSEL_INDEX_TIME,
    stations,
    bathExitTemp: arrival.exit,
    airLoss: arrival.exit - arrival.station,
    dragOutPerDay: (capacityPerDay * p.dragOutMl) / 1000,
    clamp: clampEstimate(p.clampPressureBar, p.clampBoreMm, innerDiameter(p.wallThickness)),
    heatPerPiece,
  }
}

export interface TankForecast {
  /** Temperatura del agua del tanque al final de la jornada [°C] */
  tankEnd: number
  /** Temperatura de apertura de la matriz al comienzo y al final de la jornada [°C] */
  demoldStart: number
  demoldEnd: number
  /** Clasificación de la peor apertura (la del final de la jornada) */
  worst: DemoldClass
}

/**
 * Pronóstico de la jornada: integra el tanque (calor de cada pieza al ritmo del ciclo, pérdidas al
 * ambiente y chiller si lo hay, como el motor) y estima la apertura de matriz con el agua resultante.
 */
export function tankForecast(p: SimParams): TankForecast {
  const C = p.tankVolume * WATER.cp * (WATER.rho / 1000)
  const dt = 600 // s
  let Tw = p.waterInitTemp
  const first = computeBalance(p, Tw)
  if (!Number.isFinite(first.cycle)) return { tankEnd: Tw, demoldStart: NaN, demoldEnd: NaN, worst: 'ok' }
  for (let t = 0; t < p.shiftHours * 3600; t += dt) {
    const b = computeBalance(p, Tw)
    let q = (b.heatPerPiece * b.capacityPerHour) / 3600 + TANK_UA[p.tankCooling] * (p.ambientTemp - Tw)
    if (p.tankCooling === 'chiller' && Tw > p.waterInitTemp) q -= Math.min(CHILLER_CAPACITY, CHILLER_GAIN * (Tw - p.waterInitTemp))
    Tw += (q * dt) / C
  }
  const demoldEnd = computeBalance(p, Tw).demoldTemp
  return { tankEnd: Tw, demoldStart: first.demoldTemp, demoldEnd, worst: classifyDemold(Math.max(first.demoldTemp, demoldEnd)) }
}

// ------------------------------------------------------------------ Estaciones y trayectoria

export interface CarouselStations {
  n: number
  step: number
  /** Posición (en pasos desde el cenit, sentido de avance horario) y ángulo de la estación de RETIRO */
  pickK: number
  pickAngle: number
  /** Posición automática (primera emergida) y si el RETIRO está forzado a otra */
  autoPickK: number
  forced: boolean
  /** Posición y ángulo de la estación de CARGA FRÍO */
  loadK: number
  loadAngle: number
  /** Pasos de índice desde la carga hasta el retiro */
  journey: number
}

/**
 * Estaciones del carrusel. Los caños avanzan con ángulo decreciente (bajan por la izquierda,
 * suben por la derecha).
 * - RETIRO: la primera posición completamente emergida en el lado que sube (el caño se toma
 *   apenas se descubre del baño, sin arco aéreo).
 * - CARGA FRÍO: el cenit, o la última posición al aire del lado que baja, antes de entrar al baño.
 */
export function carouselStations(n: number, loadStation: LoadStation, forcedPickK = 0): CarouselStations {
  const step = 360 / n
  const auto = autoPickK(n)
  const pickK = forcedPickK >= 1 && forcedPickK * step < 180 ? forcedPickK : auto
  const loadK = loadStation === 'preEntry' ? lastAirBeforeBath(n, step) : 0
  return {
    n,
    step,
    pickK,
    pickAngle: pickK * step,
    autoPickK: auto,
    forced: pickK !== auto,
    loadK,
    loadAngle: loadK * step,
    journey: (loadK - pickK + n) % n,
  }
}

/** Primera posición completamente emergida del lado que sube. */
export function autoPickK(n: number): number {
  const step = 360 / n
  let pickK = 1
  for (let k = 1; k * step < 180; k++) if (submergedFraction(k * step) === 0) pickK = k
  return pickK
}

/** Posiciones elegibles para forzar el RETIRO: lado que sube (0° < ángulo < 180°). */
export function pickChoices(n: number): { k: number; angle: number; f: number }[] {
  const step = 360 / n
  const out = []
  for (let k = 1; k * step < 180; k++) out.push({ k, angle: k * step, f: submergedFraction(k * step) })
  return out
}

/** Última posición al aire del lado que baja (menor ángulo > 180° sin contacto con el líquido). */
function lastAirBeforeBath(n: number, step: number): number {
  let best = 0
  for (let k = n - 1; k * step > 180 && submergedFraction(k * step) === 0; k--) best = k
  return best
}

/**
 * Posiciones de permanencia de un caño entre la carga y el retiro: j = 1..J−1 (un ciclo en cada
 * una). La posición J es la estación de retiro, donde se toma al llegar.
 */
export function trajectoryPositions(n: number, loadStation: LoadStation, forcedPickK = 0): { angle: number; f: number }[] {
  const st = carouselStations(n, loadStation, forcedPickK)
  return Array.from({ length: st.journey - 1 }, (_, i) => {
    const angle = (((st.loadK - (i + 1)) % n) + n) % n * st.step
    return { angle, f: submergedFraction(angle) }
  })
}

/**
 * Temperaturas para un ciclo dado: `exit` al terminar la última posición sumergida (lo que
 * evalúa el enclavamiento) y `station` al llegar a la estación de retiro tras el giro de 2 s.
 */
export function arrivalTemps(p: SimParams, cycle: number) {
  const tauL = bathTau(p.bathTau, p.wallThickness)
  let T = p.ambientTemp
  for (const pos of trajectoryPositions(p.slots, p.loadStation, p.pickStationK)) {
    T = carouselStep(T, pos.f, cycle, p.bathTemp, p.ambientTemp, tauL)
  }
  const station = carouselStep(T, 0, CAROUSEL_INDEX_TIME, p.bathTemp, p.ambientTemp, tauL)
  return { exit: T, station }
}

/** Curva temperatura–tiempo del recorrido completo, de la carga al retiro (para graficar). */
export function trajectoryCurve(p: SimParams, cycle: number, step = 2) {
  const tauL = bathTau(p.bathTau, p.wallThickness)
  let T = p.ambientTemp
  let t = 0
  const pts = [{ t, temp: T, f: 0 }]
  for (const pos of trajectoryPositions(p.slots, p.loadStation, p.pickStationK)) {
    const k = Math.max(1, Math.round(cycle / step))
    for (let i = 0; i < k; i++) {
      T = carouselStep(T, pos.f, cycle / k, p.bathTemp, p.ambientTemp, tauL)
      t += cycle / k
      pts.push({ t, temp: T, f: pos.f })
    }
  }
  T = carouselStep(T, 0, CAROUSEL_INDEX_TIME, p.bathTemp, p.ambientTemp, tauL)
  pts.push({ t: t + CAROUSEL_INDEX_TIME, temp: T, f: 0 })
  return pts
}

/**
 * Temperatura que debe tener el caño en la última posición sumergida para habilitar el giro que
 * lo lleva a la estación de retiro. Como se retira apenas emerge, no hace falta sobretemperatura
 * de compensación: la consigna es directamente la temperatura de conformado.
 */
export function interlockThreshold(p: SimParams): number {
  return Math.min(p.targetTemp, p.bathTemp - 0.5)
}

/** Ciclo mínimo (bisección) para que el caño salga del baño con la temperatura de enclavamiento. */
export function minCarouselCycle(p: SimParams, lowerBound: number, threshold = interlockThreshold(p)): number {
  const reach = (c: number) => arrivalTemps(p, c).exit >= threshold
  let hi = 1200
  if (!reach(hi)) return Infinity
  let lo = lowerBound
  if (reach(lo)) return lo
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid)) hi = mid
    else lo = mid
  }
  return hi
}
