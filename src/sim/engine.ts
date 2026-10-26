import { arrivalTemps, carouselStations, computeBalance, interlockThreshold, trajectoryPositions, type CarouselStations } from './balance'
import type { SimParams } from './params'
import {
  AIR_TAU,
  BATH,
  bathTau,
  CAROUSEL_INDEX_TIME,
  carouselStep,
  CHILLER_CAPACITY,
  CHILLER_GAIN,
  coolingTau,
  DIE_TAU,
  HDPE,
  relax,
  SENSOR_MAX_INJECT,
  SENSOR_STOP_TEMP,
  classifyDemold,
  levelDropFor,
  submergedFraction,
  TANK_UA,
  tubeInnerVolumeL,
  tubeMass,
  WATER,
} from './physics'
import {
  ALL_OFF,
  checkOutput,
  DEMOLD_PULSE,
  HOME_ACTUATORS,
  MANDREL_APPROACH,
  moveActuators,
  OPERATOR_SPLIT,
  readInputs,
  STEP_LABEL,
  stepDurations,
  type Actuators,
  type InterlockResult,
  type Inputs,
  type OutputId,
  type Outputs,
  type PressStep,
} from './sequence'

export const DT = 0.1 // s, paso de integración

export type OpTask =
  | 'UNLOAD' // retira la curva de la prensa y la deja en el contenedor
  | 'PICK' // toma el caño caliente del carrusel
  | 'TRANSFER' // lo traslada y lo coloca en la matriz, da marcha a la prensa
  | 'LOAD' // carga un caño frío en la posición libre del carrusel
  | 'WAIT_PRESS'
  | 'WAIT_TEMP'
  | 'WAIT_INDEX'
  | 'PAUSED'

/** Estación de conformado en L: secuencia de 10 pasos, cilindros y E/S del PLC. */
export interface PressState {
  /** Paso activo: 1–9 máquina; 10 = abierta, extracción y carga por el operario */
  step: PressStep
  /** Tiempo transcurrido en el paso [s] */
  elapsed: number
  act: Actuators
  out: Outputs
  /** Forma del caño: 0 recto → 1 curvado en L (acompaña al cierre de la matriz) */
  bend: number
  /** Campana (enchufe) abocardada en la boca del caño: 0 sin conformar → 1 contra la matriz */
  flare: number
  /** Llenado de agua de la L (0..1) y nivel del vaso colector de rebalse (0..1) */
  fill: number
  cup: number
  overflow: boolean
  tube: Tube | null
  hasPart: boolean
  cycleStart: number
  /** Modo manual (mantenimiento): las salidas se fuerzan a mano, siempre a través de los enclavamientos */
  manual: boolean
  /** Retorno automático a reposo al salir de manual */
  homing: boolean
  /** Registro de pasos (con las entradas al comenzar cada uno) */
  stepLog: { step: PressStep; t: number; inputs: Inputs }[]
  lastRejection: { t: number; reason: string } | null
}

export type Defect = 'frio' | 'sobrecalentado' | 'desmoldeo-caliente'

export interface Tube {
  id: number
  temp: number
  loadedAt: number
  overheatAlarmed: boolean
  /** Ya se advirtió riesgo de reblandecimiento superficial (> 128 °C con la línea detenida) */
  softeningWarned: boolean
  defects: Defect[]
  pickTemp?: number
  demoldTemp?: number
}

export type AlarmKind = 'OVERHEAT' | 'SOFTENING' | 'PICK_COLD' | 'DEMOLD_HOT' | 'DEMOLD_WARM' | 'INTERLOCK' | 'INFO'

export interface Alarm {
  id: number
  t: number
  kind: AlarmKind
  message: string
  value?: number
}

export interface Segment {
  res: 'op' | 'press' | 'carousel'
  label: string
  start: number
  end: number
  open: boolean
}

export interface CurvePoint {
  t: number
  temp: number
  water: number
}

export interface HistoryPoint {
  t: number
  h: number
  good: number
  scrap: number
  goal: number
  rate: number
  rateAvg: number
  occupancy: number
  tank: number
  work: number
  total: number
}

export const WORK_TASKS: OpTask[] = ['UNLOAD', 'PICK', 'TRANSFER', 'LOAD']

export interface SimState {
  t: number
  slots: (Tube | null)[]
  station: number
  /** 0..1 progreso del giro del carrusel, null si está detenido */
  indexProgress: number | null
  /** Instante del último comienzo de giro */
  lastIndexStart: number
  /** Instante en que terminó el último giro (o arranque): mide la detención de línea */
  lastIndexEnd: number
  operator: { task: OpTask; elapsed: number; duration: number; carrying: Tube | null; pauseRequested: boolean }
  press: PressState
  tank: { temp: number; heatIn: number; waterOut: number; glycerinMl: number }
  /** Batea de glicerina */
  bath: { temp: number; volumeL: number; heaterPower: number; heatToTubes: number }
  good: number
  scrap: number
  scrapBy: Record<Defect, number>
  opTime: Record<OpTask, number>
  alarms: Alarm[]
  alarmCounts: Record<AlarmKind, number>
  unackedAlarms: number
  curve: CurvePoint[]
  lastCurve: CurvePoint[]
  lastInjectWindow: [number, number]
  injectWindow: [number, number]
  history: HistoryPoint[]
  segments: Segment[]
  cycleTimes: number[]
  lastPressStart: number | null
  seq: number
  nextTubeId: number
  nextAlarmId: number
  shiftEnded: boolean
  lastPick: { temp: number; t: number } | null
  lastDemold: { temp: number; t: number } | null
}

const HISTORY_EVERY = 30 // s
const SEGMENT_WINDOW = 180 // s

export class CellSimulation {
  params: SimParams
  state: SimState
  /** Permanencia mínima por posición que aplica el PLC con enclavamiento (del balance) [s] */
  dwellMin = 0
  /** Estaciones de RETIRO (salida del baño) y CARGA FRÍO */
  stations: CarouselStations

  constructor(params: SimParams) {
    this.params = params
    this.stations = carouselStations(params.slots, params.loadStation, params.pickStationK, levelDropFor(params.bathPods, params.slots))
    this.state = this.initialState()
  }

  setParams(p: SimParams) {
    const prev = this.params
    this.params = p
    this.updateDwell()
    if (p.waterInitTemp !== prev.waterInitTemp) {
      // Se interpreta como recambio de agua del tanque.
      this.state.tank.temp = p.waterInitTemp
    }
  }

  reset(p?: SimParams) {
    if (p) this.params = p
    this.state = this.initialState()
  }

  private updateDwell() {
    const c = computeBalance(this.params).cycleCarousel
    this.dwellMin = Number.isFinite(c) ? c : 0
  }

  private initialState(): SimState {
    this.updateDwell()
    this.stations = carouselStations(this.params.slots, this.params.loadStation, this.params.pickStationK, levelDropFor(this.params.bathPods, this.params.slots))
    const p = this.params
    const n = p.slots
    const slots: (Tube | null)[] = new Array(n).fill(null)
    let nextTubeId = 1
    if (!p.coldStart) {
      // Arranque en régimen: cada caño tiene la historia térmica que tendría con el ciclo teórico.
      // La posición k (ángulo k·360/N) está a j = (carga − k) mod N pasos de la carga: el caño allí
      // completó j − 1 posiciones. En el retiro (j = J) espera un caño listo; de ahí hasta la carga
      // las posiciones van vacías.
      const b = computeBalance(p)
      const cycle = Number.isFinite(b.cycle) ? b.cycle : 60
      const { loadK, journey } = this.stations
      const temps = [p.ambientTemp]
      const tauL = bathTau(p.bathTau, p.wallThickness)
      for (const pos of trajectoryPositions(n, p.loadStation, p.pickStationK, levelDropFor(p.bathPods, n))) {
        temps.push(carouselStep(temps[temps.length - 1], pos.f, cycle, p.bathTemp, p.ambientTemp, tauL))
      }
      for (let k = 0; k < n; k++) {
        const j = (((loadK - k) % n) + n) % n
        if (j === 0 || j > journey) continue
        const done = j - 1
        const temp = j === journey ? arrivalTemps(p, cycle).station : temps[done]
        const residence = done * cycle
        slots[k] = {
          id: nextTubeId++,
          temp,
          loadedAt: -residence,
          overheatAlarmed: temp > HDPE.overheatAlarm,
          softeningWarned: false,
          defects: [],
        }
      }
    }
    const zero = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
    const s: SimState = {
      t: 0,
      slots,
      station: 0,
      indexProgress: null,
      lastIndexStart: -Infinity,
      lastIndexEnd: 0,
      operator: { task: 'WAIT_PRESS', elapsed: 0, duration: 0, carrying: null, pauseRequested: false },
      press: {
        step: 10,
        elapsed: 0,
        act: { ...HOME_ACTUATORS },
        out: { ...ALL_OFF },
        bend: 0,
        flare: 0,
        fill: 0,
        cup: 0,
        overflow: false,
        tube: null,
        hasPart: false,
        cycleStart: 0,
        manual: false,
        homing: false,
        stepLog: [],
        lastRejection: null,
      },
      tank: { temp: p.waterInitTemp, heatIn: 0, waterOut: p.waterInitTemp, glycerinMl: 0 },
      bath: { temp: p.bathTemp, volumeL: BATH.volumeL, heaterPower: 0, heatToTubes: 0 },
      good: 0,
      scrap: 0,
      scrapBy: zero<Defect>(['frio', 'sobrecalentado', 'desmoldeo-caliente']),
      opTime: zero<OpTask>(['UNLOAD', 'PICK', 'TRANSFER', 'LOAD', 'WAIT_PRESS', 'WAIT_TEMP', 'WAIT_INDEX', 'PAUSED']),
      alarms: [],
      alarmCounts: zero<AlarmKind>(['OVERHEAT', 'SOFTENING', 'PICK_COLD', 'DEMOLD_HOT', 'DEMOLD_WARM', 'INTERLOCK', 'INFO']),
      unackedAlarms: 0,
      curve: [],
      lastCurve: [],
      lastInjectWindow: [0, 0],
      injectWindow: [0, 0],
      history: [],
      segments: [],
      cycleTimes: [],
      lastPressStart: null,
      seq: 0,
      nextTubeId,
      nextAlarmId: 1,
      shiftEnded: false,
      lastPick: null,
      lastDemold: null,
    }
    this.state = s
    this.pushHistory()
    this.decideOperator()
    this.openSegment('press', STEP_LABEL[10])
    this.openSegment('carousel', 'Detenido')
    return s
  }

  // ---------------------------------------------------------------- API pública

  togglePause() {
    const op = this.state.operator
    if (op.task === 'PAUSED') {
      op.pauseRequested = false
      this.decideOperator()
    } else {
      op.pauseRequested = !op.pauseRequested
      if (op.pauseRequested && op.task.startsWith('WAIT')) this.decideOperator()
    }
  }

  get isPaused() {
    return this.state.operator.task === 'PAUSED' || this.state.operator.pauseRequested
  }

  ackAlarms() {
    this.state.unackedAlarms = 0
  }

  /** Avanza `simSeconds` de tiempo simulado. */
  advance(simSeconds: number) {
    const steps = Math.round(simSeconds / DT)
    for (let i = 0; i < steps && !this.state.shiftEnded; i++) this.tick(DT)
  }

  /** Avanza hasta el próximo evento discreto (cambio de tarea o de fase). */
  stepToNextEvent(maxSeconds = 900) {
    const seq = this.state.seq
    const limit = this.state.t + maxSeconds
    while (this.state.seq === seq && this.state.t < limit && !this.state.shiftEnded) this.tick(DT)
  }

  // ---------------------------------------------------------------- núcleo

  private rand(base: number) {
    const v = this.params.variability / 100
    return Math.max(0.2, base * (1 + v * (Math.random() * 2 - 1)))
  }

  private tick(dt: number) {
    const s = this.state
    const p = this.params
    s.t += dt

    this.updateCarousel(dt)
    this.updateOperator(dt)
    this.updatePress(dt)
    this.updateTank(dt)

    if (s.t - s.history[s.history.length - 1].t >= HISTORY_EVERY - 1e-9) this.pushHistory()
    if (s.t >= p.shiftHours * 3600) {
      s.shiftEnded = true
      this.pushHistory()
      this.raise('INFO', `Fin de jornada: ${s.good} piezas OK (meta ${p.dailyGoal}).`)
    }
  }

  private updateCarousel(dt: number) {
    const s = this.state
    const p = this.params
    const tauL = bathTau(p.bathTau, p.wallThickness)
    const bath = s.bath
    const m = tubeMass(p.wallThickness)
    let qTubes = 0 // W extraídos de la glicerina
    const stopped = this.lineStoppedFor()
    for (let i = 0; i < s.slots.length; i++) {
      const tube = s.slots[i]
      if (!tube) continue
      const f = submergedFraction(this.slotAngle(i), levelDropFor(p.bathPods, s.slots.length))
      qTubes += (m * HDPE.cp * f * (bath.temp - tube.temp)) / tauL
      tube.temp = carouselStep(tube.temp, f, dt, bath.temp, p.ambientTemp, tauL)
      if (tube.temp > HDPE.overheatAlarm && !tube.overheatAlarmed) {
        tube.overheatAlarmed = true
        this.raise(
          'OVERHEAT',
          `Scrap crítico: caño #${tube.id} a ${tube.temp.toFixed(0)} °C en el carrusel (> ${HDPE.overheatAlarm} °C), no fue extraído a tiempo.`,
          tube.temp,
        )
      } else if (stopped > HDPE.stopWarnSeconds && tube.temp > HDPE.softeningWarn && !tube.softeningWarned) {
        // El baño está por encima de la consigna: con la línea detenida el caño tiende a la glicerina.
        tube.softeningWarned = true
        this.raise(
          'SOFTENING',
          `Riesgo de reblandecimiento superficial: caño #${tube.id} a ${tube.temp.toFixed(1)} °C (> ${HDPE.softeningWarn} °C) con la línea detenida hace ${stopped.toFixed(0)} s.`,
          tube.temp,
        )
      }
    }
    // Balance de la batea: resistencias con control proporcional, caños y pérdidas.
    const C = bath.volumeL * BATH.rho * BATH.cp
    bath.heaterPower = Math.min(BATH.heaterMax, Math.max(0, BATH.heaterGain * (p.bathTemp - bath.temp)))
    bath.heatToTubes += qTubes * dt
    bath.temp += ((bath.heaterPower - qTubes - BATH.ua * (bath.temp - p.ambientTemp)) * dt) / C
    // Giro automático: retiro vacío (caño ya tomado), carga completa y enclavamiento cumplido.
    if (s.indexProgress === null && this.readyToIndex() && this.indexAllowed()) this.startIndex()
    if (s.indexProgress !== null) {
      s.indexProgress += dt / CAROUSEL_INDEX_TIME
      if (s.indexProgress >= 1) {
        s.indexProgress = null
        s.station = (s.station + 1) % s.slots.length
        s.lastIndexEnd = s.t
        this.openSegment('carousel', 'Detenido')
        s.seq++
      }
    }
  }

  /** Segundos que lleva el carrusel sin indexar (0 mientras gira). */
  lineStoppedFor(): number {
    const s = this.state
    return s.indexProgress === null ? s.t - s.lastIndexEnd : 0
  }

  /** Caños en riesgo de reblandecimiento: > 128 °C con la línea detenida más de 90 s. */
  softeningRisk(tube: Tube | null): boolean {
    return tube !== null && tube.temp > HDPE.softeningWarn && this.lineStoppedFor() > HDPE.stopWarnSeconds
  }

  /** Índice de la posición que está ahora en la estación de RETIRO (k pasos desde el cenit). */
  pickSlot(): number {
    return (this.state.station + this.stations.pickK) % this.state.slots.length
  }

  /** Índice de la posición que está ahora en la estación de CARGA FRÍO. */
  loadSlot(): number {
    return (this.state.station + this.stations.loadK) % this.state.slots.length
  }

  /** Condiciones mecánicas del giro: el caño del retiro ya fue tomado y la carga está completa. */
  readyToIndex(): boolean {
    const s = this.state
    return s.slots[this.pickSlot()] === null && s.slots[this.loadSlot()] !== null
  }

  /** El giro está pedido por la secuencia pero lo retiene el enclavamiento de temperatura. */
  indexBlocked(): boolean {
    return this.state.indexProgress === null && this.readyToIndex() && !this.indexAllowed()
  }

  /** Ángulo actual de una posición: 0° = cenit, crece en sentido horario (los caños avanzan con ángulo decreciente). */
  slotAngle(i: number): number {
    const s = this.state
    const n = s.slots.length
    const a = ((i - s.station - (s.indexProgress ?? 0)) * 360) / n
    return ((a % 360) + 360) % 360
  }

  /**
   * Enclavamiento de temperatura del carrusel. El caño se retira apenas emerge, así que el PLC
   * evalúa la temperatura con la que va a llegar a la estación de RETIRO: la del caño en la
   * última posición sumergida, justo antes del giro (el tránsito al retiro dura 2 s). Una vez
   * afuera ya no gana temperatura, por eso se retiene el giro y no al operario:
   *  1. permanencia mínima por posición = ciclo de calentamiento calculado (reparte parejo el
   *     tiempo de inmersión entre todas las posiciones sumergidas), y
   *  2. el caño que va a emerger debe tener la temperatura de conformado (sin sobretemperatura).
   */
  indexAllowed(): boolean {
    if (!this.params.tempInterlock) return true
    const s = this.state
    if (s.t - s.lastIndexStart < this.dwellMin) return false
    const tube = this.emergingTube()
    return !tube || tube.temp >= interlockThreshold(this.params)
  }

  /** Caño en la última posición sumergida: el próximo en llegar a la estación de RETIRO. */
  emergingTube(): Tube | null {
    const s = this.state
    return s.slots[(this.pickSlot() + 1) % s.slots.length]
  }

  /** Caño en la estación de RETIRO (sólo con el carrusel detenido). */
  pickTube(): Tube | null {
    return this.state.indexProgress === null ? this.state.slots[this.pickSlot()] : null
  }

  private startIndex() {
    this.state.indexProgress = 0
    this.state.lastIndexStart = this.state.t
    this.openSegment('carousel', 'Indexando')
    this.state.seq++
  }

  private updateOperator(dt: number) {
    const s = this.state
    const p = this.params
    const op = s.operator
    s.opTime[op.task] += dt
    if (op.carrying) op.carrying.temp = relax(op.carrying.temp, p.ambientTemp, dt, AIR_TAU)

    if (op.task.startsWith('WAIT') || op.task === 'PAUSED') {
      op.elapsed += dt
      if (op.task !== 'PAUSED') this.decideOperator()
      return
    }
    op.elapsed += dt
    if (op.elapsed < op.duration) return
    this.completeTask(op.task)
    this.decideOperator()
  }

  private completeTask(task: OpTask) {
    const s = this.state
    const p = this.params
    const op = s.operator
    switch (task) {
      case 'UNLOAD': {
        const tube = s.press.tube!
        s.press.tube = null
        s.press.hasPart = false
        if (tube.defects.length === 0) s.good++
        else {
          s.scrap++
          for (const d of tube.defects) s.scrapBy[d]++
        }
        break
      }
      case 'PICK': {
        const idx = this.pickSlot()
        const tube = s.slots[idx]!
        s.slots[idx] = null
        op.carrying = tube
        tube.pickTemp = tube.temp
        // Película de glicerina arrastrada: sale de la batea y termina en el agua del lavado.
        s.bath.volumeL -= p.dragOutMl / 1000
        s.lastPick = { temp: tube.temp, t: s.t }
        if (tube.temp < HDPE.softMin) {
          tube.defects.push('frio')
          this.raise(
            'PICK_COLD',
            `Se retiró el caño #${tube.id} a ${tube.temp.toFixed(1)} °C (< ${HDPE.softMin} °C): insuficientemente blando, la curva sale con arrugas/fisuras.`,
            tube.temp,
          )
        } else if (tube.temp > HDPE.degrade) {
          tube.defects.push('sobrecalentado')
        }
        break
      }
      case 'TRANSFER': {
        const tube = op.carrying!
        op.carrying = null
        s.press.tube = tube
        if (s.lastPressStart !== null) {
          s.cycleTimes.push(s.t - s.lastPressStart)
          if (s.cycleTimes.length > 30) s.cycleTimes.shift()
        }
        s.lastPressStart = s.t
        s.press.bend = 0
        s.press.flare = 0
        this.startStep(1)
        break
      }
      case 'LOAD': {
        s.slots[this.loadSlot()] = {
          id: s.nextTubeId++,
          temp: p.ambientTemp,
          loadedAt: s.t,
          overheatAlarmed: false,
          softeningWarned: false,
          defects: [],
        }
        break
      }
      default:
        break
    }
  }

  private nextTask(): OpTask {
    const s = this.state
    const op = s.operator
    const press = s.press
    const pressReady = this.pressAvailable()
    const pressFreeOpen = pressReady && !press.tube
    if (op.carrying) return pressFreeOpen ? 'TRANSFER' : 'WAIT_PRESS'
    if (op.pauseRequested) return 'PAUSED'
    if (pressReady && press.hasPart) return 'UNLOAD'
    const moving = s.indexProgress !== null
    if (!moving) {
      // Retiro inmediato: si hay caño en la salida y la prensa está libre, se toma ya.
      if (s.slots[this.pickSlot()] && pressFreeOpen) return 'PICK'
      // Mientras tanto (prensa ocupada o sin caño afuera) se aprovecha para cargar el frío.
      if (s.slots[this.loadSlot()] === null) return 'LOAD'
    }
    if (!pressFreeOpen) return 'WAIT_PRESS'
    if (moving) return 'WAIT_INDEX'
    return this.indexBlocked() ? 'WAIT_TEMP' : 'WAIT_INDEX'
  }

  private decideOperator() {
    const s = this.state
    const op = s.operator
    const next = this.nextTask()
    if (next === op.task && (next.startsWith('WAIT') || next === 'PAUSED')) return
    const p = this.params
    // Paso 10 (extracción + carga del caño caliente) repartido entre las tareas; la carga en frío es aparte.
    const op10 = p.seqOperatorMs / 1000
    const durations: Partial<Record<OpTask, number>> = {
      UNLOAD: this.rand(op10 * OPERATOR_SPLIT.unload),
      PICK: this.rand(op10 * OPERATOR_SPLIT.pick),
      TRANSFER: this.rand(op10 * OPERATOR_SPLIT.transfer),
      LOAD: this.rand(p.coldLoadMs / 1000),
    }
    op.task = next
    op.elapsed = 0
    op.duration = durations[next] ?? 0
    s.seq++
    this.openSegment('op', next)
  }

  // ---------------------------------------------------------------- estación de conformado en L

  /** La estación está abierta, en automático y lista para que el operario intervenga (paso 10). */
  pressAvailable(): boolean {
    const press = this.state.press
    return press.step === 10 && !press.manual && !press.homing
  }

  /** Cambia una salida pasando siempre por los enclavamientos del PLC. */
  private setOutput(id: OutputId, value: boolean, source: 'auto' | 'manual'): InterlockResult {
    const press = this.state.press
    const r = checkOutput(id, value, press.act, press.out)
    if (r.ok) {
      press.out[id] = value
    } else {
      press.lastRejection = { t: this.state.t, reason: r.reason! }
      this.raise('INTERLOCK', `Bloqueo de seguridad (${source === 'manual' ? 'forzado manual' : 'secuencia'}): ${r.reason}`)
    }
    return r
  }

  private startStep(n: PressStep, carry = 0) {
    const s = this.state
    const p = this.params
    const press = s.press
    press.step = n
    press.elapsed = carry
    s.seq++
    press.stepLog.push({ step: n, t: s.t, inputs: readInputs(press.act) })
    if (press.stepLog.length > 60) press.stepLog.shift()
    this.openSegment('press', STEP_LABEL[n])
    switch (n) {
      case 1:
        s.curve = []
        press.cycleStart = s.t
        this.setOutput('Y1', true, 'auto')
        break
      case 2:
        this.setOutput('Y2', true, 'auto')
        break
      case 3:
        this.setOutput('Y3', true, 'auto')
        break
      case 4:
        break // el mandril sigue avanzando, a velocidad de asiento
      case 5:
        s.injectWindow = [s.t - press.cycleStart, s.t - press.cycleStart]
        s.tank.glycerinMl += p.dragOutMl
        this.setOutput('Y4', true, 'auto')
        break
      case 6:
        s.injectWindow = [s.injectWindow[0], s.t - press.cycleStart]
        this.setOutput('Y4', false, 'auto')
        this.setOutput('Y5', true, 'auto')
        break
      case 7:
        this.setOutput('Y5', true, 'auto') // pulso de desmoldeo
        this.setOutput('Y3', false, 'auto')
        break
      case 8:
        this.setOutput('Y2', false, 'auto')
        break
      case 9: {
        // Orden de abrir la matriz: verificación de temperatura de desmoldeo.
        const t = press.tube
        if (t) {
          t.demoldTemp = t.temp
          s.lastDemold = { temp: t.temp, t: s.t }
          const q = classifyDemold(t.temp)
          if (q === 'scrap') {
            t.defects.push('desmoldeo-caliente')
            this.raise(
              'DEMOLD_HOT',
              `Scrap: apertura de matriz con el caño #${t.id} a ${t.temp.toFixed(1)} °C (> ${HDPE.demoldMax} °C), sin rigidez suficiente para manipularlo: riesgo de deformación.`,
              t.temp,
            )
          } else if (q === 'warn') {
            // pieza conforme: sólo se contabiliza como aviso preventivo (sin entrada en el registro)
            s.alarmCounts.DEMOLD_WARM++
          }
        }
        this.setOutput('Y1', false, 'auto')
        break
      }
      case 10:
        press.hasPart = press.tube !== null
        s.lastCurve = s.curve
        s.lastInjectWindow = s.injectWindow
        break
    }
  }

  /** ¿Terminó el paso automático? Tiempo cumplido y final de carrera confirmado. */
  private stepDone(): boolean {
    const p = this.params
    const press = this.state.press
    const d = stepDurations(p)
    const b = readInputs(press.act)
    const n = press.step
    if (n === 10) return false
    if (n === 5 && p.coolingMode === 'sensor') {
      const T = press.tube?.temp ?? 0
      return (press.elapsed >= d[5] - 1e-9 && T <= SENSOR_STOP_TEMP) || press.elapsed >= SENSOR_MAX_INJECT
    }
    if (press.elapsed < d[n] - 1e-9) return false
    switch (n) {
      case 1:
        return b.B1
      case 2:
        return b.B2
      case 3:
        return press.act.mandrel >= MANDREL_APPROACH - 1e-6
      case 4:
        return b.B3
      case 7:
        return b.B4
      case 8:
        return b.B5
      case 9:
        return b.B6
      default:
        return true
    }
  }

  // ---- API de mantenimiento (modo manual) ----

  /** Entra o sale del modo manual. Al salir, la estación vuelve sola a reposo respetando los enclavamientos. */
  setManual(on: boolean): InterlockResult {
    const press = this.state.press
    if (on) {
      if (press.manual) return { ok: true }
      if (press.step !== 10 || press.homing) {
        return { ok: false, reason: 'Esperar el fin del ciclo automático (paso 10) para pasar a manual.' }
      }
      const task = this.state.operator.task
      if (task === 'TRANSFER' || task === 'UNLOAD') {
        return { ok: false, reason: 'El operario está trabajando en la estación: esperar a que termine.' }
      }
      press.manual = true
      this.state.seq++
      this.openSegment('press', 'Manual')
      return { ok: true }
    }
    if (!press.manual) return { ok: true }
    press.homing = true
    this.state.seq++
    return { ok: true }
  }

  /** Fuerza una salida en modo manual. El motor rechaza cualquier cambio que viole un enclavamiento. */
  forceOutput(id: OutputId, value: boolean): InterlockResult {
    const press = this.state.press
    if (!press.manual || press.homing) {
      return { ok: false, reason: 'Las salidas sólo se fuerzan en modo manual.' }
    }
    const r = this.setOutput(id, value, 'manual')
    this.state.seq++
    return r
  }

  inputs(): Inputs {
    return readInputs(this.state.press.act)
  }

  private updateHoming() {
    const press = this.state.press
    const b = readInputs(press.act)
    if (press.out.Y4) this.setOutput('Y4', false, 'auto')
    if (press.out.Y5) this.setOutput('Y5', false, 'auto')
    if (press.out.Y3) this.setOutput('Y3', false, 'auto')
    else if (b.B4 && press.out.Y2) this.setOutput('Y2', false, 'auto')
    else if (b.B4 && b.B5 && press.out.Y1) this.setOutput('Y1', false, 'auto')
    const home = b.B4 && b.B5 && b.B6 && !Object.values(press.out).some(Boolean)
    if (home) {
      press.homing = false
      press.manual = false
      this.state.seq++
      this.openSegment('press', STEP_LABEL[10])
    }
  }

  private updatePress(dt: number) {
    const s = this.state
    const p = this.params
    const press = s.press
    const auto = !press.manual
    s.tank.waterOut = s.tank.temp

    // Subeventos temporizados de la secuencia automática.
    if (auto && press.step <= 9) {
      press.elapsed += dt
      if (press.step === 6 && press.out.Y5 && press.elapsed >= p.seqBlowMs / 1000) this.setOutput('Y5', false, 'auto')
      if (press.step === 7 && press.out.Y5 && press.elapsed >= DEMOLD_PULSE) this.setOutput('Y5', false, 'auto')
    }
    if (press.homing) this.updateHoming()

    // Cilindros y finales de carrera.
    press.act = moveActuators(press.act, press.out, p, dt)
    const b = readInputs(press.act)
    if (press.tube && !press.hasPart) {
      press.bend = Math.max(press.bend, press.act.die)
      // el cono empieza a expandir la boca en el último tramo del avance y la termina al asentar
      press.flare = Math.max(press.flare, Math.min(1, Math.max(0, (press.act.mandrel - 0.6) / 0.4)))
    }

    // Agua: llena la L vertical, rebalsa al vaso colector y drena por gravedad.
    const flowing = press.out.Y4 && b.B3
    const fillRate = p.pumpFlow / 60 / tubeInnerVolumeL(p.wallThickness)
    if (flowing) press.fill = Math.min(1, press.fill + fillRate * dt)
    else if (press.out.Y5) press.fill = Math.max(0, press.fill - dt / Math.max(0.1, (p.seqBlowMs / 1000) * 0.6))
    else press.fill = Math.max(0, press.fill - dt / 0.8)
    press.overflow = flowing && press.fill >= 1
    press.cup = press.overflow ? Math.min(1, press.cup + dt / 0.8) : Math.max(0, press.cup - dt / 1.5)

    // Térmica del caño en la matriz.
    const tube = press.tube
    if (tube) {
      if (flowing && press.fill > 0) {
        const before = tube.temp
        tube.temp = relax(tube.temp, s.tank.temp, dt * press.fill, coolingTau(p.wallThickness, p.pumpFlow))
        const q = tubeMass(p.wallThickness) * HDPE.cp * (before - tube.temp) // J
        s.tank.heatIn += q
        s.tank.temp += q / (p.tankVolume * WATER.cp * (WATER.rho / 1000))
        const mDot = (p.pumpFlow / 60) * (WATER.rho / 1000) // kg/s
        s.tank.waterOut = s.tank.temp + q / dt / (mDot * WATER.cp)
      } else if (press.act.die > 0.5) {
        tube.temp = relax(tube.temp, p.ambientTemp + 5, dt, DIE_TAU)
      } else {
        tube.temp = relax(tube.temp, p.ambientTemp, dt, AIR_TAU)
      }
      if (auto && press.step <= 9) {
        s.curve.push({ t: +(s.t - press.cycleStart).toFixed(2), temp: tube.temp, water: s.tank.waterOut })
      }
    }

    // Avance de la secuencia automática.
    if (auto && press.step <= 9 && this.stepDone()) {
      const d = stepDurations(p)
      const carry = press.step === 5 && p.coolingMode === 'sensor' ? 0 : Math.min(dt, press.elapsed - d[press.step])
      this.startStep((press.step + 1) as PressStep, Math.max(0, carry))
    }
  }

  private updateTank(dt: number) {
    const s = this.state
    const p = this.params
    const C = p.tankVolume * WATER.cp * (WATER.rho / 1000) // J/K
    let q = TANK_UA[p.tankCooling] * (p.ambientTemp - s.tank.temp) // W (+ entra)
    if (p.tankCooling === 'chiller' && s.tank.temp > p.waterInitTemp) {
      q -= Math.min(CHILLER_CAPACITY, CHILLER_GAIN * (s.tank.temp - p.waterInitTemp))
    }
    s.tank.temp += (q * dt) / C
  }

  // ---------------------------------------------------------------- registro

  private raise(kind: AlarmKind, message: string, value?: number) {
    const s = this.state
    s.alarms.unshift({ id: s.nextAlarmId++, t: s.t, kind, message, value })
    if (s.alarms.length > 250) s.alarms.pop()
    s.alarmCounts[kind]++
    if (kind !== 'INFO') s.unackedAlarms++
  }

  private openSegment(res: Segment['res'], label: string) {
    const s = this.state
    for (let i = s.segments.length - 1; i >= 0; i--) {
      if (s.segments[i].res === res && s.segments[i].open) {
        s.segments[i].end = s.t
        s.segments[i].open = false
        break
      }
    }
    s.segments.push({ res, label, start: s.t, end: s.t, open: true })
    if (s.segments.length > 300) {
      const cutoff = s.t - SEGMENT_WINDOW
      s.segments = s.segments.filter((seg) => seg.open || seg.end >= cutoff)
    }
  }

  /** Extiende los segmentos abiertos hasta el instante actual (para dibujar). */
  liveSegments(): Segment[] {
    const s = this.state
    const cutoff = s.t - SEGMENT_WINDOW
    return s.segments
      .filter((seg) => seg.open || seg.end >= cutoff)
      .map((seg) => (seg.open ? { ...seg, end: s.t } : seg))
  }

  private pushHistory() {
    const s = this.state
    const p = this.params
    const work = WORK_TASKS.reduce((a, k) => a + s.opTime[k], 0)
    const total = Object.values(s.opTime).reduce((a, b) => a + b, 0)
    const windowSec = 600
    let ref = s.history[0]
    for (let i = s.history.length - 1; i >= 0; i--) {
      if (s.t - s.history[i].t >= windowSec) {
        ref = s.history[i]
        break
      }
    }
    const dtw = ref ? s.t - ref.t : 0
    const rate = ref && dtw > 0 ? ((s.good - ref.good) * 3600) / dtw : 0
    const occ = ref && total - ref.total > 0 ? (work - ref.work) / (total - ref.total) : 0
    s.history.push({
      t: s.t,
      h: s.t / 3600,
      good: s.good,
      scrap: s.scrap,
      goal: (p.dailyGoal * s.t) / (p.shiftHours * 3600),
      rate,
      rateAvg: s.t > 0 ? (s.good * 3600) / s.t : 0,
      occupancy: occ * 100,
      tank: s.tank.temp,
      work,
      total,
    })
  }

  // ---------------------------------------------------------------- métricas derivadas

  metrics() {
    const s = this.state
    const work = WORK_TASKS.reduce((a, k) => a + s.opTime[k], 0)
    const total = Object.values(s.opTime).reduce((a, b) => a + b, 0)
    const last = s.cycleTimes.slice(-10)
    const avgCycle = last.length ? last.reduce((a, b) => a + b, 0) / last.length : null
    const rateAvg = s.t > 60 ? (s.good * 3600) / s.t : 0
    return {
      work,
      total,
      occupancy: total > 0 ? work / total : 0,
      avgCycle,
      lastCycle: s.cycleTimes.length ? s.cycleTimes[s.cycleTimes.length - 1] : null,
      rateAvg,
      rateInstant: avgCycle ? 3600 / avgCycle : 0,
      projectedDay: rateAvg * this.params.shiftHours,
    }
  }
}
