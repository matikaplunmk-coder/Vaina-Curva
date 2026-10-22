// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { STORAGE_KEY } from './hooks/paramStore'

beforeAll(() => {
  // Recharts (ResponsiveContainer) necesita ResizeObserver, que jsdom no trae.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const openDrawer = () => fireEvent.click(screen.getByRole('button', { name: '⚙ Parámetros y calibración' }))
const text = (testId: string) => screen.getByTestId(testId).textContent ?? ''

describe('panel de parámetros y calibración', () => {
  it('recalcula ciclo, margen contra el takt y balance al instante al mover templado u operario', () => {
    render(<App />)
    openDrawer()
    expect(text('drawer-cycle')).toBe('22,90 s')
    expect(text('drawer-takt')).toBe('57,6 s')
    expect(text('drawer-takt-margin')).toBe('margen 34,7 s')
    expect(text('balance-cycle')).toContain('22,9 s')
    expect(text('kpi-cycle')).toContain('teórico 22,9 s')

    // Paso 5: templado 7000 → 9000 ms
    fireEvent.change(screen.getByLabelText('Paso 5 · Templado (agua, llenado y rebalse)'), { target: { value: '9000' } })
    expect(text('drawer-cycle')).toBe('24,90 s')
    expect(text('drawer-takt-margin')).toBe('margen 32,7 s')
    expect(text('balance-cycle')).toContain('24,9 s')
    expect(text('kpi-cycle')).toContain('teórico 24,9 s')

    // Paso 10: operario 9000 → 12000 ms
    fireEvent.change(screen.getByLabelText('Paso 10 · Operario: extracción y carga'), { target: { value: '12000' } })
    expect(text('drawer-cycle')).toBe('27,90 s')
    expect(text('balance-cycle')).toContain('27,9 s')
    expect(text('drawer-takt')).toBe('57,6 s') // el takt no depende del ciclo
  })

  it('guarda la configuración en localStorage y la recupera al recargar', () => {
    const first = render(<App />)
    openDrawer()
    fireEvent.change(screen.getByLabelText('Paso 5 · Templado (agua, llenado y rebalse)'), { target: { value: '8500' } })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).seqWaterMs).toBe(8500)
    first.unmount()

    render(<App />)
    openDrawer()
    expect(text('drawer-cycle')).toBe('24,40 s')
  })

  it('presets de un clic y restablecer a valores nominales', () => {
    render(<App />)
    openDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'D · Presets' }))
    fireEvent.click(screen.getByRole('button', { name: /Conservador/ }))
    expect(text('drawer-cycle')).toBe('26,00 s')
    fireEvent.click(screen.getByRole('button', { name: /Restablecer a valores nominales/ }))
    expect(text('drawer-cycle')).toBe('22,90 s')
  })

  it('la fuerza de mordaza se recalcula con la presión y el diámetro del cilindro', () => {
    render(<App />)
    openDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'C · Mecánica' }))
    expect(text('clamp-force')).toContain('1.178 N')
    fireEvent.change(screen.getByLabelText('Presión de aire (mordaza y mandril)'), { target: { value: '8' } })
    expect(text('clamp-force')).toContain('1.571 N')
  })
})

describe('termodinámica: pronóstico del tanque', () => {
  it('con el límite de apertura de 80 °C, el tanque pasivo de 500 L alcanza para el turno completo', () => {
    render(<App />)
    openDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'B · Termo y fluidos' }))
    expect(text('tank-forecast')).toContain('el tanque pasivo de 500 L alcanza para el turno completo')
    // con el templado al mínimo del slider (3 s) la apertura entra en la franja de aviso
    fireEvent.click(screen.getByRole('tab', { name: 'A · Secuencia' }))
    fireEvent.change(screen.getByLabelText('Paso 5 · Templado (agua, llenado y rebalse)'), { target: { value: '3000' } })
    fireEvent.click(screen.getByRole('tab', { name: 'B · Termo y fluidos' }))
    expect(text('tank-forecast')).toMatch(/franja de aviso|habrá scrap/)
  })
})

describe('panel PLC', () => {
  it('muestra las señales de E/S y bloquea el agua sin cono asentado en modo manual', () => {
    render(<App />)
    // En reposo: matriz abierta (B6), mordaza abierta (B5), cono atrás (B4)
    for (const id of ['B4', 'B5', 'B6']) expect(screen.getByTestId(`io-${id}`).dataset.on).toBe('true')
    expect(screen.getByTestId('io-Y4').dataset.on).toBe('false')
    expect(screen.getByTestId('step-10').dataset.active).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '🔧 Modo manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forzar Y4 a 1' }))
    expect(screen.getByTestId('io-Y4').dataset.on).toBe('false')
    expect(within(screen.getByRole('alert')).getByText(/cono no está asentado/)).toBeTruthy()
  })
})

describe('Modo render / cámara CCTV', () => {
  it('alterna entre vista técnica y modo render con overlay, y no toca la vista técnica', () => {
    render(<App />)
    expect(screen.queryByTestId('cctv-frame')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Modo render/ }))
    expect(screen.getByTestId('cctv-frame')).toBeTruthy()
    expect(screen.getByTestId('cctv-rec-dot')).toBeTruthy()
    expect(text('cctv-hud')).toContain('CAM 01 - PRENSA L & CARRUSEL')
    expect(text('cctv-timecode')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
    expect(text('cctv-fps')).toMatch(/FPS/)

    const scan = screen.getByRole('button', { name: 'Scanlines' })
    expect(screen.queryByTestId('cctv-scanlines')).toBeTruthy()
    fireEvent.click(scan)
    expect(screen.queryByTestId('cctv-scanlines')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Vista técnica' }))
    expect(screen.queryByTestId('cctv-frame')).toBeNull()
  })

  it('los botones de velocidad marcan la velocidad elegida', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Modo render/ }))
    const group = screen.getByRole('group', { name: 'Velocidad de reproducción' })
    fireEvent.click(within(group).getByText('0.25×'))
    expect(within(group).getByText('0.25×').getAttribute('aria-pressed')).toBe('true')
    expect(within(group).getByText('1×').getAttribute('aria-pressed')).toBe('false')
  })
})
