import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { QueryState } from '../components/DomainUi'
import { SegmentDetail } from '../components/SegmentTools'
import { ContentCard } from '../components/ContentCard'
import { NetworkMapCanvas, type NetworkMapFeature, type NetworkMapLayer, type NetworkMapStyle } from '../components/NetworkMapCanvas'


const layerLabels: Record<NetworkMapLayer, string> = {
  segments: 'Segmen jaringan',
  poles: 'Tiang',
  odc: 'ODC',
  odp: 'ODP',
}

const mapStyleLabels: Record<NetworkMapStyle, string> = {
  liberty: 'Liberty',
  bright: 'Bright',
  '3d': '3D',
}

export function NetworkMapPage() {
  const [layers, setLayers] = useState({ segments: true, poles: true, odc: true, odp: true })
  const [search, setSearch] = useState('')
  const [mapStyle, setMapStyle] = useState<NetworkMapStyle>('liberty')
  const { entity, user, can } = useEntityScope()
  const [bbox, setBbox] = useState('')
  const [selected, setSelected] = useState('')
  const selectedLayers = (Object.keys(layers) as NetworkMapLayer[]).filter((layer) => layers[layer]).join(',')
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'map', bbox, selectedLayers), enabled: Boolean(entity && bbox && selectedLayers) && can('network.read'), queryFn: async ({ signal }) => {
    const features = new Map<string, NetworkMapFeature>()
    let total = 0
    for (let page = 1; page <= 10; page++) {
      const response = await atlasApi.network.map(entity!.id, bbox, selectedLayers, page, signal)
      total = response.meta?.total ?? 0
      for (const feature of response.data.features) features.set(String(feature.id), feature)
      if (page * 100 >= total) break
    }
    return { features: [...features.values()], total }
  } })
  const networkFeatures = selectedLayers ? query.data?.features ?? [] : []

  function toggleLayer(layer: NetworkMapLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }

  return (
    <div className="row">
      <div className="col-lg-9">
        <ContentCard title="Peta jaringan" tools={<span className="badge text-bg-secondary">OpenFreeMap</span>}>
          <NetworkMapCanvas key={mapStyle} features={networkFeatures} visibleLayers={layers} search={search} style={mapStyle} onViewportChange={setBbox} onSegmentSelect={setSelected} />
          {bbox && selectedLayers && <QueryState query={query} empty={networkFeatures.length === 0}><p className="small">{networkFeatures.length} dari {query.data?.total} fitur viewport dimuat.</p></QueryState>}
          {(query.data?.total ?? 0) > 1000 && <div className="alert alert-warning">Viewport berisi lebih dari 1.000 fitur. Zoom lebih dekat; data tidak dimuat seluruhnya.</div>}
          <p className="form-text mt-2 mb-0" role="status">
            {networkFeatures.length === 0
              ? 'Belum ada fitur termuat pada viewport/layer ini.'
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
        {selected && <SegmentDetail id={selected} />}
      </div>
    </div>
  )
}
