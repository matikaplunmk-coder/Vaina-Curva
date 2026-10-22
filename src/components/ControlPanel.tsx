import type { SimController } from '../hooks/useSimulation'
import type { SpeedMode } from '../sim/params'
import { ParamSlider, Select, Toggle } from './controls'
import { fmtMs } from './format'

const SPEEDS: [SpeedMode, string][] = [
  [1, '1×'],
  [5, '5×'],
  [10, '10×'],
  [30, '30×'],
  [60, '60×'],
  ['step', 'Paso'],
]

export function SimulationControls({ c }: { c: SimController }) {
  const paused = c.sim.isPaused
  const ended = c.sim.state.shiftEnded
  return (
    <div className="flex flex-wrap items-center gap-2">
      {c.speed === 'step' ? (
        <button onClick={c.step} disabled={ended} className="btn btn-primary">
          ⏭ Siguiente evento
        </button>
      ) : (
        <button onClick={() => c.setRunning(!c.running)} disabled={ended} className="btn btn-primary min-w-24">
          {c.running ? '⏸ Pausar' : '▶ Iniciar'}
        </button>
      )}
      <button onClick={c.reset} className="btn">
        ↺ Reiniciar
      </button>
      <div className="flex overflow-hidden rounded-lg border border-slate-700" role="group" aria-label="Velocidad de simulación">
        {SPEEDS.map(([v, l]) => (
          <button
            key={String(v)}
            onClick={() => c.setSpeed(v)}
            className={`px-2.5 py-1.5 text-xs font-semibold ${c.speed === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            {l}
          </button>
        ))}
      </div>
      <button
        onClick={c.togglePause}
        className={`btn ${paused ? 'border-amber-500 bg-amber-900/40 text-amber-200' : ''}`}
        title="Simula que el operario deja el puesto (termina la tarea en curso). Útil para ver el sobrecalentamiento en el carrusel."
      >
        {paused ? '🧍 Reanudar operario' : '☕ Retirar operario'}
      </button>
    </div>
  )
}

export function ControlPanel({ c, onOpenCalibration }: { c: SimController; onOpenCalibration: () => void }) {
  const p = c.params
  const set = c.setParam

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Panel de control</h2>
        <ParamSlider
          k="seqWaterMs"
          params={p}
          set={set}
          label="Templado: inyección de agua (paso 5)"
          unit="ms"
          format={fmtMs}
          hint={p.coolingMode === 'sensor' ? 'Modo sensor: tiempo mínimo' : 'Llenado de la L y rebalse libre'}
        />
        <ParamSlider k="waterInitTemp" params={p} set={set} label="Temp. inicial del agua del tanque" unit="°C" hint="Al moverlo se repone el agua del tanque a esa temperatura" />
        <ParamSlider
          k="seqOperatorMs"
          params={p}
          set={set}
          label="Operario: extracción y carga (paso 10)"
          unit="ms"
          format={fmtMs}
          hint="Descarga de la curva + toma del caño caliente + colocación en la matriz"
        />
        <ParamSlider
          k="slots"
          params={p}
          set={set}
          label="Capacidad del carrusel"
          unit="pos."
          hint={`Paso angular ${(360 / p.slots).toLocaleString('es-AR', { maximumFractionDigits: 2 })}° · cambiarla reinicia la simulación`}
        />
        <button onClick={onOpenCalibration} className="btn w-full justify-center">
          ⚙ Todos los parámetros y calibración
        </button>
      </div>

      <div className="space-y-3 border-t border-slate-800 pt-3">
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Lógica de control</h2>
        <Toggle
          label="Enclavamiento de temperatura en carrusel"
          checked={p.tempInterlock}
          onChange={(v) => set('tempInterlock', v)}
          hint={`El carrusel no gira hasta cumplir la permanencia mínima por posición y que el caño que va a emerger al RETIRO tenga ≥ ${p.targetTemp} °C (se toma apenas sale, sin sobretemperatura). Desactivado: gira al ritmo del operario.`}
        />
        <Select
          label="Control de la inyección"
          value={p.coolingMode}
          options={[
            ['timed', 'Temporizado (tiempo fijo)'],
            ['sensor', 'Por sensor (hasta < 48 °C)'],
          ]}
          onChange={(v) => set('coolingMode', v)}
        />
        <Select
          label="Estación de carga del caño frío"
          value={p.loadStation}
          options={[
            ['top', 'Cenit (12 en punto)'],
            ['preEntry', 'Lado que baja, antes de entrar al baño'],
          ]}
          onChange={(v) => set('loadStation', v)}
        />
        <Toggle label="Arranque en frío (carrusel vacío)" checked={p.coldStart} onChange={(v) => set('coldStart', v)} hint="Si no, arranca en régimen. Reinicia la simulación." />
      </div>

    </div>
  )
}
