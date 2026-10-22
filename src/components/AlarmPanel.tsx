import type { Alarm, AlarmKind } from '../sim/engine'
import { fmtClock } from './format'
import { ALARM_META } from './labels'

export function AlarmPanel({
  alarms,
  counts,
  unacked,
  onAck,
}: {
  alarms: Alarm[]
  counts: Record<AlarmKind, number>
  unacked: number
  onAck: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 grid grid-cols-2 gap-2">
        {(['OVERHEAT', 'SOFTENING', 'PICK_COLD', 'INTERLOCK', 'DEMOLD_HOT', 'DEMOLD_WARM'] as AlarmKind[]).map((k) => (
          <div key={k} className={`rounded-lg border px-2 py-1.5 ${counts[k] ? ALARM_META[k].cls : 'border-slate-800 bg-slate-900 text-slate-400'}`}>
            <div className="text-[10px] leading-tight">
              {ALARM_META[k].icon} {ALARM_META[k].title}
            </div>
            <div className="text-lg font-bold">{counts[k]}</div>
          </div>
        ))}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className={`text-xs ${unacked ? 'font-semibold text-red-300' : 'text-slate-500'}`}>
          {unacked ? `${unacked} sin reconocer` : 'Sin alarmas pendientes'}
        </span>
        <button onClick={onAck} disabled={!unacked} className="btn py-1 text-xs">
          Reconocer
        </button>
      </div>
      <ol className="max-h-72 min-h-24 flex-1 space-y-1 overflow-y-auto pr-1 text-xs">
        {alarms.length === 0 && <li className="text-slate-500">El registro de alarmas está vacío.</li>}
        {alarms.slice(0, 80).map((a) => (
          <li key={a.id} className={`rounded-md border px-2 py-1 ${ALARM_META[a.kind].cls}`}>
            <span className="mr-1 font-mono text-[10px] opacity-80">{fmtClock(a.t)}</span>
            <span className="font-semibold">{ALARM_META[a.kind].icon}</span> {a.message}
          </li>
        ))}
      </ol>
    </div>
  )
}
