/**
 * Grabación de cuadros para la cámara del Modo Render: copias livianas del estado de la simulación
 * (una por tick) en un buffer circular, más la interpolación entre cuadros que permite reproducir en
 * cámara lenta y arrastrar la línea de tiempo con movimiento continuo.
 *
 * Este módulo sólo LEE el estado del motor: no lo modifica ni participa de los cálculos.
 */
import type { CellSimulation, SimState, Tube } from './engine'

const NONE: never[] = []

export function cloneTube(t: Tube | null): Tube | null {
  return t ? { ...t, defects: [...t.defects] } : null
}

/**
 * Copia de lo que dibuja la cámara (carrusel, batea, estación en L, tanque y contadores). Las series
 * largas (historial, alarmas, segmentos, curvas) no se copian: la cámara no las usa y son pesadas.
 */
export function snapshotState(s: SimState): SimState {
  return {
    ...s,
    slots: s.slots.map(cloneTube),
    operator: { ...s.operator, carrying: cloneTube(s.operator.carrying) },
    press: {
      ...s.press,
      act: { ...s.press.act },
      out: { ...s.press.out },
      tube: cloneTube(s.press.tube),
      stepLog: NONE,
    },
    tank: { ...s.tank },
    bath: { ...s.bath },
    lastPick: s.lastPick && { ...s.lastPick },
    lastDemold: s.lastDemold && { ...s.lastDemold },
    alarms: NONE,
    history: NONE,
    segments: NONE,
    curve: NONE,
    lastCurve: NONE,
    cycleTimes: NONE,
  }
}

const mix = (x: number, y: number, u: number) => x + (y - x) * u

/**
 * Estado intermedio entre dos cuadros consecutivos (u = 0 → a, u = 1 → b). Se interpolan las
 * magnitudes continuas (cilindros, giro del carrusel, agua, temperaturas, reloj); lo discreto
 * (paso activo, ocupación de posiciones, salidas del PLC) se toma del cuadro más cercano.
 */
export function lerpState(a: SimState, b: SimState, u: number): SimState {
  if (u <= 0) return a
  if (u >= 1) return b
  const base = u < 0.5 ? a : b
  const n = base.slots.length

  // Giro del carrusel: posición continua = posición + progreso (con vuelta al pasar por la última).
  let station = base.station
  let indexProgress = base.indexProgress
  if (a.indexProgress !== null || b.indexProgress !== null) {
    const posA = a.station + (a.indexProgress ?? 0)
    let posB = b.station + (b.indexProgress ?? 0)
    if (b.station < a.station) posB += n
    const pos = mix(posA, posB, u)
    const whole = Math.floor(pos + 1e-9)
    const frac = pos - whole
    station = whole % n
    indexProgress = frac < 1e-6 ? null : frac
  }

  const slots = base.slots.map((t, i) => {
    const ta = a.slots[i]
    const tb = b.slots[i]
    return t && ta && tb && ta.id === tb.id ? { ...t, temp: mix(ta.temp, tb.temp, u) } : t
  })

  const sameTube = (x: Tube | null, y: Tube | null) => x !== null && y !== null && x.id === y.id
  const withTemp = (t: Tube | null, x: Tube | null, y: Tube | null) => (t && sameTube(x, y) ? { ...t, temp: mix(x!.temp, y!.temp, u) } : t)

  const sameTask = a.operator.task === b.operator.task && a.operator.duration === b.operator.duration
  const sameStep = a.press.step === b.press.step && a.press.manual === b.press.manual

  return {
    ...base,
    t: mix(a.t, b.t, u),
    station,
    indexProgress,
    slots,
    operator: {
      ...base.operator,
      elapsed: sameTask ? mix(a.operator.elapsed, b.operator.elapsed, u) : base.operator.elapsed,
      carrying: withTemp(base.operator.carrying, a.operator.carrying, b.operator.carrying),
    },
    press: {
      ...base.press,
      act: {
        die: mix(a.press.act.die, b.press.act.die, u),
        clamp: mix(a.press.act.clamp, b.press.act.clamp, u),
        mandrel: mix(a.press.act.mandrel, b.press.act.mandrel, u),
      },
      bend: mix(a.press.bend, b.press.bend, u),
      flare: mix(a.press.flare, b.press.flare, u),
      fill: mix(a.press.fill, b.press.fill, u),
      cup: mix(a.press.cup, b.press.cup, u),
      elapsed: sameStep ? mix(a.press.elapsed, b.press.elapsed, u) : base.press.elapsed,
      tube: withTemp(base.press.tube, a.press.tube, b.press.tube),
    },
    tank: { ...base.tank, temp: mix(a.tank.temp, b.tank.temp, u) },
    bath: { ...base.bath, temp: mix(a.bath.temp, b.bath.temp, u) },
  }
}

export interface Frame {
  t: number
  state: SimState
}

/** Buffer circular de cuadros (por defecto 1200: 2 minutos de simulación a un cuadro por tick). */
export class FrameBuffer {
  /** Sólo se captura mientras la cámara del Modo Render está activa (no cuesta nada en la vista técnica). */
  enabled = false
  /** Fracción del tick en curso (0..1): posición del "ahora" entre los dos últimos cuadros. */
  alpha = 0
  /** Se incrementa al vaciar el buffer (reinicio de la simulación). */
  epoch = 0
  /** Cuántas veces se puso a correr la simulación: un replay en pausa deja de valer al arrancar. */
  runs = 0

  markRun() {
    this.runs++
  }
  private buf: (Frame | undefined)[]
  private head = 0
  private size = 0

  readonly capacity: number

  constructor(capacity = 1200) {
    this.capacity = capacity
    this.buf = new Array<Frame | undefined>(capacity)
  }

  get length() {
    return this.size
  }

  /** Cuadro i-ésimo, 0 = el más antiguo. */
  frame(i: number): Frame {
    return this.buf[(this.head + i) % this.capacity]!
  }

  get first(): Frame | null {
    return this.size ? this.frame(0) : null
  }

  get last(): Frame | null {
    return this.size ? this.frame(this.size - 1) : null
  }

  push(sim: CellSimulation) {
    const t = sim.state.t
    if (this.size && t < this.frame(this.size - 1).t - 1e-9) this.clear() // el tiempo retrocedió: reinicio
    if (this.size && Math.abs(t - this.frame(this.size - 1).t) < 1e-9) return // mismo instante
    const f: Frame = { t, state: snapshotState(sim.state) }
    if (this.size < this.capacity) {
      this.buf[(this.head + this.size) % this.capacity] = f
      this.size++
    } else {
      this.buf[this.head] = f
      this.head = (this.head + 1) % this.capacity
    }
  }

  clear() {
    this.buf = new Array<Frame | undefined>(this.capacity)
    this.head = 0
    this.size = 0
    this.alpha = 0
    this.epoch++
  }

  /** Activa o desactiva la captura. Al activarla guarda de inmediato el cuadro actual. */
  setEnabled(on: boolean, sim: CellSimulation) {
    if (on === this.enabled) return
    this.enabled = on
    if (on) this.push(sim)
    else this.clear()
  }

  /** Índice del último cuadro con t <= time (−1 si time es anterior al primero). */
  indexAt(time: number): number {
    let lo = 0
    let hi = this.size - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.frame(mid).t <= time + 1e-9) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans
  }

  covers(time: number) {
    return this.size > 0 && time >= this.frame(0).t - 1e-9 && time <= this.frame(this.size - 1).t + 1e-9
  }

  /** Estado en un instante cualquiera, interpolado entre los dos cuadros que lo rodean. */
  stateAt(time: number): SimState | null {
    if (!this.size) return null
    const i = this.indexAt(time)
    if (i < 0) return this.frame(0).state
    if (i >= this.size - 1) return this.frame(this.size - 1).state
    const a = this.frame(i)
    const b = this.frame(i + 1)
    return lerpState(a.state, b.state, (time - a.t) / (b.t - a.t))
  }

  /**
   * Estado "en vivo" suavizado: entre los dos últimos cuadros según la fracción del tick en curso.
   * Devuelve null si no hay dos cuadros contiguos (el que llama usa el estado del motor).
   */
  liveState(): SimState | null {
    if (this.size < 2) return null
    const a = this.frame(this.size - 2)
    const b = this.frame(this.size - 1)
    if (b.t - a.t > 0.25) return null // cuadros espaciados (avance rápido o paso a paso): sin interpolar
    return lerpState(a.state, b.state, this.alpha)
  }
}

/**
 * Vista de sólo lectura de la celda en un instante grabado: un objeto que hereda del motor (params,
 * estaciones y métodos de dibujo) pero cuyo `state` es el cuadro. No modifica el motor original.
 */
export function replayView(sim: CellSimulation, state: SimState): CellSimulation {
  return Object.create(sim, { state: { value: state, enumerable: true } }) as CellSimulation
}

/** Cada cuántos ticks se guarda un cuadro: a velocidades altas no hace falta uno por tick. */
export function frameStride(speed: number): number {
  return speed <= 10 ? 1 : Math.round(speed / 10)
}
