import type { AlarmKind, OpTask } from '../sim/engine'
import type { PressStep } from '../sim/sequence'

/** Color de cada paso de la secuencia (barras de balance y diagrama hombre-máquina). */
export const STEP_COLOR: Record<PressStep, string> = {
  1: '#9085e9',
  2: '#d97706',
  3: '#0891b2',
  4: '#22d3ee',
  5: '#38bdf8',
  6: '#cbd5e1',
  7: '#0e7490',
  8: '#b45309',
  9: '#7c3aed',
  10: '#334155',
}

export const TASK_LABEL: Record<OpTask, string> = {
  UNLOAD: 'Descarga curva',
  PICK: 'Toma caño caliente',
  TRANSFER: 'Carga en matriz',
  LOAD: 'Carga caño frío',
  WAIT_PRESS: 'Espera prensa',
  WAIT_TEMP: 'Espera temperatura',
  WAIT_INDEX: 'Espera giro',
  PAUSED: 'Pausa',
}

export const ALARM_META: Record<AlarmKind, { title: string; icon: string; cls: string }> = {
  OVERHEAT: { title: 'Scrap crítico > 135 °C', icon: '🔥', cls: 'border-red-600/60 bg-red-950/40 text-red-200' },
  SOFTENING: { title: 'Riesgo de reblandecimiento', icon: '⚠', cls: 'border-yellow-500/60 bg-yellow-950/40 text-yellow-200' },
  PICK_COLD: { title: 'Caño retirado frío', icon: '❄', cls: 'border-amber-500/60 bg-amber-950/40 text-amber-200' },
  DEMOLD_HOT: { title: 'Apertura > 80 °C (scrap)', icon: '⚠', cls: 'border-orange-500/60 bg-orange-950/40 text-orange-200' },
  DEMOLD_WARM: { title: 'Apertura 70–80 °C (OK, aviso)', icon: '◐', cls: 'border-amber-500/60 bg-amber-950/30 text-amber-200' },
  INTERLOCK: { title: 'Bloqueo de seguridad (PLC)', icon: '⛔', cls: 'border-fuchsia-500/60 bg-fuchsia-950/40 text-fuchsia-200' },
  INFO: { title: 'Información', icon: 'ℹ', cls: 'border-slate-600 bg-slate-800/60 text-slate-200' },
}
