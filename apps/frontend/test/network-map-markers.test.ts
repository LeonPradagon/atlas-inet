import { describe, expect, it } from 'vitest'
import { networkMapMarkerImage } from '../src/shared/network-map-markers'

describe('network map marker symbols', () => {
  it('distinguishes pole heights and operational splitter/cabinet types', () => {
    expect(networkMapMarkerImage({ layer: 'poles', heightM: 7 }, 'Point')).toBe('atlas-pole-7m')
    expect(networkMapMarkerImage({ layer: 'poles', heightM: 9 }, 'Point')).toBe('atlas-pole-9m')
    expect(networkMapMarkerImage({ layer: 'odc' }, 'Point')).toBe('atlas-pin-odc')
    expect(networkMapMarkerImage({ layer: 'odp' }, 'Point')).toBe('atlas-pin-odp')
  })

  it('marks an FDT inferred from source KML as an unconfirmed candidate', () => {
    expect(networkMapMarkerImage({
      layer: 'references', name: 'FDT-01', attributes: { kmlFolderPath: 'POP Site/FDT' },
    }, 'Point')).toBe('atlas-pin-fdt-candidate')
  })

  it('uses source pole height only when KML explicitly records 7 or 9 metres', () => {
    expect(networkMapMarkerImage({
      layer: 'references', name: 'Tiang-01', attributes: { kmlFolderPath: 'POLE', tinggi: '7 m' },
    }, 'Point')).toBe('atlas-pole-7m-candidate')
    expect(networkMapMarkerImage({
      layer: 'references', name: 'Tiang-02', attributes: { kmlFolderPath: 'POLE', tinggi: '9 m' },
    }, 'Point')).toBe('atlas-pole-9m-candidate')
    expect(networkMapMarkerImage({
      layer: 'references', name: 'Tiang-03', attributes: { kmlFolderPath: 'POLE', tinggi: '5 m' },
    }, 'Point')).toBe('atlas-pole-unknown-candidate')
  })
})
