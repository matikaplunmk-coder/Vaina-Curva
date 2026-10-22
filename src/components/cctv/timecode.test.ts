import { describe, expect, it } from 'vitest'
import { formatDuration, formatTimecode } from './timecode'

describe('timecode CCTV', () => {
  it('formatea YYYY-MM-DD HH:MM:SS.mmm con ceros a la izquierda', () => {
    const t = new Date(2026, 0, 5, 3, 4, 9, 7).getTime()
    expect(formatTimecode(t)).toBe('2026-01-05 03:04:09.007')
  })
  it('formatDuration da mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(75.9)).toBe('01:15')
    expect(formatDuration(-3)).toBe('00:00')
  })
})
