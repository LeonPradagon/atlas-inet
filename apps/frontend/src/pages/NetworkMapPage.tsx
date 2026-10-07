import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { SegmentDetail } from '../components/SegmentTools'
import { ContentCard } from '../components/ContentCard'
import { NetworkMapCanvas, type NetworkMapFeature, type NetworkMapLayer, type NetworkMapStyle } from '../components/NetworkMapCanvas'
import { networkMapMarkerLegend } from '../shared/network-map-markers'


const layerLabels: Record<NetworkMapLayer, string> = {
  segments: 'Segmen jaringan',
  poles: 'Tiang',
  odc: 'ODC',
  odp: 'ODP',
  pops: 'POP',
  areas: 'Area referensi (poligon)',
  references: 'Placemark KML (titik/garis referensi)',
}

const mapStyleLabels: Record<NetworkMapStyle, string> = {
  liberty: 'Liberty',
  bright: 'Bright',
  satellite: 'Satelit (citra)',
  '3d': '3D',
}

function viewportCoveredBy(loaded: string, current: string) {
  const loadedBounds = loaded.split(',').map(Number)
  const currentBounds = current.split(',').map(Number)
  return loadedBounds.length === 4 && currentBounds.length === 4
    && loadedBounds.every(Number.isFinite) && currentBounds.every(Number.isFinite)
    && loadedBounds[0] <= currentBounds[0] && loadedBounds[1] <= currentBounds[1]
    && loadedBounds[2] >= currentBounds[2] && loadedBounds[3] >= currentBounds[3]
}

export function NetworkMapPage() {
  const [layers, setLayers] = useState({ segments: true, poles: true, odc: true, odp: true, pops: true, areas: true, references: true })
  const [mapStyle, setMapStyle] = useState<NetworkMapStyle>('liberty')
  const { entity, user, can } = useEntityScope()
  const [bbox, setBbox] = useState('')
  const [loadedBbox, setLoadedBbox] = useState('')
  const [selected, setSelected] = useState('')
  const selectedLayers = (Object.keys(layers) as NetworkMapLayer[]).filter((layer) => layers[layer]).join(',')
  const query = useQuery({
    queryKey: domainKey(entity?.id, user?.id, 'map', loadedBbox, selectedLayers),
    enabled: Boolean(entity && loadedBbox && selectedLayers) && can('network.read'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
    const first = await atlasApi.network.map(entity!.id, loadedBbox, selectedLayers, 1, signal)
    const total = first.meta?.total ?? first.data.features.length
    const pageSize = first.meta?.pageSize ?? 1000
    const pageCount = Math.ceil(total / pageSize)
    const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      atlasApi.network.map(entity!.id, loadedBbox, selectedLayers, index + 2, signal)))
    const features = new Map<string, NetworkMapFeature>()
    for (const feature of [...first.data.features, ...remaining.flatMap((response) => response.data.features)]) {
      features.set(String(feature.id), feature)
    }
    return { features: [...features.values()], total }
  } })
  const networkFeatures = selectedLayers ? query.data?.features ?? [] : []
  const viewportCovered = Boolean(loadedBbox && bbox && viewportCoveredBy(loadedBbox, bbox))

  function toggleLayer(layer: NetworkMapLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }

  function handleViewportChange(nextBbox: string) {
    setBbox(nextBbox)
    setLoadedBbox((current) => current || nextBbox)
  }

  function loadCurrentViewport() {
    if (!bbox || query.isFetching) return
    if (bbox !== loadedBbox) setLoadedBbox(bbox)
    else void query.refetch()
  }

  return (
    <div className="row">
      <div className="col-lg-9">
        <ContentCard title="Peta jaringan" tools={<span className="badge text-bg-secondary">OpenFreeMap</span>}>
          <NetworkMapCanvas key={mapStyle} features={networkFeatures} visibleLayers={layers} style={mapStyle} onViewportChange={handleViewportChange} onSegmentSelect={setSelected} />
          {bbox && selectedLayers && <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
            <button className="btn btn-sm btn-outline-primary" type="button" disabled={query.isFetching} onClick={loadCurrentViewport}>
              {query.isFetching ? 'Memuat data…' : viewportCovered ? 'Perbarui data peta' : 'Muat data area ini'}
            </button>
            <span className="small text-secondary" role="status">
              {networkFeatures.length} dari {query.data?.total ?? 0} fitur dimuat
              {!viewportCovered ? ' · area berubah, data belum dimuat' : ''}
              {query.isFetching ? ' · sedang memuat' : ''}
            </span>
          </div>}
          {query.isError && <div className="alert alert-danger mt-3" role="alert">Sebagian data peta gagal dimuat. Periksa koneksi, lalu perbarui data peta.</div>}
          <p className="form-text mt-2 mb-0" role="status">
            {networkFeatures.length === 0
              ? 'Belum ada fitur termuat pada viewport/layer ini.'
              : `${networkFeatures.length} fitur jaringan tersedia.`}
          </p>
          <div className="small text-secondary mt-2">
            <p className="mb-1"><strong>Petunjuk:</strong> hover pin untuk melihat tipe dan nama sumber; hover garis kabel untuk melihat nama serta panjang geometri. Klik fitur untuk detail, atau klik cluster pin untuk memperbesar.</p>
            <p className="mb-1">Placemark KML adalah data sumber, belum tentu aset operasional. Garis KML menunjukkan panjang geometri, bukan panjang kabel terpasang.</p>
            <p className="mb-0">Data dimuat per area peta. Geser peta lalu pilih <strong>Muat data area ini</strong> untuk area baru. Basemap perlu koneksi internet.</p>
          </div>
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
          {mapStyle === 'satellite' && <p className="form-text mt-n2">Citra satelit Esri, bukan citra Google Earth. Memerlukan koneksi internet.</p>}
          <fieldset>
            <legend className="form-label">Layer peta</legend>
            {(Object.keys(layerLabels) as NetworkMapLayer[]).map((layer) => (
              <div className="form-check" key={layer}>
                <input id={`layer-${layer}`} className="form-check-input" type="checkbox" checked={layers[layer]} onChange={() => toggleLayer(layer)} />
                <label className="form-check-label" htmlFor={`layer-${layer}`}>{layerLabels[layer]}</label>
              </div>
            ))}
          </fieldset>
          <details className="network-map-marker-legend mt-3">
            <summary>Legenda warna &amp; ikon</summary>
            <div className="network-map-marker-legend-grid mt-2">
              {networkMapMarkerLegend.map((item) => (
                <div className="network-map-marker-legend-item" key={item.kind}>
                  <span className={`network-map-marker-swatch${item.kind.startsWith('pole-') ? ' network-map-marker-swatch-pole' : ''}`} style={{ backgroundColor: item.color, color: item.color }} aria-hidden="true">
                    <span>{item.glyph}</span>
                    {'candidate' in item && item.candidate && <span className="network-map-marker-candidate-badge">?</span>}
                  </span>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <p className="small text-secondary mt-2 mb-0">Tanda ? berarti kandidat dikenali dari KML, belum dikonfirmasi sebagai aset operasional. Tinggi tiang tampil jika tersedia di sumber.</p>
          </details>
        </ContentCard>
        {selected && <SegmentDetail id={selected} mapContext />}
      </div>
    </div>
  )
}
