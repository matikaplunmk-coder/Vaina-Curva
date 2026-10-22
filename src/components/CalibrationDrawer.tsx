import { useEffect, useMemo, useRef, useState } from 'react'
import type { SimController } from '../hooks/useSimulation'
import { STORAGE_KEY } from '../hooks/paramStore'
import { computeBalance, pickChoices, autoPickK, tankForecast } from '../sim/balance'
import { HDPE } from '../sim/physics'
import { PRESETS } from '../sim/params'
import { fmt, fmtMs } from './format'
import { ParamSlider, Select } from './controls'

type Tab = 'seq' | 'thermo' | 'mech' | 'presets'

const TABS: [Tab, string][] = [
  ['seq', 'A · Secuencia'],
  ['thermo', 'B · Termo y fluidos'],
  ['mech', 'C · Mecánica'],
  ['presets', 'D · Presets'],
]

const FORECAST_CLS = {
  ok: 'border-emerald-800 bg-emerald-950/40 text-emerald-200',
  warn: 'border-amber-700 bg-amber-950/40 text-amber-200',
  scrap: 'border-red-700 bg-red-950/40 text-red-200',
}

const BOTTLENECK = { carrusel: 'carrusel (inmersión)', prensa: 'máquina (pasos 1–9) + operario', operario: 'operario' }

export function CalibrationDrawer({ c, open, onClose }: { c: SimController; open: boolean; onClose: () => void }) {
  const p = c.params
  const set = c.setParam
  const [tab, setTab] = useState<Tab>('seq')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const exportRef = useRef<HTMLTextAreaElement>(null)
  const [exported, setExported] = useState<string | null>(null)
  // Recálculo instantáneo: el balance se deriva de los parámetros en cada render.
  const b = useMemo(() => computeBalance(p), [p])
  const forecast = useMemo(() => tankForecast(p), [p])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const machine = b.pressCycle
  const choices = pickChoices(p.slots)
  const auto = autoPickK(p.slots)

  const download = () => {
    const json = c.exportParams()
    // Descarga directa (funciona al correrlo localmente) y, además, el JSON a la vista para copiarlo:
    // en algunos visores web la descarga está bloqueada.
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'parametros-celda-conduit.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // sin descarga: queda el texto para copiar
    }
    setExported(json)
    setMessage({ ok: true, text: 'JSON generado. Si la descarga no arrancó, copiá el texto de abajo y guardalo como .json.' })
  }
  const copy = async () => {
    if (!exported) return
    try {
      await navigator.clipboard.writeText(exported)
      setMessage({ ok: true, text: 'JSON copiado al portapapeles.' })
    } catch {
      exportRef.current?.select()
      setMessage({ ok: false, text: 'No se pudo copiar automáticamente: el texto quedó seleccionado, copialo con Ctrl+C.' })
    }
  }


  const onFile = async (file: File | undefined) => {
    if (!file) return
    const r = c.importParams(await file.text())
    setMessage(
      r.ok
        ? { ok: true, text: `Parámetros importados y aplicados${r.ignored.length ? ` (claves ignoradas: ${r.ignored.join(', ')})` : ''}.` }
        : { ok: false, text: r.error },
    )
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label="Parámetros y calibración">
      <button aria-label="Cerrar panel" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative flex h-full w-[440px] max-w-full flex-col border-l border-slate-800 bg-slate-950 shadow-2xl">
        <header className="border-b border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-50">Parámetros y calibración</h2>
            <button onClick={onClose} className="btn py-1" aria-label="Cerrar">
              ✕
            </button>
          </div>
          {/* Resumen en vivo */}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-900 px-2 py-1.5">
              <div className="text-[10px] text-slate-400">Ciclo teórico</div>
              <div className="font-mono text-lg font-bold text-sky-300" data-testid="drawer-cycle">
                {fmt(b.cycle, 2)} s
              </div>
            </div>
            <div className="rounded-lg bg-slate-900 px-2 py-1.5">
              <div className="text-[10px] text-slate-400">Capacidad</div>
              <div className="font-mono text-lg font-bold text-slate-100" data-testid="drawer-capacity">
                {fmt(b.capacityPerDay, 0)} pz
              </div>
              <div className="text-[10px] text-slate-500">en {fmt(p.shiftHours, 1)} h · {fmt(b.capacityPerHour, 0)} pz/h</div>
            </div>
            <div className={`rounded-lg px-2 py-1.5 ${b.cycle <= b.takt ? 'bg-emerald-950/60' : 'bg-red-950/60'}`}>
              <div className="text-[10px] text-slate-400">Takt (meta {p.dailyGoal})</div>
              <div className="font-mono text-lg font-bold text-slate-100" data-testid="drawer-takt">
                {fmt(b.takt, 1)} s
              </div>
              <div className="text-[10px] text-slate-400" data-testid="drawer-takt-margin">
                margen {fmt(b.takt - b.cycle, 1)} s
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Cuello de botella: <b className="text-slate-200">{BOTTLENECK[b.bottleneck]}</b> · máquina {fmt(machine, 2)} s · paso 10{' '}
            {fmt(p.seqOperatorMs / 1000, 2)} s · retención carrusel {fmt(b.cycleCarousel, 1)} s
          </p>
          <nav className="mt-3 flex gap-1" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-semibold ${tab === id ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {tab === 'seq' && (
            <>
              <p className="text-[11px] text-slate-400">
                Cada paso espera su tiempo <i>y</i> el final de carrera correspondiente. El paso 8 (liberar mordaza) sólo arranca con el cono
                atrás (B4).
              </p>
              <ParamSlider k="seqCloseMs" params={p} set={set} label="Paso 1 · Cierre de matriz y curvado 90°" unit="ms" format={fmtMs} />
              <ParamSlider k="seqSettleMs" params={p} set={set} label="Paso 1 · Asentamiento" unit="ms" format={fmtMs} />
              <ParamSlider k="seqClampMs" params={p} set={set} label="Paso 2 · Bloqueo de mordaza Ø40" unit="ms" format={fmtMs} />
              <ParamSlider k="seqMandrelMs" params={p} set={set} label="Paso 3 · Avance del mandril" unit="ms" format={fmtMs} />
              <ParamSlider k="seqSeatMs" params={p} set={set} label="Paso 4 · Asiento del cono y sellado" unit="ms" format={fmtMs} />
              <ParamSlider
                k="seqWaterMs"
                params={p}
                set={set}
                label="Paso 5 · Templado (agua, llenado y rebalse)"
                unit="ms"
                format={fmtMs}
                hint={`Llenado de la L en ${fmt(b.fillTime, 2)} s con ${p.pumpFlow} L/min · apertura estimada a ${fmt(b.demoldTemp, 1)} °C (scrap > ${HDPE.demoldMax} °C, aviso desde ${HDPE.demoldWarn} °C)`}
              />
              <ParamSlider k="seqPurgeMs" params={p} set={set} label="Paso 6 · Corte, purga y drenaje (total)" unit="ms" format={fmtMs} />
              <ParamSlider k="seqBlowMs" params={p} set={set} label="Paso 6 · Soplado de aire (dentro del paso)" unit="ms" format={fmtMs} max={p.seqPurgeMs} />
              <ParamSlider k="seqRetractMs" params={p} set={set} label="Paso 7 · Retroceso del mandril + pulso" unit="ms" format={fmtMs} />
              <ParamSlider k="seqReleaseMs" params={p} set={set} label="Paso 8 · Liberación de mordaza" unit="ms" format={fmtMs} />
              <ParamSlider k="seqOpenMs" params={p} set={set} label="Paso 9 · Apertura de matriz" unit="ms" format={fmtMs} />
              <ParamSlider
                k="seqOperatorMs"
                params={p}
                set={set}
                label="Paso 10 · Operario: extracción y carga"
                unit="ms"
                format={fmtMs}
                hint="Descarga 30 % · toma del carrusel 30 % · colocación en la matriz 40 %"
              />
              <ParamSlider
                k="coldLoadMs"
                params={p}
                set={set}
                label="Carga del caño frío en el carrusel"
                unit="ms"
                format={fmtMs}
                hint="Tarea interna: se hace mientras la máquina ejecuta los pasos 1–9"
              />
            </>
          )}

          {tab === 'thermo' && (
            <>
              <ParamSlider
                k="bathTemp"
                params={p}
                set={set}
                label="Temperatura de la glicerina"
                unit="°C"
                hint="Con la línea detenida el caño tiende a esta temperatura (> 128 °C tras 90 s = riesgo de reblandecimiento)"
              />
              <ParamSlider k="targetTemp" params={p} set={set} label="Temperatura objetivo del caño al retiro" unit="°C" />
              <ParamSlider k="bathTau" params={p} set={set} label="τ sumergido en glicerina (a 2,5 mm)" unit="s" />
              <ParamSlider k="pumpFlow" params={p} set={set} label="Caudal de la bomba de agua" unit="L/min" />
              <ParamSlider k="waterInitTemp" params={p} set={set} label="Temperatura inicial del agua del tanque" unit="°C" />
              <div className="border-t border-slate-800 pt-3" />
              <ParamSlider k="ambientTemp" params={p} set={set} label="Temperatura ambiente" unit="°C" />
              <ParamSlider k="wallThickness" params={p} set={set} label="Espesor de pared" unit="mm" />
              <ParamSlider k="tankVolume" params={p} set={set} label="Volumen del tanque" unit="L" />
              <Select
                label="Enfriamiento del tanque"
                value={p.tankCooling}
                options={[
                  ['none', 'Tanque pasivo (sin enfriamiento)'],
                  ['radiator', 'Intercambiador aire-agua'],
                  ['chiller', 'Chiller 3 kW, opcional (setpoint = temp. inicial)'],
                ]}
                onChange={(v) => set('tankCooling', v)}
              />
              <div className={`rounded-lg border p-2 text-[11px] ${FORECAST_CLS[forecast.worst]}`} data-testid="tank-forecast">
                <div className="font-semibold">
                  Pronóstico de la jornada ({fmt(p.shiftHours, 1)} h): agua {fmt(p.waterInitTemp, 0)} → {fmt(forecast.tankEnd, 1)} °C · apertura{' '}
                  {fmt(forecast.demoldStart, 1)} → {fmt(forecast.demoldEnd, 1)} °C
                </div>
                <div className="mt-0.5">
                  {forecast.worst === 'scrap'
                    ? `✖ Al final de la jornada la apertura supera ${HDPE.demoldMax} °C: habrá scrap. Subí el templado (paso 5), el volumen del tanque o usá chiller.`
                    : forecast.worst === 'warn'
                      ? `◐ Piezas OK, pero la apertura entra en la franja de aviso (${HDPE.demoldWarn}–${HDPE.demoldMax} °C) hacia el final de la jornada.`
                      : `✔ Todas las piezas abren por debajo de ${HDPE.demoldWarn} °C. Con el límite de ${HDPE.demoldMax} °C, ${p.tankCooling === 'none' ? `el tanque pasivo de ${fmt(p.tankVolume, 0)} L alcanza para el turno completo; el chiller es opcional.` : 'no hace falta enfriamiento activo adicional.'}`}
                </div>
              </div>
              <ParamSlider k="dragOutMl" params={p} set={set} label="Arrastre de glicerina por caño" unit="ml" />
            </>
          )}

          {tab === 'mech' && (
            <>
              <ParamSlider
                k="slots"
                params={p}
                set={set}
                label="Posiciones del carrusel"
                unit="pos."
                hint={`Paso angular ${fmt(360 / p.slots, 2)}° · reinicia la simulación`}
              />
              <Select
                label="Estación de RETIRO (ángulo de salida del baño)"
                value={String(p.pickStationK)}
                options={[
                  ['0', `Automática: primera emergida (${fmt(auto * (360 / p.slots), 1)}°)`],
                  ...choices.map(
                    (ch) =>
                      [String(ch.k), `Forzada: ${fmt(ch.angle, 1)}°${ch.f === 1 ? ' · sumergida' : ch.f > 0 ? ' · en la superficie' : ' · al aire'}`] as [string, string],
                  ),
                ]}
                onChange={(v) => set('pickStationK', Number(v))}
              />
              {b.stations.forced && (
                <p className="text-[11px] text-amber-300">
                  Retiro forzado a {fmt(b.stations.pickAngle, 1)}°:{' '}
                  {b.stations.pickK > auto ? 'el caño se toma todavía en contacto con la glicerina.' : 'el caño recorre arco aéreo antes del retiro.'}
                </p>
              )}
              <Select
                label="Estación de CARGA FRÍO"
                value={p.loadStation}
                options={[
                  ['top', 'Cenit (0°)'],
                  ['preEntry', 'Lado que baja, antes de entrar al baño'],
                ]}
                onChange={(v) => set('loadStation', v)}
              />
              <div className="border-t border-slate-800 pt-3" />
              <ParamSlider k="clampPressureBar" params={p} set={set} label="Presión de aire (mordaza y mandril)" unit="bar" />
              <ParamSlider k="clampBoreMm" params={p} set={set} label="Diámetro del cilindro de la mordaza" unit="mm" />
              <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Fuerza de mordaza estimada</span>
                  <b className="font-mono text-slate-100" data-testid="clamp-force">
                    {fmt(b.clamp.force, 0)} N · {fmt(b.clamp.force / 9.81, 0)} kgf
                  </b>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Retención (μ 0,35 × 2) vs empuje mandril + agua</span>
                  <span className="font-mono text-slate-300">
                    {fmt(b.clamp.friction, 0)} / {fmt(b.clamp.mandrelPush + b.clamp.waterPush, 0)} N
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Margen de retención</span>
                  <b className={b.clamp.margin < 1 ? 'text-red-300' : b.clamp.margin < 1.5 ? 'text-amber-300' : 'text-emerald-300'}>
                    {fmt(b.clamp.margin, 2)} {b.clamp.margin < 1 ? '✖ el caño desliza' : b.clamp.margin < 1.5 ? '⚠ justo' : '✔'}
                  </b>
                </div>
              </div>
              <div className="border-t border-slate-800 pt-3" />
              <ParamSlider k="variability" params={p} set={set} label="Variabilidad de tiempos manuales" unit="%" />
              <ParamSlider k="shiftHours" params={p} set={set} label="Horas productivas por día" unit="h" />
              <ParamSlider k="dailyGoal" params={p} set={set} label="Meta diaria" unit="pz" />
            </>
          )}

          {tab === 'presets' && (
            <>
              <div className="space-y-2">
                {PRESETS.map((pr) => (
                  <button key={pr.id} onClick={() => c.applyPreset(pr.id)} className="block w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-left hover:border-sky-500">
                    <div className="text-xs font-semibold text-slate-100">{pr.label}</div>
                    <div className="text-[11px] text-slate-400">{pr.description}</div>
                  </button>
                ))}
              </div>
              <button onClick={c.resetParams} className="btn w-full justify-center">
                ↺ Restablecer a valores nominales
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={download} className="btn justify-center">
                  ⬇ Exportar JSON
                </button>
                <button onClick={() => fileRef.current?.click()} className="btn justify-center">
                  ⬆ Importar JSON
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Archivo de parámetros"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {message && <p className={`text-[11px] ${message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>}
              {exported && (
                <div className="space-y-1">
                  <textarea
                    id="export-json"
                    ref={exportRef}
                    readOnly
                    value={exported}
                    rows={8}
                    aria-label="JSON exportado"
                    className="w-full rounded-md border border-slate-700 bg-slate-900 p-2 font-mono text-[10px] text-slate-200"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button onClick={copy} className="btn w-full justify-center">
                    Copiar JSON
                  </button>
                </div>
              )}
              <p className="text-[11px] text-slate-500">
                La configuración se guarda automáticamente en este navegador (localStorage, clave <code>{STORAGE_KEY}</code>) y se recupera al
                recargar. Aplicar un preset, importar o restablecer reinicia la corrida.
              </p>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}
