import { describe, expect, it } from 'vitest'
import { carouselStations, computeBalance, interlockThreshold, minCarouselCycle } from './balance'
import { CellSimulation } from './engine'
import { DEFAULT_PARAMS, type SimParams } from './params'
import { HDPE, levelDropFor, submergedFraction } from './physics'

/** Configuración limitada por el carrusel (12 posiciones) para aislar el enclavamiento térmico. */
const FLUSH: SimParams = { ...DEFAULT_PARAMS, bathPods: 8 } // nivel al ras del eje (caso anterior)
const CAROUSEL_BOUND: Partial<SimParams> = { slots: 12 }

const run = (over: Partial<SimParams>, seconds: number) => {
  const sim = new CellSimulation({ ...DEFAULT_PARAMS, variability: 0, ...over })
  sim.advance(seconds)
  return sim
}

describe('balance de línea', () => {
  it('valores nominales: 16 posiciones, glicerina 132 °C, retiro a 120 °C, τ 75 s', () => {
    expect(DEFAULT_PARAMS.slots).toBe(16)
    expect(DEFAULT_PARAMS.bathPods).toBe(7.5) // las resistencias del fondo dejan entrar 7–8 vainas
    expect(DEFAULT_PARAMS.bathTemp).toBe(132)
    expect(DEFAULT_PARAMS.targetTemp).toBe(120)
    expect(DEFAULT_PARAMS.bathTau).toBe(75)
  })

  it('retención mínima por estación para 25 → 120 °C con baño a 132 °C', () => {
    const b = computeBalance(FLUSH)
    // 75 s · ln(107/12) ≈ 164 s sumergido, repartidos en 8 posiciones equivalentes
    expect(b.heatTime).toBeGreaterThan(160)
    expect(b.heatTime).toBeLessThan(170)
    expect(b.cycleCarousel).toBeGreaterThan(20)
    expect(b.cycleCarousel).toBeLessThan(21.5)
    // con 7,5 vainas mojadas el mismo calor se reparte en menos posiciones: más retención por estación
    const real = computeBalance(DEFAULT_PARAMS)
    expect(Math.abs(real.heatTime - b.heatTime)).toBeLessThan(3)
    expect(real.cycleCarousel).toBeGreaterThan(b.cycleCarousel)
  })

  it('con el nivel al ras (8 vainas) el carrusel no es el cuello de botella: manda operario + prensa', () => {
    const b = computeBalance(FLUSH)
    expect(b.cycleCarousel).toBeLessThan(b.cycleOperator)
    expect(b.bottleneck).toBe('prensa')
    expect(b.cycle).toBeCloseTo(b.cycleOperator, 6)
    expect(b.cycle).toBeCloseTo(22.9, 6) // paso 10 (9 s) + pasos 1–9 (13,9 s)
    expect(b.capacityPerHour).toBeGreaterThan(150)
    expect(b.meetsGoal).toBe(true)
    expect(b.demoldTemp).toBeLessThan(50)
    // con más tiempo en el baño del necesario, el caño sale algo por encima de la consigna
    expect(b.pickTemp).toBeGreaterThan(DEFAULT_PARAMS.targetTemp)
    expect(b.pickTemp).toBeLessThan(HDPE.softeningWarn)
  })

  it('media vuelta sumergida: 16 → 8, 12 → 6 y 10 → 5 posiciones equivalentes en glicerina', () => {
    expect(computeBalance(FLUSH).submergedPositions).toBeCloseTo(8, 5)
    expect(computeBalance({ ...FLUSH, slots: 12 }).submergedPositions).toBeCloseTo(6, 5)
    expect(computeBalance({ ...FLUSH, slots: 10 }).submergedPositions).toBeCloseTo(5, 5)
  })

  it('vainas simultáneas en la glicerina: el nivel baja del eje y cambia la cantidad mojada y el ciclo', () => {
    const at = (bathPods: number) => computeBalance({ ...DEFAULT_PARAMS, bathPods })
    expect(at(8).submergedPositions).toBeCloseTo(8, 5)
    expect(at(7.5).submergedPositions).toBeCloseTo(7.5, 3)
    expect(at(7).submergedPositions).toBeCloseTo(7, 3)
    expect(at(6.5).submergedPositions).toBeCloseTo(6.5, 3)
    expect(levelDropFor(8, 16)).toBeCloseTo(0, 9)
    expect(levelDropFor(7, 16)).toBeGreaterThan(levelDropFor(7.5, 16))
    expect(levelDropFor(7.5, 16)).toBeGreaterThan(0)
    expect(levelDropFor(7.5, 16)).toBeLessThan(20) // 7–8 vainas: el nivel baja menos de un radio de caño
    // menos vainas en el baño → más retención por estación → ciclo de carrusel mayor
    expect(at(7).cycleCarousel).toBeGreaterThan(at(7.5).cycleCarousel)
    expect(at(7.5).cycleCarousel).toBeGreaterThan(at(8).cycleCarousel)
    // el nivel nunca sube del eje, aunque se pida más
    expect(levelDropFor(10, 16)).toBe(0)
  })

  it('con 7–8 vainas el ciclo se sostiene; por debajo de ~7,3 el carrusel pasa a ser el cuello de botella', () => {
    const at = (bathPods: number) => computeBalance({ ...DEFAULT_PARAMS, bathPods })
    for (const pods of [7, 7.5, 8]) {
      const b = at(pods)
      expect(Number.isFinite(b.cycle)).toBe(true) // incluido 7,0: la vaina del borde queda seca y se retira al emerger
      expect(b.pickTemp).toBeGreaterThan(119.9)
    }
    expect(at(7.5).bottleneck).toBe('prensa')
    expect(at(7.5).cycle).toBeCloseTo(22.9, 6)
    expect(at(6.5).bottleneck).toBe('carrusel')
    expect(at(6.5).cycle).toBeGreaterThan(24)
  })

  it('retiro inmediato: sin arco aéreo, el caño se retira a la consigna de conformado', () => {
    expect(computeBalance(DEFAULT_PARAMS).airLoss).toBeLessThan(0.1)
    expect(interlockThreshold(DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.targetTemp)
    // limitado por el carrusel, el caño sale justo a la consigna
    const b = computeBalance({ ...DEFAULT_PARAMS, ...CAROUSEL_BOUND })
    expect(b.bottleneck).toBe('carrusel')
    expect(b.pickTemp).toBeGreaterThan(119.9)
    expect(b.pickTemp).toBeLessThan(120.1)
  })

  it('retirar al emerger acorta la retención frente a retirar en el cenit con margen de +2 °C', () => {
    const b = computeBalance(DEFAULT_PARAMS)
    const legacy = minCarouselCycle(DEFAULT_PARAMS, 6, DEFAULT_PARAMS.targetTemp + 2)
    expect(b.cycleCarousel).toBeLessThan(legacy * 0.95)
  })

  it('la estación de carga (cenit o antes del baño) no cambia el ciclo: sólo agrega posiciones al aire', () => {
    const top = computeBalance(DEFAULT_PARAMS)
    const pre = computeBalance({ ...DEFAULT_PARAMS, loadStation: 'preEntry' })
    expect(pre.cycle).toBeCloseTo(top.cycle, 6)
    expect(pre.airBeforeBath).toBe(0)
    expect(top.airBeforeBath).toBeGreaterThan(0)
    expect(pre.inBath).toBeCloseTo(top.inBath, 6)
  })

  it('un τ sumergido menor acorta el ciclo del carrusel', () => {
    const slow = computeBalance(DEFAULT_PARAMS)
    const fast = computeBalance({ ...DEFAULT_PARAMS, bathTau: 55 })
    expect(fast.cycleCarousel).toBeLessThan(slow.cycleCarousel)
    expect(fast.capacityPerHour).toBeGreaterThanOrEqual(slow.capacityPerHour)
  })
})

describe('estaciones del carrusel', () => {
  it('RETIRO en la primera posición completamente emergida del lado que sube', () => {
    for (const [n, angle] of [
      [18, 80],
      [16, 67.5],
      [12, 60],
      [11, (2 * 360) / 11],
      [10, 72],
    ] as const) {
      const st = carouselStations(n, 'top')
      expect(st.pickAngle).toBeCloseTo(angle, 6)
      expect(submergedFraction(st.pickAngle)).toBe(0)
      expect(submergedFraction(st.pickAngle + st.step)).toBeGreaterThan(0)
    }
  })

  it('geometría nominal: 16 posiciones cada 22,5°, RETIRO a 67,5° y CARGA en el cenit', () => {
    const st = carouselStations(16, 'top')
    expect(st.step).toBe(22.5)
    expect(st.pickAngle).toBe(67.5)
    expect(st.pickK).toBe(3)
    expect(st.loadAngle).toBe(0)
    expect(st.journey).toBe(13)
    // 8 caños bajo el nivel: 7 completos (112,5°…247,5°) + los dos a medias en 90° y 270°
    const angles = Array.from({ length: 16 }, (_, k) => k * 22.5)
    expect(angles.filter((a) => submergedFraction(a) === 1)).toHaveLength(7)
    expect(angles.filter((a) => Math.abs(submergedFraction(a) - 0.5) < 1e-9)).toEqual([90, 270])
    expect(angles.reduce((acc, a) => acc + submergedFraction(a), 0)).toBeCloseTo(8, 6)
    expect(carouselStations(16, 'preEntry').loadAngle).toBe(292.5)
  })

  it('CARGA FRÍO en el cenit o en la última posición al aire antes del baño', () => {
    expect(carouselStations(12, 'top').loadAngle).toBe(0)
    const pre = carouselStations(12, 'preEntry')
    expect(pre.loadAngle).toBe(300)
    expect(submergedFraction(pre.loadAngle)).toBe(0)
    expect(submergedFraction(pre.loadAngle - pre.step)).toBeGreaterThan(0)
    expect(carouselStations(10, 'preEntry').loadAngle).toBe(288)
  })

  it('el operario retira en la salida del baño y carga en la estación de carga', () => {
    const sim = new CellSimulation({ ...DEFAULT_PARAMS, variability: 0 })
    let picked = false
    let loaded = false
    for (let i = 0; i < 60 && !(picked && loaded); i++) {
      const task = sim.state.operator.task
      const pickIdx = sim.pickSlot()
      const loadIdx = sim.loadSlot()
      const before = sim.state.slots[pickIdx]
      sim.stepToNextEvent()
      if (task === 'PICK' && sim.state.operator.carrying) {
        expect(sim.state.operator.carrying).toBe(before)
        expect(submergedFraction(sim.slotAngle(pickIdx), levelDropFor(sim.params.bathPods, 16))).toBe(0)
        picked = true
      }
      if (task === 'LOAD' && sim.state.operator.task !== 'LOAD') {
        expect(sim.state.slots[loadIdx]?.temp).toBe(DEFAULT_PARAMS.ambientTemp)
        loaded = true
      }
    }
    expect(picked && loaded).toBe(true)
  })

  it('el carrusel nunca gira con un caño esperando en el RETIRO', () => {
    const sim = new CellSimulation(DEFAULT_PARAMS)
    for (let i = 0; i < 20000; i++) {
      const idle = sim.state.indexProgress === null
      sim.advance(0.1)
      if (idle && sim.state.indexProgress !== null) {
        // el giro acaba de empezar: el retiro tenía que estar vacío y la carga completa
        expect(sim.state.slots[sim.pickSlot()]).toBeNull()
        expect(sim.state.slots[sim.loadSlot()]).not.toBeNull()
      }
    }
  })
})

describe('simulación', () => {
  it('régimen continuo nominal (16 pos.): jornada completa sin alarmas ni scrap', () => {
    const sim = new CellSimulation(DEFAULT_PARAMS) // con la variabilidad nominal de 10 %
    sim.advance(DEFAULT_PARAMS.shiftHours * 3600)
    const s = sim.state
    const b = computeBalance(DEFAULT_PARAMS)
    expect(s.alarmCounts.OVERHEAT + s.alarmCounts.SOFTENING + s.alarmCounts.PICK_COLD + s.alarmCounts.DEMOLD_HOT).toBe(0)
    expect(s.scrap).toBe(0)
    expect(s.good).toBeGreaterThan(b.capacityPerDay * 0.9)
    expect(sim.metrics().avgCycle!).toBeLessThan(b.cycle * 1.1)
    expect(s.lastPick!.temp).toBeGreaterThanOrEqual(DEFAULT_PARAMS.targetTemp - 0.3)
    expect(s.lastPick!.temp).toBeLessThan(HDPE.softeningWarn)
  })

  it('produce en régimen cerca del ciclo teórico y sin alarmas', () => {
    const sim = run({}, 3600)
    const b = computeBalance(DEFAULT_PARAMS)
    const s = sim.state
    expect(s.good).toBeGreaterThan(b.capacityPerHour * 0.9)
    expect(s.scrap).toBe(0)
    expect(s.alarmCounts.OVERHEAT + s.alarmCounts.SOFTENING + s.alarmCounts.PICK_COLD + s.alarmCounts.DEMOLD_HOT).toBe(0)
  })

  it('alarma de caño frío sin enclavamiento de temperatura', () => {
    // con 10 posiciones el ritmo del operario no deja tiempo de inmersión suficiente
    const sim = run({ tempInterlock: false, slots: 10 }, 1800)
    expect(sim.state.alarmCounts.PICK_COLD).toBeGreaterThan(0)
    expect(sim.state.scrapBy.frio).toBeGreaterThan(0)
  })

  it('línea detenida > 90 s con baño a 132 °C: advertencia de reblandecimiento, sin scrap crítico', () => {
    const sim = run({}, 60)
    sim.togglePause()
    sim.advance(1800)
    const s = sim.state
    expect(s.alarmCounts.SOFTENING).toBeGreaterThan(0)
    expect(s.alarmCounts.OVERHEAT).toBe(0)
    expect(sim.lineStoppedFor()).toBeGreaterThan(HDPE.stopWarnSeconds)
    const hottest = Math.max(...s.slots.map((t) => t?.temp ?? 0))
    expect(hottest).toBeGreaterThan(HDPE.softeningWarn)
    expect(hottest).toBeLessThan(DEFAULT_PARAMS.bathTemp)
  })

  it('la advertencia de reblandecimiento exige detención: no aparece antes de 90 s sin indexar', () => {
    const sim = run({}, 60)
    sim.togglePause()
    let firstWarning = Infinity
    for (let i = 0; i < 1200 && firstWarning === Infinity; i++) {
      sim.advance(1)
      if (sim.state.alarmCounts.SOFTENING > 0) firstWarning = sim.lineStoppedFor()
    }
    expect(firstWarning).toBeGreaterThan(HDPE.stopWarnSeconds)
  })

  it('alarma de sobrecalentamiento si la batea está sobre 135 °C y el operario se detiene', () => {
    const sim = run({ bathTemp: 145 }, 60)
    sim.togglePause()
    sim.advance(900)
    expect(sim.state.operator.task).toBe('PAUSED')
    expect(sim.state.alarmCounts.OVERHEAT).toBeGreaterThan(0)
  })

  it('agua del tanque a 45 °C: la apertura sube pero queda dentro del límite de 80 °C (sin scrap)', () => {
    const sim = run({ waterInitTemp: 45 }, 600)
    expect(sim.state.lastDemold!.temp).toBeGreaterThan(50) // con el límite viejo era scrap
    expect(sim.state.lastDemold!.temp).toBeLessThanOrEqual(HDPE.demoldMax)
    expect(sim.state.alarmCounts.DEMOLD_HOT).toBe(0)
    expect(sim.state.scrap).toBe(0)
  })

  it('templado demasiado corto (2 s): apertura > 80 °C → scrap y alarma', () => {
    const sim = run({ seqWaterMs: 2000 }, 600)
    expect(sim.state.lastDemold!.temp).toBeGreaterThan(HDPE.demoldMax)
    expect(sim.state.alarmCounts.DEMOLD_HOT).toBeGreaterThan(0)
    expect(sim.state.scrapBy['desmoldeo-caliente']).toBe(sim.state.scrap)
    expect(sim.state.good).toBe(0)
  })

  it('modo sensor evita el desmoldeo caliente extendiendo la inyección', () => {
    const sim = run({ waterInitTemp: 38, coolingMode: 'sensor' }, 1200)
    expect(sim.state.alarmCounts.DEMOLD_HOT).toBe(0)
    expect(sim.state.good).toBeGreaterThan(0)
  })

  it('arranque en frío llena el recorrido carga → retiro y luego produce', () => {
    const sim = run({ coldStart: true }, 2400)
    const { loadK, journey } = sim.stations
    const n = sim.state.slots.length
    // Posiciones j = 1..J−1 desde la carga (las del recorrido) ocupadas; tras el retiro viajan vacías.
    for (let j = 1; j < journey; j++) {
      const k = (((loadK - j) % n) + n) % n
      expect(sim.state.slots[(sim.state.station + k) % n]).not.toBeNull()
    }
    expect(sim.state.slots.filter((x) => x !== null).length).toBeLessThan(n)
    expect(sim.state.good).toBeGreaterThan(10)
  })

  it('cada caño arrastra glicerina de la batea al agua de lavado', () => {
    const sim = run({}, 3600)
    const s = sim.state
    const injected = s.good + s.scrap + (s.press.tube ? 1 : 0)
    expect(s.tank.glycerinMl).toBeGreaterThanOrEqual(3 * (s.good + s.scrap))
    expect(s.tank.glycerinMl).toBeLessThanOrEqual(3 * injected)
    expect(s.bath.volumeL).toBeLessThan(120)
  })

  it('con enclavamiento el caño se retira a la consigna al emerger y el ciclo sigue al balance', () => {
    const sim = run(CAROUSEL_BOUND, 3600)
    const b = computeBalance({ ...DEFAULT_PARAMS, ...CAROUSEL_BOUND })
    expect(sim.state.lastPick!.temp).toBeGreaterThanOrEqual(DEFAULT_PARAMS.targetTemp - 0.3)
    expect(sim.state.lastPick!.temp).toBeLessThan(DEFAULT_PARAMS.targetTemp + 1.5)
    expect(sim.metrics().avgCycle!).toBeLessThan(b.cycle * 1.1)
    expect(sim.state.scrap).toBe(0)
  })

  it('el enclavamiento evalúa el caño que va a emerger y retiene el giro (espera de temperatura)', () => {
    const sim = run({ bathTau: 110 }, 1800)
    expect(sim.state.opTime.WAIT_TEMP).toBeGreaterThan(0)
    expect(sim.state.scrapBy.frio).toBe(0)
  })

  it('carga antes del baño: mismo ritmo de producción que cargando en el cenit', () => {
    const top = run({}, 3600).state.good
    const pre = run({ loadStation: 'preEntry' }, 3600).state.good
    expect(Math.abs(top - pre)).toBeLessThanOrEqual(2)
  })

  it('el tanque acumula calor sin sistema de enfriamiento', () => {
    const sim = run({ tankCooling: 'none' }, 3600)
    expect(sim.state.tank.temp).toBeGreaterThan(DEFAULT_PARAMS.waterInitTemp + 1.5)
  })

  it('paso a paso avanza hasta el próximo evento', () => {
    const sim = new CellSimulation(DEFAULT_PARAMS)
    const seq = sim.state.seq
    sim.stepToNextEvent()
    expect(sim.state.seq).toBeGreaterThan(seq)
    expect(sim.state.t).toBeGreaterThan(0)
  })
})
