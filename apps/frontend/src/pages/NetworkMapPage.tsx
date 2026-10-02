import { useState } from 'react'
import { ContentCard } from '../components/ContentCard'
import { NetworkMapCanvas, type NetworkMapFeature, type NetworkMapLayer, type NetworkMapStyle } from '../components/NetworkMapCanvas'

// Replace with validated GeoJSON features from the network API when that endpoint exists.
const networkFeatures: NetworkMapFeature[] = []

const layerLabels: Record<NetworkMapLayer, string> = {
  segments: 'Segmen jaringan',
  poles: 'Tiang',
  odcOdp: 'ODC / ODP',
}

const mapStyleLabels: Record<NetworkMapStyle, string> = {
  liberty: 'Liberty',
  bright: 'Bright',
  '3d': '3D',
}

export function NetworkMapPage() {
  const [layers, setLayers] = useState({ segments: true, poles: true, odcOdp: true })
  const [search, setSearch] = useState('')
  const [mapStyle, setMapStyle] = useState<NetworkMapStyle>('liberty')

  function toggleLayer(layer: NetworkMapLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }

  return (
    <div className="row">
      <div className="col-lg-9">
        <ContentCard title="Peta jaringan" tools={<span className="badge text-bg-secondary">OpenFreeMap</span>}>
          <NetworkMapCanvas key={mapStyle} features={networkFeatures} visibleLayers={layers} search={search} style={mapStyle} />
          <p className="form-text mt-2 mb-0" role="status">
            {networkFeatures.length === 0
              ? 'Peta dasar tampil. Marker dan jalur akan muncul otomatis saat dataset berkoordinat tersedia.'
              : `${networkFeatures.length} fitur jaringan tersedia.`}
            {' '}Basemap memerlukan koneksi internet.
          </p>
        </ContentCard>
      </div>
      <div className="col-lg-3">
        <ContentCard title="Filter peta">
          <label className="form-label" htmlFor="network-map-style">Tampilan peta</label>
          <select id="network-map-style" className="form-select mb-3" value={mapStyle} onChange={(event) => setMapStyle(event.target.value as NetworkMapStyle)}>
            {(Object.keys(mapStyleLabels) as NetworkMapStyle[]).map((style) => (
              <option key={style} value={style}>{mapStyleLabels[style]}</option>
            ))}
          </select>
          {mapStyle === '3d' && <p className="form-text mt-n2">Mode 3D memakai Liberty dengan kamera miring; bangunan tampil mulai zoom 14.</p>}
          <label className="form-label" htmlFor="network-search">Cari segmen atau lokasi</label>
          <input id="network-search" className="form-control mb-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nama kabel / lokasi" />
          <fieldset>
            <legend className="form-label">Layer peta</legend>
            {(Object.keys(layerLabels) as NetworkMapLayer[]).map((layer) => (
              <div className="form-check" key={layer}>
                <input id={`layer-${layer}`} className="form-check-input" type="checkbox" checked={layers[layer]} onChange={() => toggleLayer(layer)} />
                <label className="form-check-label" htmlFor={`layer-${layer}`}>{layerLabels[layer]}</label>
              </div>
            ))}
          </fieldset>
          <p className="form-text mt-3 mb-0">Pencarian dan layer langsung memfilter fitur yang dipetakan.</p>
        </ContentCard>
      </div>
    </div>
  )
}
