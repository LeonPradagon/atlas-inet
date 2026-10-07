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

  it('prefers specific Placemark or deepest equipment folder over parent POP folder', () => {
    expect(classifyKmlCandidate({
      name: 'THC-ODP-GNB-MS010/10', geometryType: 'Point',
      folderPath: 'FTTH DUKODU ALL/POP GUNUNG BUNDER/THC-MS-GNB-11/ODP',
    })?.kind).toBe('ODP')
    expect(classifyKmlCandidate({
      name: 'PL-DB-MS01-001', geometryType: 'Point', folderPath: 'POP GUNUNG BUNDER/THC-GNB-01/POLE',
    })?.kind).toBe('pole')
    expect(classifyKmlCandidate({
      name: 'POP RANTAU PRAPAT', geometryType: 'Point', folderPath: 'FTTH/POP RANTAU PRAPAT',
    })?.kind).toBe('POP')
    expect(classifyKmlCandidate({
      name: '108', geometryType: 'Point', folderPath: 'POP TAMANSARI/BACKBONE AND FEEDER/PL',
    })).toBeNull()
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
