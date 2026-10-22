import { useState } from 'react'
import type { SimController } from '../hooks/useSimulation'
import { INPUT_LABEL, OUTPUT_LABEL, readInputs, STEPS, stepDurations, type InputId, type OutputId } from '../sim/sequence'
import { fmt, fmtClock } from './format'
import { STEP_COLOR } from './labels'

function Led({ on, color, label, code }: { on: boolean; color: string; label: string; code: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]" data-testid={`io-${code}`} data-on={on}>
      <span
        className="inline-block h-3 w-3 shrink-0 rounded-full border border-slate-900"
        style={{ background: on ? color : '#1e293b', boxShadow: on ? `0 0 8px ${color}` : 'none' }}
        aria-hidden
      />
      <span className="font-mono font-bold text-slate-200">{code}</span>
      <span className="truncate text-slate-400">{label}</span>
      <span className={`ml-auto font-mono ${on ? 'text-slate-100' : 'text-slate-600'}`}>{on ? '1' : '0'}</span>
    </div>
  )
}

const RULES = [
  'Y4 bomba: sólo con cono asentado (B3) y mordaza trabada (B2), nunca junto con Y5',
  'Y2 abrir mordaza: sólo con el cono atrás (B4) y el mandril sin orden de avance',
  'Y3 avance mandril: sólo con matriz cerrada (B1) y mordaza trabada (B2)',
  'Y3 retroceso: no con la bomba de agua en marcha',
  'Y1 abrir matriz: sólo con cono atrás (B4) y mordaza abierta (B5)',
]

export function PlcPanel({ c }: { c: SimController }) {
  const sim = c.sim
  const press = sim.state.press
  const inputs = readInputs(press.act)
  const d = stepDurations(c.params)
  const running = !press.manual && press.step <= 9
  const manualAvailable = press.step === 10 && !press.homing

  const [notice, setNotice] = useState<string | null>(null)
  const toggleManual = () => {
    const r = c.setManual(!press.manual)
    setNotice(r.ok ? null : (r.reason ?? null))
  }

  return (
    <div className="grid grid-cols-1 gap-4 text-xs lg:grid-cols-[1.2fr_1fr]">
      {/* Secuencia */}
      <div>
        <div className="mb-1 font-semibold text-slate-300">Secuencia de 10 pasos</div>
        <ol className="space-y-0.5">
          {STEPS.map((st) => {
            const active = press.step === st.n && !press.manual
            const dur = d[st.n]
            const prog = active ? Math.min(1, press.elapsed / dur) : 0
            return (
              <li
                key={st.n}
                data-testid={`step-${st.n}`}
                data-active={active}
                className={`relative overflow-hidden rounded px-2 py-0.5 ${active ? 'bg-slate-800 text-slate-50' : 'text-slate-400'}`}
              >
                {active && st.n <= 9 && (
                  <span className="absolute inset-y-0 left-0 opacity-25" style={{ width: `${prog * 100}%`, background: STEP_COLOR[st.n] }} />
                )}
                <span className="relative flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STEP_COLOR[st.n] }} />
                  <b className="w-4 font-mono">{st.n}</b>
                  <span className="truncate">{st.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-500">{fmt(dur * 1000, 0)} ms</span>
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mt-1 text-[11px] text-slate-500">
          {press.manual
            ? press.homing
              ? 'Volviendo a reposo: Y3 atrás → Y2 abre → Y1 abre, respetando los enclavamientos.'
              : 'Secuencia automática suspendida (modo manual).'
            : running
              ? `Ciclo en curso · ${fmt(sim.state.t - press.cycleStart, 1)} s desde el paso 1`
              : 'Estación abierta: esperando al operario (paso 10).'}
        </p>
      </div>

      {/* E/S y modo manual */}
      <div className="space-y-3">
        <div>
          <div className="mb-1 font-semibold text-slate-300">Entradas (finales de carrera)</div>
          <div className="space-y-1">
            {(Object.keys(INPUT_LABEL) as InputId[]).map((id) => (
              <Led key={id} code={id} label={INPUT_LABEL[id]} on={inputs[id]} color="#22c55e" />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold text-slate-300">Salidas</span>
            <button
              onClick={toggleManual}
              disabled={!press.manual && !manualAvailable}
              className={`btn py-0.5 text-[11px] ${press.manual ? 'border-fuchsia-500 bg-fuchsia-900/40 text-fuchsia-200' : ''}`}
              title={manualAvailable || press.manual ? '' : 'Disponible al terminar el ciclo (paso 10)'}
            >
              {press.manual ? (press.homing ? 'Volviendo a reposo…' : '⏏ Volver a automático') : '🔧 Modo manual'}
            </button>
          </div>
          <div className="space-y-1">
            {(Object.keys(OUTPUT_LABEL) as OutputId[]).map((id) => (
              <div key={id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Led code={id} label={OUTPUT_LABEL[id]} on={press.out[id]} color={id === 'Y4' ? '#38bdf8' : id === 'Y5' ? '#e2e8f0' : '#f59e0b'} />
                </div>
                {press.manual && !press.homing && (
                  <button
                    onClick={() => c.forceOutput(id, !press.out[id])}
                    className="btn px-2 py-0.5 text-[10px]"
                    aria-label={`Forzar ${id} a ${press.out[id] ? '0' : '1'}`}
                  >
                    {press.out[id] ? 'OFF' : 'ON'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {notice && <p className="mt-1 text-[11px] text-amber-300">{notice}</p>}
          {press.manual && !c.running && <p className="mt-1 text-[11px] text-amber-300">Iniciá la simulación para que los cilindros se muevan.</p>}
          {press.lastRejection && sim.state.t - press.lastRejection.t < 30 && (
            <p className="mt-1 rounded border border-fuchsia-700 bg-fuchsia-950/50 px-2 py-1 text-[11px] text-fuchsia-200" role="alert">
              ⛔ {fmtClock(press.lastRejection.t)} · {press.lastRejection.reason}
            </p>
          )}
        </div>
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-300">Enclavamientos de seguridad</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  )
}
