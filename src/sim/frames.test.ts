import { describe, expect, it } from 'vitest'
import { CellSimulation, DT } from './engine'
import { FrameBuffer, frameStride, lerpState, snapshotState } from './frames'
import { DEFAULT_PARAMS } from './params'

const fresh = () => new CellSimulation({ ...DEFAULT_PARAMS, variability: 0 })

describe('grabación de cuadros (cámara del Modo Render)', () => {
  it('capturar cuadros no altera la simulación (mismos resultados con y sin buffer)', () => {
    const plain = fresh()
    const filmed = fresh()
    const buf = new FrameBuffer(300)
    buf.enabled = true
    for (let i = 0; i < 3000; i++) {
      plain.advance(DT)
      filmed.advance(DT)
      buf.push(filmed)
    }
    const a = plain.state
    const b = filmed.state
    expect(b.t).toBe(a.t)
    expect(b.good).toBe(a.good)
    expect(b.scrap).toBe(a.scrap)
    expect(b.tank.temp).toBe(a.tank.temp)
    expect(b.bath.temp).toBe(a.bath.temp)
    expect(b.press.step).toBe(a.press.step)
    expect(b.slots.map((t) => t?.temp)).toEqual(a.slots.map((t) => t?.temp))
    expect(b.alarmCounts).toEqual(a.alarmCounts)
  })

  it('cada cuadro es una copia: lo que la simulación cambie después no lo modifica', () => {
    const sim = fresh()
    sim.advance(30)
    const buf = new FrameBuffer(50)
    buf.push(sim)
    const before = buf.last!
    const tempsBefore = before.state.slots.map((t) => t?.temp)
    const dieBefore = before.state.press.act.die
    const tBefore = before.state.t
    sim.advance(60)
    expect(before.state.t).toBe(tBefore)
    expect(before.state.slots.map((t) => t?.temp)).toEqual(tempsBefore)
    expect(before.state.press.act.die).toBe(dieBefore)
    // y no arrastra las series pesadas
    expect(before.state.history).toHaveLength(0)
    expect(before.state.alarms).toHaveLength(0)
  })

  it('buffer circular: descarta lo más antiguo y conserva el orden', () => {
    const sim = fresh()
    const buf = new FrameBuffer(50)
    for (let i = 0; i < 120; i++) {
      sim.advance(DT)
      buf.push(sim)
    }
    expect(buf.length).toBe(50)
    expect(buf.last!.t).toBeCloseTo(12, 6)
    expect(buf.first!.t).toBeCloseTo(12 - 4.9, 6)
    for (let i = 1; i < buf.length; i++) expect(buf.frame(i).t).toBeGreaterThan(buf.frame(i - 1).t)
    expect(buf.indexAt(10)).toBe(buf.indexAt(10.04)) // entre cuadros: el anterior
    expect(buf.covers(10)).toBe(true)
    expect(buf.covers(3)).toBe(false)
  })

  it('un reinicio (el tiempo retrocede) vacía el buffer', () => {
    const sim = fresh()
    const buf = new FrameBuffer(50)
    for (let i = 0; i < 20; i++) {
      sim.advance(DT)
      buf.push(sim)
    }
    const epoch = buf.epoch
    sim.reset()
    sim.advance(DT)
    buf.push(sim)
    expect(buf.epoch).toBe(epoch + 1)
    expect(buf.length).toBe(1)
    expect(buf.last!.t).toBeCloseTo(0.1, 6)
  })

  it('interpola cilindros, reloj y temperaturas entre dos cuadros', () => {
    const sim = fresh()
    const buf = new FrameBuffer(400)
    // hasta el paso 1 (matriz cerrando)
    while (sim.state.press.step === 10) {
      sim.advance(DT)
      buf.push(sim)
    }
    for (let i = 0; i < 6; i++) {
      sim.advance(DT)
      buf.push(sim)
    }
    const a = buf.frame(buf.length - 2)
    const b = buf.last!
    expect(b.state.press.act.die).toBeGreaterThan(a.state.press.act.die)
    const mid = buf.stateAt((a.t + b.t) / 2)!
    expect(mid.t).toBeCloseTo((a.t + b.t) / 2, 9)
    expect(mid.press.act.die).toBeCloseTo((a.state.press.act.die + b.state.press.act.die) / 2, 9)
    const ta = a.state.press.tube!.temp
    const tb = b.state.press.tube!.temp
    expect(mid.press.tube!.temp).toBeCloseTo((ta + tb) / 2, 9)
    // los extremos devuelven los cuadros originales
    expect(buf.stateAt(a.t)!.press.act.die).toBe(a.state.press.act.die)
    expect(buf.stateAt(1e9)!.t).toBe(b.t)
    expect(buf.stateAt(-5)!.t).toBe(buf.first!.t)
  })

  it('interpolación del carrusel: posición continua, también al pasar de la última a la primera posición', () => {
    const sim = fresh()
    const n = sim.state.slots.length
    const a = snapshotState(sim.state)
    const b = snapshotState(sim.state)
    a.station = n - 1
    a.indexProgress = 0.9
    b.station = 0
    b.indexProgress = null
    // n − 1 + 0,9 → n (= 0): a mitad de camino queda en n − 1 + 0,95
    const mid = lerpState(a, b, 0.5)
    expect(mid.station).toBe(n - 1)
    expect(mid.indexProgress).toBeCloseTo(0.95, 9)
    const end = lerpState(a, b, 1)
    expect(end.station).toBe(0)
    expect(end.indexProgress).toBeNull()
    // sin giro en ninguno de los dos: se conserva la posición
    a.indexProgress = null
    a.station = 3
    b.station = 3
    expect(lerpState(a, b, 0.5).indexProgress).toBeNull()
  })

  it('estado en vivo suavizado: entre los dos últimos cuadros según la fracción del tick', () => {
    const sim = fresh()
    const buf = new FrameBuffer(50)
    expect(buf.liveState()).toBeNull() // sin cuadros suficientes
    for (let i = 0; i < 5; i++) {
      sim.advance(DT)
      buf.push(sim)
    }
    const a = buf.frame(buf.length - 2)
    const b = buf.last!
    buf.alpha = 0.25
    expect(buf.liveState()!.t).toBeCloseTo(a.t + 0.25 * (b.t - a.t), 9)
    buf.alpha = 0
    expect(buf.liveState()!.t).toBeCloseTo(a.t, 9)
    // cuadros muy espaciados (avance rápido o paso a paso): no se interpola
    sim.advance(5)
    buf.push(sim)
    expect(buf.liveState()).toBeNull()
  })

  it('activar y desactivar la captura: al activar guarda el cuadro actual, al desactivar libera todo', () => {
    const sim = fresh()
    sim.advance(10)
    const buf = new FrameBuffer(50)
    expect(buf.enabled).toBe(false)
    buf.setEnabled(true, sim)
    expect(buf.length).toBe(1)
    expect(buf.last!.t).toBeCloseTo(10, 6)
    buf.setEnabled(false, sim)
    expect(buf.length).toBe(0)
  })

  it('un motor "espejo" dibuja un cuadro grabado igual que el motor original en ese instante', () => {
    const sim = fresh()
    sim.advance(47.3)
    const buf = new FrameBuffer(10)
    buf.push(sim)
    const angles = sim.state.slots.map((_, i) => sim.slotAngle(i))
    const pick = sim.pickSlot()
    const load = sim.loadSlot()
    sim.advance(20) // la simulación sigue
    const viewer = new CellSimulation(sim.params)
    viewer.state = buf.last!.state
    expect(viewer.state.slots.map((_, i) => viewer.slotAngle(i))).toEqual(angles)
    expect(viewer.pickSlot()).toBe(pick)
    expect(viewer.loadSlot()).toBe(load)
  })

  it('velocidades altas guardan un cuadro cada varios ticks', () => {
    expect(frameStride(0.25)).toBe(1)
    expect(frameStride(1)).toBe(1)
    expect(frameStride(10)).toBe(1)
    expect(frameStride(30)).toBe(3)
    expect(frameStride(60)).toBe(6)
  })
})

describe('vista de reproducción y corridas', () => {
  it('replayView muestra otro estado sin mutar el motor', async () => {
    const { replayView } = await import('./frames')
    const sim = fresh()
    const buf = new FrameBuffer(50)
    buf.enabled = true
    for (let i = 0; i < 100; i++) {
      sim.advance(DT)
      buf.push(sim)
    }
    const tNow = sim.state.t
    const past = buf.stateAt(buf.first!.t)!
    const view = replayView(sim, past)
    expect(view.state.t).toBe(past.t)
    expect(sim.state.t).toBe(tNow)
  })

  it('markRun incrementa runs (invalida el cursor de reproducción)', () => {
    const buf = new FrameBuffer(10)
    const r = buf.runs
    buf.markRun()
    expect(buf.runs).toBe(r + 1)
  })
})
