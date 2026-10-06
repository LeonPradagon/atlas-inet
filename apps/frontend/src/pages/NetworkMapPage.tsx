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
  areas: 'Area Referensi',
  references: 'Placemark KML (referensi belum dipetakan)',
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
  const [layers, setLayers] = useState({ segments: true, poles: true, odc: true, odp: true, areas: true, references: true })
  const [search, setSearch] = useState('')
  const [focusFeature, setFocusFeature] = useState<NetworkMapFeature | null>(null)
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
  const searchText = search.trim()
  const searchQuery = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'network-search', searchText), enabled: Boolean(entity && searchText.length >= 2) && can('network.read'), queryFn: ({ signal }) => atlasApi.network.search(entity!.id, searchText, signal) })
  const searchGroups = [
    { layer: 'segments', title: 'Kabel / segmen' },
    { layer: 'odc', title: 'ODC' },
    { layer: 'odp', title: 'ODP' },
    { layer: 'poles', title: 'Tiang' },
  ].map((group) => ({ ...group, features: searchQuery.data?.data.filter((feature) => feature.properties.layer === group.layer) ?? [] })).filter((group) => group.features.length > 0)
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
          <NetworkMapCanvas key={mapStyle} features={networkFeatures} visibleLayers={layers} search={search} focusFeature={focusFeature} style={mapStyle} onViewportChange={handleViewportChange} onSegmentSelect={setSelected} />
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
            {' '}Placemark adalah objek sumber KML; nama dan atributnya tidak otomatis berarti POP, ODC, atau ODP. Titik Placemark tidak disambungkan otomatis tanpa garis/relasi sumber. Arahkan kursor ke garis untuk melihat panjang geometri sumber, bukan panjang kabel terpasang. Area dan fitur referensi bukan aset/kabel operasional. Basemap memerlukan koneksi internet.
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
          {mapStyle === 'satellite' && <p className="form-text mt-n2">Citra satelit Esri, bukan citra Google Earth. Memerlukan koneksi internet.</p>}
          <label className="form-label" htmlFor="network-search">Cari kabel, segmen, atau aset jaringan</label>
          <input id="network-search" className="form-control" value={search} onChange={(event) => { setSearch(event.target.value); setFocusFeature(null) }} placeholder="Nama kabel / kode segmen / kode aset" />
          {searchText.length === 1 && <p className="form-text">Masukkan minimal 2 karakter.</p>}
          {searchText.length >= 2 && <div className="mt-2" aria-live="polite">
            <QueryState query={searchQuery} empty={searchQuery.data?.data.length === 0}>
              {searchGroups.map((group) => <section key={group.layer} aria-label={`Hasil ${group.title}`}>
                <h6 className="mt-2 mb-1">{group.title}</h6>
                <ul className="list-group list-group-flush">{group.features.map((feature) => <li className="list-group-item px-0" key={String(feature.id)}>
                  <button className="btn btn-link text-start p-0" type="button" onClick={() => {
                    setFocusFeature(feature)
                    if (feature.properties.layer === 'segments') setSelected(feature.properties.id)
                    else setSelected('')
                  }}>
                    <strong>{feature.properties.name}</strong><br />
                    <small>{feature.properties.layer === 'segments' ? `${feature.properties.segmentCode ?? 'Segmen'} · kabel/jalur` : `Kode aset ${feature.properties.name}`} · navigasi ke peta</small>
                  </button>
                </li>)}</ul>
              </section>)}
            </QueryState>
            {searchQuery.data?.data && searchQuery.data.data.length >= 15 && <p className="form-text">Menampilkan hingga 15 hasil. Perjelas kata kunci untuk mempersempit.</p>}
          </div>}
          <fieldset>
            <legend className="form-label">Layer peta</legend>
            {(Object.keys(layerLabels) as NetworkMapLayer[]).map((layer) => (
              <div className="form-check" key={layer}>
                <input id={`layer-${layer}`} className="form-check-input" type="checkbox" checked={layers[layer]} onChange={() => toggleLayer(layer)} />
                <label className="form-check-label" htmlFor={`layer-${layer}`}>{layerLabels[layer]}</label>
              </div>
            ))}
          </fieldset>
          <p className="form-text mt-3 mb-0">Pencarian menjangkau seluruh jaringan published pada entitas ini; hasil memilih dan menggeser peta ke lokasi aset/segmen.</p>
        </ContentCard>
        {selected && <SegmentDetail id={selected} />}
      </div>
    </div>
  )
}
