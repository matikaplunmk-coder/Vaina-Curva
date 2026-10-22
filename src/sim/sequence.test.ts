import { describe, expect, it } from 'vitest'
import { parseParamsJson } from '../hooks/paramStore'
import { computeBalance, tankForecast } from './balance'
import { CellSimulation } from './engine'
import { DEFAULT_PARAMS, presetParams, sanitizeParams, type SimParams } from './params'
import { classifyDemold, HDPE } from './physics'
import { ALL_OFF, checkOutput, clampEstimate, HOME_ACTUATORS, machineTime, readInputs, stepDurations, type PressStep } from './sequence'

const nominal = (over: Partial<SimParams> = {}) => new CellSimulation({ ...DEFAULT_PARAMS, variability: 0, ...over })

describe('secuencia de 10 pasos', () => {
  it('tiempos nominales: 13,9 s de máquina + 9 s de operario = ciclo de 22,9 s', () => {
    const d = stepDurations(DEFAULT_PARAMS)
    expect(d[1]).toBeCloseTo(1.6, 9) // 1400 ms + 200 ms de asentamiento
    expect([d[2], d[3], d[4], d[5], d[6], d[7], d[8], d[9], d[10]]).toEqual([0.4, 1, 0.3, 7, 1, 0.8, 0.3, 1.5, 9])
    expect(machineTime(DEFAULT_PARAMS)).toBeCloseTo(13.9, 9)
    const b = computeBalance(DEFAULT_PARAMS)
    expect(b.cycle).toBeCloseTo(22.9, 9)
    expect(b.capacityPerDay).toBeGreaterThan(1240)
  })

  it('la máquina de estados recorre los pasos 1 → 10 en orden, ciclo tras ciclo', () => {
    const sim = nominal()
    sim.advance(600)
    const log = sim.state.press.stepLog.map((e) => e.step)
    expect(log.length).toBeGreaterThan(40)
    for (let i = 1; i < log.length; i++) expect(log[i]).toBe(((log[i - 1] % 10) + 1) as PressStep)
    expect(new Set(log)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
  })

  it('cada paso arranca con sus condiciones: agua con cono asentado, mordaza libre sólo con cono atrás', () => {
    const sim = nominal()
    sim.advance(900)
    const log = sim.state.press.stepLog
    for (const e of log) {
      if (e.step === 2) expect(e.inputs.B1).toBe(true) // matriz cerrada
      if (e.step === 5) expect(e.inputs.B3 && e.inputs.B2).toBe(true) // cono asentado y mordaza trabada
      if (e.step === 8) expect(e.inputs.B4).toBe(true) // estricto: después del retroceso del mandril
      if (e.step === 9) expect(e.inputs.B4 && e.inputs.B5).toBe(true)
      if (e.step === 10) expect(e.inputs.B6).toBe(true)
    }
  })

  it('invariantes de seguridad en cada paso de integración', () => {
    const sim = nominal()
    let prevClamp = sim.state.press.act.clamp
    for (let i = 0; i < 9000; i++) {
      sim.advance(0.1)
      const { act, out } = sim.state.press
      const b = readInputs(act)
      expect(out.Y4 && !b.B3).toBe(false) // nunca agua sin cono asentado
      if (act.clamp < prevClamp) expect(act.mandrel).toBe(0) // la mordaza sólo abre con el cono atrás
      expect(out.Y4 && out.Y5).toBe(false)
      prevClamp = act.clamp
    }
  })

  it('la duración de cada paso en la simulación respeta la configuración', () => {
    const sim = nominal({ seqWaterMs: 9000, seqOpenMs: 2000 })
    sim.advance(300)
    const log = sim.state.press.stepLog
    const d = stepDurations(sim.params)
    for (let i = 1; i < log.length; i++) {
      const prev = log[i - 1]
      if (prev.step === 10) continue // el paso 10 depende del operario
      expect(log[i].t - prev.t).toBeCloseTo(d[prev.step], 0)
      expect(Math.abs(log[i].t - prev.t - d[prev.step])).toBeLessThanOrEqual(0.101)
    }
  })

  it('la campana se abocarda con el cono (pasos 3–4) y queda conformada tras el retroceso (paso 7)', () => {
    const sim = nominal()
    const flareAt: Partial<Record<number, number>> = {}
    for (let i = 0; i < 600 && flareAt[9] === undefined; i++) {
      const before = sim.state.press.step
      sim.advance(0.1)
      const now = sim.state.press.step
      if (now !== before) flareAt[now] = sim.state.press.flare
    }
    expect(flareAt[3]).toBe(0) // pasos 1–2: mandril atrás, boca sin conformar
    expect(flareAt[5]).toBe(1) // cono asentado: campana contra la matriz
    expect(flareAt[9]).toBe(1) // después del retroceso la campana permanece
    expect(sim.state.press.act.mandrel).toBe(0)
  })

  it('el templado (paso 5) llena la L y rebalsa al vaso colector', () => {
    const sim = nominal()
    let sawOverflow = false
    for (let i = 0; i < 400 && !sawOverflow; i++) {
      sim.advance(0.1)
      if (sim.state.press.step === 5 && sim.state.press.overflow) sawOverflow = true
    }
    expect(sawOverflow).toBe(true)
    expect(sim.state.press.fill).toBe(1)
  })
})

describe('enclavamientos del PLC', () => {
  it('reglas puras: agua sin cono asentado y mordaza abierta con cono adentro están bloqueadas', () => {
    const home = { ...HOME_ACTUATORS }
    expect(checkOutput('Y4', true, home, ALL_OFF).ok).toBe(false)
    const seated = { die: 1, clamp: 1, mandrel: 1 }
    expect(checkOutput('Y4', true, seated, { ...ALL_OFF, Y1: true, Y2: true, Y3: true }).ok).toBe(true)
    expect(checkOutput('Y2', false, seated, { ...ALL_OFF, Y1: true, Y2: true }).ok).toBe(false)
    expect(checkOutput('Y2', false, { die: 1, clamp: 1, mandrel: 0 }, { ...ALL_OFF, Y1: true, Y2: true }).ok).toBe(true)
  })

  it('forzado manual: el motor impide activar el agua sin cono y abrir la mordaza con el cono adentro', () => {
    const sim = nominal()
    const press = sim.state.press
    expect(sim.setManual(true).ok).toBe(true)

    // Agua sin cono asentado → rechazado, la salida no cambia.
    const r1 = sim.forceOutput('Y4', true)
    expect(r1.ok).toBe(false)
    expect(r1.reason).toMatch(/B3/)
    expect(press.out.Y4).toBe(false)
    expect(sim.state.alarmCounts.INTERLOCK).toBe(1)

    // Mandril sin matriz cerrada → rechazado.
    expect(sim.forceOutput('Y3', true).ok).toBe(false)

    // Secuencia válida: cerrar matriz, trabar mordaza, asentar cono, dar agua.
    expect(sim.forceOutput('Y1', true).ok).toBe(true)
    sim.advance(2)
    expect(sim.forceOutput('Y2', true).ok).toBe(true)
    sim.advance(1)
    expect(sim.forceOutput('Y3', true).ok).toBe(true)
    sim.advance(2)
    expect(sim.inputs().B3).toBe(true)
    expect(sim.forceOutput('Y4', true).ok).toBe(true)

    // Con el cono adentro: abrir la mordaza y retroceder con agua están bloqueados.
    const r2 = sim.forceOutput('Y2', false)
    expect(r2.ok).toBe(false)
    expect(r2.reason).toMatch(/cono adentro/)
    expect(sim.forceOutput('Y3', false).ok).toBe(false)
    expect(sim.forceOutput('Y1', false).ok).toBe(false)
    expect(press.out.Y2 && press.out.Y3 && press.out.Y4).toBe(true)

    // Cortar agua, retroceder y recién ahí liberar la mordaza.
    expect(sim.forceOutput('Y4', false).ok).toBe(true)
    expect(sim.forceOutput('Y3', false).ok).toBe(true)
    sim.advance(1.5)
    expect(sim.inputs().B4).toBe(true)
    expect(sim.forceOutput('Y2', false).ok).toBe(true)
  })

  it('al volver a automático la estación regresa sola a reposo en orden seguro', () => {
    const sim = nominal()
    sim.setManual(true)
    sim.forceOutput('Y1', true)
    sim.advance(2)
    sim.forceOutput('Y2', true)
    sim.advance(1)
    sim.forceOutput('Y3', true)
    sim.advance(2)
    sim.setManual(false)
    expect(sim.state.press.homing).toBe(true)
    let prevClamp = sim.state.press.act.clamp
    for (let i = 0; i < 100 && sim.state.press.manual; i++) {
      sim.advance(0.1)
      if (sim.state.press.act.clamp < prevClamp) expect(sim.state.press.act.mandrel).toBe(0)
      prevClamp = sim.state.press.act.clamp
    }
    expect(sim.state.press.manual).toBe(false)
    expect(sim.inputs()).toMatchObject({ B4: true, B5: true, B6: true })
    // y el ciclo automático continúa
    sim.advance(120)
    expect(sim.state.good).toBeGreaterThan(0)
  })

  it('no se puede pasar a manual en medio de un ciclo', () => {
    const sim = nominal()
    while (sim.state.press.step === 10) sim.advance(0.1)
    const r = sim.setManual(true)
    expect(r.ok).toBe(false)
    expect(sim.state.press.manual).toBe(false)
  })
})

describe('criterio de calidad al abrir la matriz (límite 80 °C)', () => {
  it('clasificación: ≤ 70 OK · 70–80 OK con aviso · > 80 scrap', () => {
    expect(classifyDemold(45)).toBe('ok')
    expect(classifyDemold(60)).toBe('ok')
    expect(classifyDemold(69.9)).toBe('ok')
    expect(classifyDemold(70)).toBe('warn')
    expect(classifyDemold(75)).toBe('warn')
    expect(classifyDemold(80)).toBe('warn') // 80 °C exacto sigue siendo aceptable
    expect(classifyDemold(80.1)).toBe('scrap')
    expect(classifyDemold(82)).toBe('scrap')
  })

  it('piezas que abren a 60–75 °C se cuentan como Curva OK; a ~83 °C son scrap', () => {
    const cases: { waterMs: number; min: number; max: number; ok: boolean; warn: boolean }[] = [
      { waterMs: 4000, min: 60, max: 65, ok: true, warn: false }, // ~61 °C
      { waterMs: 3000, min: 70, max: 75, ok: true, warn: true }, // ~71 °C: OK con aviso
      { waterMs: 2500, min: 75, max: 80, ok: true, warn: true }, // ~77 °C: OK con aviso
      { waterMs: 2000, min: 82, max: 85, ok: false, warn: false }, // ~83 °C: scrap
    ]
    for (const c of cases) {
      const sim = nominal({ seqWaterMs: c.waterMs })
      sim.advance(300)
      const s = sim.state
      const d = s.lastDemold!.temp
      expect(d).toBeGreaterThanOrEqual(c.min)
      expect(d).toBeLessThanOrEqual(c.max)
      expect(s.good + s.scrap).toBeGreaterThan(10)
      if (c.ok) {
        expect(s.scrap).toBe(0)
        expect(s.alarmCounts.DEMOLD_HOT).toBe(0)
      } else {
        expect(s.good).toBe(0)
        expect(s.scrapBy['desmoldeo-caliente']).toBe(s.scrap)
      }
      expect(s.alarmCounts.DEMOLD_WARM > 0).toBe(c.warn)
    }
  })
})

describe('recálculo del balance y parámetros', () => {
  it('cambiar el templado o el tiempo de operario recalcula el ciclo segundo a segundo', () => {
    const base = computeBalance(DEFAULT_PARAMS)
    const water = computeBalance({ ...DEFAULT_PARAMS, seqWaterMs: 9000 })
    const operator = computeBalance({ ...DEFAULT_PARAMS, seqOperatorMs: 11000 })
    expect(water.cycle - base.cycle).toBeCloseTo(2, 9)
    expect(operator.cycle - base.cycle).toBeCloseTo(2, 9)
    expect(water.capacityPerHour).toBeLessThan(base.capacityPerHour)
    // el takt sólo depende de la meta y de las horas: el margen contra el takt es lo que cambia
    expect(water.takt).toBe(base.takt)
    expect(water.takt - water.cycle).toBeCloseTo(base.takt - base.cycle - 2, 9)
    // más templado → la pieza sale más fría de la matriz
    expect(water.demoldTemp).toBeLessThan(base.demoldTemp)
  })

  it('presets: nominal 22,9 s, conservador 26 s con templado de 9 s, verano con agua a 32 °C', () => {
    expect(computeBalance(presetParams('nominal')).cycle).toBeCloseTo(22.9, 9)
    const cons = presetParams('conservador')
    expect(cons.seqWaterMs).toBe(9000)
    expect(computeBalance(cons).cycle).toBeCloseTo(26, 9)
    expect(presetParams('verano').waterInitTemp).toBe(32)
    expect(presetParams('frio').coldStart).toBe(true)
  })

  it('jornada nominal con tanque pasivo de 500 L (sin chiller): el agua se calienta pero todas las piezas son OK', () => {
    expect(DEFAULT_PARAMS.tankCooling).toBe('none')
    const sim = nominal()
    let maxDemold = 0
    for (let i = 0; i < 8 * 60; i++) {
      sim.advance(60)
      maxDemold = Math.max(maxDemold, sim.state.lastDemold?.temp ?? 0)
    }
    const s = sim.state
    expect(s.tank.temp).toBeGreaterThan(DEFAULT_PARAMS.waterInitTemp + 15) // ~41 °C al final
    expect(maxDemold).toBeGreaterThan(50) // con el límite viejo habría scrap
    expect(maxDemold).toBeLessThan(HDPE.demoldWarn)
    expect(s.scrap).toBe(0)
    expect(s.good).toBeGreaterThan(1240)
    expect(s.alarmCounts.DEMOLD_HOT + s.alarmCounts.DEMOLD_WARM + s.alarmCounts.INTERLOCK + s.alarmCounts.PICK_COLD).toBe(0)
    // el pronóstico de la pestaña B coincide con la simulación completa
    const f = tankForecast(DEFAULT_PARAMS)
    expect(f.worst).toBe('ok')
    expect(Math.abs(f.tankEnd - s.tank.temp)).toBeLessThan(1.5)
    expect(Math.abs(f.demoldEnd - maxDemold)).toBeLessThan(1.5)
  })

  it('preset Verano crítico (agua a 32 °C): la apertura ronda 50–65 °C y ahora cuenta como Curva OK', () => {
    const sim = new CellSimulation({ ...presetParams('verano'), variability: 0 })
    let minDemold = Infinity
    let maxDemold = 0
    for (let i = 0; i < 8 * 60; i++) {
      sim.advance(60)
      const d = sim.state.lastDemold?.temp
      if (d) {
        minDemold = Math.min(minDemold, d)
        maxDemold = Math.max(maxDemold, d)
      }
    }
    expect(minDemold).toBeGreaterThan(50)
    expect(minDemold).toBeLessThan(55) // ~53 °C al comienzo
    expect(maxDemold).toBeLessThanOrEqual(HDPE.demoldMax)
    expect(sim.state.scrap).toBe(0)
    expect(sim.state.good).toBeGreaterThan(1240)
  })

  it('importación: recorta a rango, ignora claves desconocidas y rechaza JSON inválido', () => {
    const r = parseParamsJson(JSON.stringify({ format: 'simulador-conduit/params', params: { seqWaterMs: 99999, bathTemp: 100, foo: 1, slots: 16 } }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.params.seqWaterMs).toBe(12000)
      expect(r.params.bathTemp).toBe(120)
      expect(r.ignored).toEqual(['foo'])
    }
    expect(parseParamsJson('{nope').ok).toBe(false)
    expect(parseParamsJson('{"x": 1}').ok).toBe(false)
    // el soplado nunca supera al paso 6 completo
    expect(sanitizeParams({ seqPurgeMs: 800, seqBlowMs: 2000 }).seqBlowMs).toBe(800)
  })

  it('fuerza de mordaza: 6 bar × Ø50 ≈ 1178 N; a 2 bar el caño desliza', () => {
    const nom = clampEstimate(6, 50, 35)
    expect(nom.force).toBeCloseTo(1178, 0)
    expect(nom.margin).toBeGreaterThan(1)
    expect(clampEstimate(2, 50, 35).margin).toBeLessThan(1)
    expect(computeBalance(DEFAULT_PARAMS).clamp.force).toBeCloseTo(nom.force, 6)
  })

  it('estación de retiro forzada: se respeta el ángulo elegido', () => {
    const b = computeBalance({ ...DEFAULT_PARAMS, pickStationK: 2 })
    expect(b.stations.pickAngle).toBe(45)
    expect(b.stations.forced).toBe(true)
    expect(computeBalance(DEFAULT_PARAMS).stations.forced).toBe(false)
  })
})
