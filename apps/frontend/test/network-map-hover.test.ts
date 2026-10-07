import { describe, expect, it } from 'vitest'
import { prioritizeMapFeature } from '../src/shared/network-map-hover'

describe('network map hit priority', () => {
  it('selects pin before overlapping line or reference area', () => {
    const polygon = { geometry: { type: 'Polygon' } }
    const line = { geometry: { type: 'LineString' } }
    const pin = { geometry: { type: 'Point' } }

    expect(prioritizeMapFeature([polygon, line, pin])).toBe(pin)
  })

  it('selects line before area when no pin is under cursor', () => {
    const polygon = { geometry: { type: 'Polygon' } }
    const line = { geometry: { type: 'MultiLineString' } }

    expect(prioritizeMapFeature([polygon, line])).toBe(line)
  })
})
