import { describe, expect, it } from 'vitest'
import { classifyKmlCandidate } from '../src/shared/kml-classification'

describe('KML candidate classification', () => {
  it('recognizes a cable route from a line geometry and source code pattern', () => {
    expect(classifyKmlCandidate({ name: 'BB-96 3000', geometryType: 'LineString' })).toEqual({
      kind: 'cable', label: 'Jalur kabel', evidence: 'nama/folder KML',
    })
  })

  it('recognizes POP and ODP point candidates from source names', () => {
    expect(classifyKmlCandidate({ name: 'POP RANTAU PRAPAT (RTP)', geometryType: 'Point' })?.kind).toBe('POP')
    expect(classifyKmlCandidate({ name: 'ODP-RTP-FB-A07', geometryType: 'Point' })?.kind).toBe('ODP')
  })

  it('uses explicit source type before name hints', () => {
    expect(classifyKmlCandidate({
      name: 'POP example', geometryType: 'Point', attributes: { asset_type: 'ODC' },
    })).toEqual({ kind: 'ODC', label: 'ODC', evidence: 'atribut KML' })
    expect(classifyKmlCandidate({ name: 'Route 1', geometryType: 'LineString', attributes: { type: 'backbone' } }))
      .toEqual({ kind: 'cable', label: 'Jalur kabel', evidence: 'atribut KML' })
  })

  it('does not classify unrelated names or geometry-incompatible labels', () => {
    expect(classifyKmlCandidate({ name: 'Cimayang', geometryType: 'Polygon' })).toBeNull()
    expect(classifyKmlCandidate({ name: 'POP RANTAU PRAPAT', geometryType: 'LineString' })).toBeNull()
    expect(classifyKmlCandidate({ name: 'POPCORN', geometryType: 'Point' })).toBeNull()
  })
})
