import { useEffect, useRef, useState } from 'react'
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  LngLatBounds,
  LngLatLike,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { classifyKmlCandidate } from '../shared/kml-classification'
import { prioritizeMapFeature } from '../shared/network-map-hover'
import { networkMapMarkerImage, networkMapMarkerStyles } from '../shared/network-map-markers'
import 'maplibre-gl/dist/maplibre-gl.css'

export type NetworkMapLayer = 'segments' | 'poles' | 'odc' | 'odp' | 'pops' | 'areas' | 'references'
export type NetworkMapFeatureLayer = NetworkMapLayer | 'analysis'
export type NetworkMapStyle = 'liberty' | 'bright' | 'satellite' | '3d'

const NETWORK_POINT_CLUSTER_MAX_ZOOM = 14

export type NetworkMapProperties = {
  id: string
  name: string
  layer: NetworkMapFeatureLayer
  [key: string]: unknown
}

export type NetworkMapFeature = Feature<Geometry, NetworkMapProperties>

interface NetworkMapCanvasProps {
  features: NetworkMapFeature[]
  visibleLayers: Partial<Record<NetworkMapFeatureLayer, boolean>>
  style: NetworkMapStyle
  onViewportChange?: (bbox: string) => void
  onSegmentSelect?: (id: string) => void
}

const featureColor: ExpressionSpecification = [
  'match',
  ['get', 'layer'],
  'segments', '#0d6efd',
  'poles', '#c2410c',
  'odc', '#6f42c1',
  'odp', '#198754',
  'pops', '#dc3545',
  'areas', '#ffd400',
  'references', '#d63384',
  'analysis', '#dc3545',
  '#6c757d',
]

function distanceLabel(distanceM: number) {
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(distanceM)} m`
}

function layerLabel(layer: string, geometryType?: string) {
  if (layer === 'references') {
    if (geometryType === 'Point' || geometryType === 'MultiPoint') return 'Titik referensi KML'
    if (geometryType === 'LineString' || geometryType === 'MultiLineString') return 'Garis referensi KML'
    return 'Placemark KML · referensi belum dipetakan'
  }
  const labels: Record<string, string> = {
    segments: 'Segmen kabel operasional',
    poles: 'Tiang',
    odc: 'ODC',
    odp: 'ODP',
    pops: 'POP · aset operasional',
    areas: 'Area referensi (poligon)',
    analysis: 'Lokasi analisis',
  }
  return labels[layer] ?? layer
}

function hoverTypeLabel(feature: { geometry: Geometry; properties?: Record<string, unknown> }) {
  const properties = feature.properties ?? {}
  const layer = typeof properties.layer === 'string' ? properties.layer : ''
  if (layer === 'references') {
    const attributes = properties.attributes && typeof properties.attributes === 'object'
      ? properties.attributes as Record<string, unknown>
      : {}
    const folderPath = properties.kmlFolderPath ?? attributes.kmlFolderPath
    const candidate = classifyKmlCandidate({
      name: String(properties.name ?? ''),
      geometryType: feature.geometry.type,
      folderPath: typeof folderPath === 'string' ? folderPath : undefined,
      attributes,
    })
    return candidate
      ? `Kandidat: ${candidate.label} · sumber ${candidate.evidence} (belum dikonfirmasi)`
      : 'Placemark KML · tipe belum dikenali'
  }
  if (layer === 'poles' && (properties.heightM === 7 || properties.heightM === 9)) return `Tiang ${properties.heightM} m`
  return layer ? layerLabel(layer) : 'Tipe belum diketahui'
}

function lineLengthLabel(feature: { geometry: Geometry; properties?: Record<string, unknown> }) {
  const properties = feature.properties ?? {}
  if (properties.layer === 'segments') return 'Panjang kabel'
  if (properties.layer !== 'references') return 'Panjang geometri'
  const attributes = properties.attributes && typeof properties.attributes === 'object'
    ? properties.attributes as Record<string, unknown>
    : {}
  const folderPath = properties.kmlFolderPath ?? attributes.kmlFolderPath
  const candidate = classifyKmlCandidate({
    name: String(properties.name ?? ''),
    geometryType: feature.geometry.type,
    folderPath: typeof folderPath === 'string' ? folderPath : undefined,
    attributes,
  })
  return candidate?.kind === 'cable' ? 'Panjang kabel' : 'Panjang geometri KML'
}

const kmlAttributeLabels: Record<string, string> = {
  OBJECT_ID: 'ID objek', NAMOBJ: 'Nama objek', DESA: 'Desa/kelurahan', KODE: 'Kode wilayah',
  WADMKD: 'Desa/kelurahan', WIADKD: 'Kode desa/kelurahan',
  WADMKC: 'Kecamatan', WIADKC: 'Kode kecamatan',
  WADMKK: 'Kabupaten/kota', WIADKK: 'Kode kabupaten/kota',
  WADMPR: 'Provinsi', WIADPR: 'Kode provinsi',
  PROVINSI: 'Provinsi', KAB_KOTA: 'Kabupaten/kota', KECAMATAN: 'Kecamatan', DESA_KELUR: 'Desa/kelurahan',
  KODE_DESA: 'Kode desa', JUMLAH_PEN: 'Jumlah penduduk', JUMLAH_KK: 'Jumlah kepala keluarga',
  LUAS_WILAY: 'Luas wilayah', LUAS_DESA: 'Luas desa', KEPADATAN: 'Kepadatan', GENERATED: 'Tanggal sumber',
  'LABEL-COLOR': 'Warna label', 'LABEL-OPACITY': 'Opasitas label', 'LABEL-SCALE': 'Skala label', ICON: 'Ikon sumber',
}

export function formatKmlAttributeLabel(key: string) {
  const friendly = kmlAttributeLabels[key.toUpperCase()]
  if (friendly) return `${friendly} (${key})`
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  return /^[A-Z0-9_]+$/.test(key) ? `${spaced[0]?.toLocaleUpperCase('id-ID') ?? ''}${spaced.slice(1).toLocaleLowerCase('id-ID')} (${key})` : spaced
}

function isEmptyKmlAttribute(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return true
  if (typeof value !== 'string') return false
  try {
    const parsed: unknown = JSON.parse(value)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.keys(parsed).length === 1 && (parsed as Record<string, unknown>)['@_name'] === key)
  } catch {
    return false
  }
}

function appendDetailList(parent: HTMLElement, rows: Array<[string, unknown]>) {
  const details = document.createElement('dl')
  details.className = 'network-map-popup-details'
  for (const [key, value] of rows) {
    const term = document.createElement('dt')
    term.textContent = key
    const description = document.createElement('dd')
    description.textContent = value === null || value === undefined || value === '' ? '—' : String(value)
    details.append(term, description)
  }
  parent.append(details)
}

function addPinIcon(map: MapLibreMap, name: string, color: string, glyph: string, isCandidate = false) {
  if (map.hasImage(name)) return
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return
  context.beginPath()
  context.moveTo(24, 62)
  context.bezierCurveTo(20, 55, 4, 38, 4, 22)
  context.arc(24, 22, 20, Math.PI, 0)
  context.bezierCurveTo(44, 38, 28, 55, 24, 62)
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = '#ffffff'
  context.stroke()
  context.beginPath()
  context.arc(24, 22, 13, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
  context.fillStyle = color
  context.font = `bold ${glyph.length > 1 ? 11 : 18}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(glyph, 24, 23)
  if (isCandidate) {
    context.beginPath()
    context.arc(39, 10, 8, 0, Math.PI * 2)
    context.fillStyle = '#ffffff'
    context.fill()
    context.strokeStyle = color
    context.lineWidth = 2
    context.stroke()
    context.fillStyle = color
    context.font = 'bold 12px Arial, sans-serif'
    context.fillText('?', 39, 10)
  }
  map.addImage(name, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 })
}

function addPoleIcon(map: MapLibreMap, name: string, color: string, heightM?: 7 | 9, isCandidate = false) {
  if (map.hasImage(name)) return
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return

  const top = heightM === 9 ? 5 : heightM === 7 ? 18 : 12
  const stroke = (lineWidth: number, strokeStyle: string) => {
    context.lineWidth = lineWidth
    context.strokeStyle = strokeStyle
    context.lineCap = 'round'
    context.beginPath()
    context.moveTo(24, top)
    context.lineTo(24, 54)
    context.moveTo(11, top + 4)
    context.lineTo(37, top + 4)
    context.moveTo(16, 55)
    context.lineTo(32, 55)
    context.stroke()
  }
  stroke(9, '#ffffff')
  stroke(5, color)

  if (isCandidate) {
    context.beginPath()
    context.arc(40, 38, 8, 0, Math.PI * 2)
    context.fillStyle = '#ffffff'
    context.fill()
    context.strokeStyle = color
    context.lineWidth = 2
    context.stroke()
    context.fillStyle = color
    context.font = 'bold 12px Arial, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('?', 40, 38)
  }
  map.addImage(name, context.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 })
}

function getFeatureBounds(features: NetworkMapFeature[], LngLatBoundsClass: typeof LngLatBounds) {
  const bounds = new LngLatBoundsClass()

  function extendCoordinates(coordinates: unknown) {
    if (!Array.isArray(coordinates)) return
    if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      bounds.extend([coordinates[0], coordinates[1]])
      return
    }
    coordinates.forEach(extendCoordinates)
  }

  function extendGeometry(geometry: Geometry) {
    if (geometry.type === 'GeometryCollection') {
      geometry.geometries.forEach(extendGeometry)
      return
    }
    extendCoordinates(geometry.coordinates)
  }

  features.forEach((feature) => extendGeometry(feature.geometry))
  return bounds
}

export function NetworkMapCanvas({ features, visibleLayers, style, onViewportChange, onSegmentSelect }: NetworkMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const sourceRef = useRef<GeoJSONSource | null>(null)
  const pointSourceRef = useRef<GeoJSONSource | null>(null)
  const boundsConstructorRef = useRef<typeof LngLatBounds | null>(null)
  const previousFeaturesRef = useRef<NetworkMapFeature[] | null>(null)
  const hasAutoFitRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapLoadFailed, setMapLoadFailed] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cssFullscreen, setCssFullscreen] = useState(false)
  const viewportCallback = useRef(onViewportChange)
  const segmentCallback = useRef(onSegmentSelect)
  viewportCallback.current = onViewportChange
  segmentCallback.current = onSegmentSelect

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === container || container.classList.contains('network-map-canvas-fallback-fullscreen'))
    document.addEventListener('fullscreenchange', syncFullscreen)

    let cancelled = false
    let map: MapLibreMap | null = null
    let resizeObserver: ResizeObserver | null = null

    void Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
    ]).then(([maplibre, worker]) => {
      if (cancelled) return

      maplibre.setWorkerUrl(worker.default)
      map = new maplibre.Map({
        container,
        style: style === 'satellite' ? {
          version: 8,
          sources: {
            'satellite-imagery': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              attribution: 'Tiles © Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
            },
          },
          layers: [{ id: 'satellite-imagery', type: 'raster', source: 'satellite-imagery', minzoom: 0, maxzoom: 19 }],
        } : `https://tiles.openfreemap.org/styles/${style === '3d' ? 'liberty' : style}`,
        center: style === '3d' ? [106.8456, -6.2088] : [118, -2.5],
        zoom: style === '3d' ? 14.5 : 4.5,
        pitch: style === '3d' ? 50 : 0,
        bearing: style === '3d' ? -17.6 : 0,
      })
      map.addControl(new maplibre.NavigationControl(), 'top-right')
      mapRef.current = map
      const reportViewport = () => {
        if (!map) return
        const bounds = map.getBounds()
        const west = Math.max(-180, bounds.getWest()), east = Math.min(180, bounds.getEast())
        const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth())
        if (west < east && south < north) viewportCallback.current?.([west, south, east, north].map((n) => n.toFixed(4)).join(','))
      }
      map.on('moveend', reportViewport)

      map.once('load', () => {
        if (cancelled || !map) return
        const loadedMap = map

        loadedMap.addSource('network-features', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        loadedMap.addSource('network-point-features', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: NETWORK_POINT_CLUSTER_MAX_ZOOM,
          clusterMinPoints: 2,
        })
        const polygons: FillLayerSpecification = {
          id: 'network-polygons',
          type: 'fill',
          source: 'network-features',
          filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
          paint: {
            'fill-color': ['case', ['boolean', ['feature-state', 'active'], false], '#ff2d55', featureColor],
            'fill-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0.34, ['==', ['get', 'layer'], 'areas'], 0.08, 0.25],
            'fill-outline-color': featureColor,
          },
        }
        loadedMap.addLayer(polygons)
        const lines: LineLayerSpecification = {
          id: 'network-lines',
          type: 'line',
          source: 'network-features',
          filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': featureColor,
            'line-width': 3,
            'line-opacity': 0.9,
          },
        }
        loadedMap.addLayer(lines)
        loadedMap.addLayer({
          id: 'area-boundary-casing',
          type: 'line',
          source: 'network-features',
          filter: ['all', ['==', ['get', 'layer'], 'areas'], ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]],
          paint: {
            'line-color': ['case', ['boolean', ['feature-state', 'active'], false], '#ffffff', '#17202a'],
            'line-width': ['case', ['boolean', ['feature-state', 'active'], false], 7, 5],
            'line-opacity': 0.9,
          },
        })
        loadedMap.addLayer({
          id: 'area-boundaries',
          type: 'line',
          source: 'network-features',
          filter: ['all', ['==', ['get', 'layer'], 'areas'], ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]],
          paint: {
            'line-color': ['case', ['boolean', ['feature-state', 'active'], false], '#ff2d55', '#ffd400'],
            'line-width': ['case', ['boolean', ['feature-state', 'active'], false], 4, 2.5],
            'line-opacity': 1,
          },
        })
        loadedMap.addLayer({
          id: 'area-labels',
          type: 'symbol',
          source: 'network-features',
          minzoom: 8,
          filter: ['all', ['==', ['get', 'layer'], 'areas'], ['has', 'name']],
          layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-allow-overlap': false },
          paint: { 'text-color': '#ffffff', 'text-halo-color': '#17202a', 'text-halo-width': 1.5 },
        })
        for (const [kind, marker] of Object.entries(networkMapMarkerStyles)) {
          const isPole = kind.startsWith('pole-')
          const icon = isPole ? `atlas-pole-${kind.slice(5)}` : `atlas-pin-${kind}`
          const poleHeight = kind === 'pole-7m' ? 7 : kind === 'pole-9m' ? 9 : undefined
          const addIcon = (iconName: string, candidate = false) => isPole
            ? addPoleIcon(loadedMap, iconName, marker.color, poleHeight, candidate)
            : addPinIcon(loadedMap, iconName, marker.color, marker.glyph, candidate)
          addIcon(icon)
          if (kind !== 'reference' && kind !== 'analysis') addIcon(`${icon}-candidate`, true)
        }
        loadedMap.addLayer({
          id: 'network-point-clusters',
          type: 'circle',
          source: 'network-point-features',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#0d6efd', 10, '#6f42c1', 100, '#fd7e14', 1000, '#dc3545'],
            'circle-radius': ['interpolate', ['exponential', 0.5], ['get', 'point_count'], 2, 12, 10, 18, 100, 29, 1000, 44],
            'circle-opacity': 0.92,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })
        loadedMap.addLayer({
          id: 'network-point-cluster-count',
          type: 'symbol',
          source: 'network-point-features',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': '#ffffff' },
        })
        const points: SymbolLayerSpecification = {
          id: 'network-points',
          type: 'symbol',
          source: 'network-point-features',
          filter: ['all', ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], ['!', ['has', 'point_count']]],
          layout: {
            'icon-image': ['get', 'mapIcon'],
            'icon-anchor': 'bottom',
            'icon-size': 0.9,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        }
        loadedMap.addLayer(points)

        const source = loadedMap.getSource('network-features')
        if (source?.type === 'geojson') sourceRef.current = source as GeoJSONSource
        const pointSource = loadedMap.getSource('network-point-features')
        if (pointSource?.type === 'geojson') pointSourceRef.current = pointSource as GeoJSONSource
        boundsConstructorRef.current = maplibre.LngLatBounds

        let activePopup: InstanceType<typeof maplibre.Popup> | null = null
        const lineHoverContent = document.createElement('div')
        lineHoverContent.className = 'network-map-line-hover'
        const lineHoverName = document.createElement('strong')
        const lineHoverType = document.createElement('span')
        const lineHoverSourceName = document.createElement('span')
        const lineHoverLength = document.createElement('span')
        lineHoverContent.append(lineHoverName, lineHoverType, lineHoverSourceName, lineHoverLength)
        const lineHoverPopup = new maplibre.Popup({ closeButton: false, closeOnClick: false, maxWidth: 'min(22rem, 80vw)', offset: 12, className: 'network-map-hover-popup' })
          .setDOMContent(lineHoverContent)
        let hoveredLineId = ''
        const featureHoverContent = document.createElement('div')
        featureHoverContent.className = 'network-map-feature-hover'
        const featureHoverName = document.createElement('strong')
        const featureHoverType = document.createElement('span')
        const featureHoverSourceName = document.createElement('span')
        featureHoverContent.append(featureHoverName, featureHoverType, featureHoverSourceName)
        const featureHoverPopup = new maplibre.Popup({ closeButton: false, closeOnClick: false, maxWidth: 'min(22rem, 80vw)', offset: 12, className: 'network-map-hover-popup' })
          .setDOMContent(featureHoverContent)
        let hoveredFeatureId = ''
        let highlightedAreaId: string | number | null = null
        let popupTitleHovered = false
        const showFeatureHover = (feature: { id?: string | number; geometry: Geometry; properties?: Record<string, unknown> | null }, lngLat: LngLatLike) => {
          const properties = feature.properties as Record<string, unknown> | undefined
          const id = String(feature.id ?? properties?.id ?? properties?.name ?? '')
          if (id !== hoveredFeatureId) {
            hoveredFeatureId = id
            const isReference = properties?.layer === 'references'
            featureHoverName.textContent = isReference ? 'Placemark KML' : String(properties?.name ?? 'Network feature')
            featureHoverType.textContent = hoverTypeLabel({ geometry: feature.geometry, properties })
            featureHoverSourceName.textContent = isReference ? `Nama Placemark sumber: ${String(properties?.name ?? '—')}` : ''
          }
          featureHoverPopup.setLngLat(lngLat)
          if (!featureHoverPopup.isOpen()) featureHoverPopup.addTo(loadedMap)
        }
        const hideFeatureHover = () => {
          hoveredFeatureId = ''
          featureHoverPopup.remove()
        }
        const highlightArea = (id: string | number | null) => {
          if (highlightedAreaId !== null) loadedMap.setFeatureState({ source: 'network-features', id: highlightedAreaId }, { active: false })
          highlightedAreaId = id
          if (id !== null) loadedMap.setFeatureState({ source: 'network-features', id }, { active: true })
        }
        loadedMap.on('mouseenter', 'network-point-clusters', () => { loadedMap.getCanvas().style.cursor = 'pointer' })
        loadedMap.on('mouseleave', 'network-point-clusters', () => { loadedMap.getCanvas().style.cursor = '' })
        loadedMap.on('click', ['network-point-clusters', 'network-point-cluster-count'], (event) => {
          const feature = event.features?.[0]
          const clusterId = Number(feature?.properties?.cluster_id)
          const coordinates = feature?.geometry.type === 'Point' ? feature.geometry.coordinates : null
          const clusterSource = loadedMap.getSource('network-point-features')
          if (!coordinates || !Number.isFinite(clusterId) || clusterSource?.type !== 'geojson') return
          void (clusterSource as GeoJSONSource).getClusterExpansionZoom(clusterId).then((zoom) => {
            loadedMap.easeTo({ center: [coordinates[0], coordinates[1]], zoom, duration: 350 })
          }).catch(() => undefined)
        })
        loadedMap.on('mousemove', (event) => {
          const point = event.point
          // Query each rendered layer at the exact pointer location; nearby pins must not
          // steal hover from cables or polygons because their hit areas overlap.
          const pinHits = loadedMap.queryRenderedFeatures(point, { layers: ['network-points'] })
          const lineAndAreaHits = loadedMap.queryRenderedFeatures(point, { layers: ['network-lines', 'network-polygons'] })
          const feature = prioritizeMapFeature([...pinHits, ...lineAndAreaHits])
          const properties = feature?.properties as Record<string, unknown> | undefined
          const isLine = feature && (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')
          const isArea = properties?.layer === 'areas'
            && (feature?.geometry.type === 'Polygon' || feature?.geometry.type === 'MultiPolygon')
          const areaId = isArea ? feature?.id : null
          highlightArea(typeof areaId === 'string' || typeof areaId === 'number' ? areaId : null)

          if (!feature) {
            hoveredLineId = ''
            lineHoverPopup.remove()
            hideFeatureHover()
            loadedMap.getCanvas().style.cursor = ''
            return
          }
          if (isLine) {
            const lineProperties = properties!
            const id = String(feature.id ?? lineProperties.id ?? '')
            if (id !== hoveredLineId) {
              hoveredLineId = id
              const isReference = lineProperties.layer === 'references'
              lineHoverName.textContent = isReference ? 'Geometri KML' : String(lineProperties.name ?? 'Segmen kabel')
              lineHoverType.textContent = hoverTypeLabel({ geometry: feature.geometry, properties: lineProperties })
              lineHoverSourceName.textContent = isReference ? `Nama Placemark sumber: ${String(lineProperties.name ?? '—')}` : ''
              const measureName = lineLengthLabel({ geometry: feature.geometry, properties: lineProperties })
              const sourceLength = lineProperties.sourceLengthM
              lineHoverLength.textContent = `${measureName}: ${typeof sourceLength === 'number' && Number.isFinite(sourceLength) ? distanceLabel(sourceLength) : 'belum tersedia'}`
            }
            hideFeatureHover()
            lineHoverPopup.setLngLat(event.lngLat)
            if (!lineHoverPopup.isOpen()) lineHoverPopup.addTo(loadedMap)
            loadedMap.getCanvas().style.cursor = 'help'
            return
          }
          hoveredLineId = ''
          lineHoverPopup.remove()
          showFeatureHover(feature, event.lngLat)
          loadedMap.getCanvas().style.cursor = 'pointer'
        })
        loadedMap.getCanvas().addEventListener('mouseleave', () => {
          hoveredLineId = ''
          lineHoverPopup.remove()
          hideFeatureHover()
          loadedMap.getCanvas().style.cursor = ''
          if (!popupTitleHovered) highlightArea(null)
        })
        loadedMap.on('click', ['network-polygons', 'network-lines', 'network-points', 'area-boundaries', 'area-boundary-casing'], (event) => {
          const clusterUnderPointer = loadedMap.queryRenderedFeatures(event.point, {
            layers: ['network-point-clusters', 'network-point-cluster-count'],
          }).some((candidate) => Number(candidate.properties?.point_count) > 0)
          if (clusterUnderPointer) return
          const hits = event.features ?? []
          const feature = prioritizeMapFeature(hits)
          if (!feature) return
          lineHoverPopup.remove()
          hoveredLineId = ''
          hideFeatureHover()

          const properties = feature.properties as Record<string, unknown> | undefined
          if (properties?.layer === 'segments' && typeof properties.id === 'string') segmentCallback.current?.(properties.id)
          const popupContent = document.createElement('div')
          const title = document.createElement('strong')
          title.className = 'network-map-popup-title'
          title.textContent = String(properties?.name ?? properties?.id ?? 'Network feature')
          if (properties?.layer === 'areas' && (typeof feature.id === 'string' || typeof feature.id === 'number')) {
            const areaId = feature.id
            title.tabIndex = 0
            title.title = 'Arahkan kursor atau fokuskan nama untuk menyorot coverage'
            title.addEventListener('mouseenter', () => { popupTitleHovered = true; highlightArea(areaId) })
            title.addEventListener('mouseleave', () => { popupTitleHovered = false; highlightArea(null) })
            title.addEventListener('focus', () => { popupTitleHovered = true; highlightArea(areaId) })
            title.addEventListener('blur', () => { popupTitleHovered = false; highlightArea(null) })
          }
          const header = document.createElement('div')
          header.className = 'network-map-popup-header'
          header.append(title)
          const closeButton = document.createElement('button')
          closeButton.type = 'button'
          closeButton.className = 'network-map-popup-close btn btn-outline-secondary btn-sm'
          closeButton.title = 'Tutup'
          closeButton.setAttribute('aria-label', 'Tutup detail fitur peta')
          const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          closeIcon.setAttribute('viewBox', '0 0 16 16')
          closeIcon.setAttribute('width', '16')
          closeIcon.setAttribute('height', '16')
          closeIcon.setAttribute('aria-hidden', 'true')
          const cross = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          cross.setAttribute('d', 'M3 3l10 10M13 3L3 13')
          cross.setAttribute('fill', 'none')
          cross.setAttribute('stroke', 'currentColor')
          cross.setAttribute('stroke-width', '1.8')
          cross.setAttribute('stroke-linecap', 'round')
          closeButton.textContent = ''
          closeIcon.append(cross)
          closeButton.append(closeIcon)
          closeButton.addEventListener('click', (clickEvent) => {
            clickEvent.stopPropagation()
            activePopup?.remove()
          })
          header.append(closeButton)
          popupContent.append(header)
          if (typeof properties?.layer === 'string') {
            const detail = document.createElement('div')
            detail.className = 'network-map-popup-layer'
            detail.textContent = hoverTypeLabel({ geometry: feature.geometry, properties })
            popupContent.append(detail)
          }
          const rawAttributes = properties?.attributes && typeof properties.attributes === 'object'
            ? properties.attributes as Record<string, unknown>
            : {}
          const kmlFolderPath = properties?.kmlFolderPath ?? rawAttributes.kmlFolderPath
          const kmlCandidate = properties?.layer === 'references'
            ? classifyKmlCandidate({
                name: String(properties.name ?? ''),
                geometryType: feature.geometry.type,
                folderPath: typeof kmlFolderPath === 'string' ? kmlFolderPath : undefined,
                attributes: rawAttributes,
              })
            : null
          const sourceAttributes = Object.entries(rawAttributes)
            .filter(([key, value]) => !['name', 'kmlfolderpath'].includes(key.toLowerCase()) && !isEmptyKmlAttribute(key, value))
          const geometry = feature.geometry
          const summaryRows: Array<[string, unknown]> = []
          if (kmlCandidate) summaryRows.push(['Kandidat tipe dari KML', `${kmlCandidate.label} · ${kmlCandidate.evidence}`])
          if (typeof kmlFolderPath === 'string' && kmlFolderPath) summaryRows.push(['Folder KML', kmlFolderPath])
          if (typeof properties?.segmentCode === 'string') summaryRows.push(['Kode segmen', properties.segmentCode])
          if (typeof properties?.status === 'string') summaryRows.push(['Status', properties.status === 'ACTIVE' ? 'Aktif' : properties.status === 'INACTIVE' ? 'Nonaktif' : properties.status])
          if (typeof properties?.capacityValidated === 'boolean') summaryRows.push(['Kapasitas tervalidasi', properties.capacityValidated ? 'Ya' : 'Belum'])
          if (typeof properties?.heightM === 'number') summaryRows.push(['Tinggi tiang', `${properties.heightM} m`])
          if (typeof properties?.areaCode === 'string') summaryRows.push(['Kode area', properties.areaCode])
          if ((properties?.layer === 'references' || properties?.layer === 'segments') && (geometry.type === 'LineString' || geometry.type === 'MultiLineString') && Number.isFinite(Number(properties.sourceLengthM))) {
            const measureName = lineLengthLabel({ geometry: feature.geometry, properties })
            summaryRows.push([measureName, distanceLabel(Number(properties.sourceLengthM))])
          }
          const coordinate = geometry.type === 'Point' ? geometry.coordinates
            : geometry.type === 'LineString' ? geometry.coordinates[0]
              : geometry.type === 'MultiLineString' ? geometry.coordinates[0]?.[0]
                : geometry.type === 'Polygon' ? geometry.coordinates[0]?.[0]
                  : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0]?.[0] : undefined
          if (coordinate && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])) {
            const coordinateLabel = geometry.type === 'Point' ? 'Koordinat (lintang, bujur)' : 'Koordinat pertama (lintang, bujur)'
            summaryRows.push([coordinateLabel, `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`])
          }
          if (summaryRows.length) appendDetailList(popupContent, summaryRows)
          if (kmlCandidate) {
            const note = document.createElement('p')
            note.className = 'network-map-popup-inference'
            note.setAttribute('role', 'note')
            note.textContent = 'Kandidat dikenali dari data sumber; belum dikonfirmasi sebagai aset operasional.'
            popupContent.append(note)
          }
          if (sourceAttributes.length) {
            const sourceDetails = document.createElement('details')
            sourceDetails.className = 'network-map-popup-source'
            const summary = document.createElement('summary')
            summary.textContent = `Atribut sumber KML (${sourceAttributes.length})`
            sourceDetails.append(summary)
            appendDetailList(sourceDetails, sourceAttributes.map(([key, value]) => [formatKmlAttributeLabel(key), value]))
            popupContent.append(sourceDetails)
          }

          activePopup?.remove()
          activePopup = new maplibre.Popup({ maxWidth: 'min(34rem, 84vw)', closeButton: false })
            .setLngLat(event.lngLat)
            .setDOMContent(popupContent)
            .addTo(loadedMap)
          activePopup.on('close', () => {
            popupTitleHovered = false
            highlightArea(null)
          })
        })

        setMapLoadFailed(false)
        setMapReady(true)
        reportViewport()
      })

      map.on('error', () => {
        if (!cancelled && !map?.isStyleLoaded()) setMapLoadFailed(true)
      })

      resizeObserver = new ResizeObserver(() => map?.resize())
      resizeObserver.observe(container)
    }).catch(() => {
      if (!cancelled) setMapLoadFailed(true)
    })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      document.removeEventListener('fullscreenchange', syncFullscreen)
      map?.remove()
      mapRef.current = null
      sourceRef.current = null
      pointSourceRef.current = null
      boundsConstructorRef.current = null
      previousFeaturesRef.current = null
    }
  }, [style])

  async function toggleFullscreen() {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement === container) {
      await document.exitFullscreen().catch(() => {
        setCssFullscreen(false)
        setIsFullscreen(false)
      })
      return
    }
    if (cssFullscreen) {
      setCssFullscreen(false)
      setIsFullscreen(false)
      return
    }
    try {
      await container.requestFullscreen()
    } catch {
      // Keep expand usable in embedded browsers that block the native fullscreen API.
      setCssFullscreen(true)
      setIsFullscreen(true)
    }
    requestAnimationFrame(() => mapRef.current?.resize())
  }

  useEffect(() => {
    if (!cssFullscreen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCssFullscreen(false)
        setIsFullscreen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cssFullscreen])

  useEffect(() => {
    if (!cssFullscreen) return
    requestAnimationFrame(() => mapRef.current?.resize())
  }, [cssFullscreen])

  useEffect(() => {
    const map = mapRef.current
    const source = sourceRef.current
    const pointSource = pointSourceRef.current
    if (!mapReady || !map || !source || !pointSource) return

    const visibleFeatures = features.filter((feature) => visibleLayers[feature.properties.layer] !== false)
    const pointFeatures: NetworkMapFeature[] = []
    const nonPointFeatures: NetworkMapFeature[] = []
    for (const feature of visibleFeatures) {
      if (feature.geometry.type === 'Point') pointFeatures.push({
        ...feature,
        properties: { ...feature.properties, mapIcon: networkMapMarkerImage(feature.properties, feature.geometry.type) },
      })
      else if (feature.geometry.type === 'MultiPoint') {
        feature.geometry.coordinates.forEach((coordinates, index) => pointFeatures.push({
          ...feature,
          id: `${String(feature.id ?? feature.properties.id)}:point-${index}`,
          geometry: { type: 'Point', coordinates },
          properties: { ...feature.properties, mapIcon: networkMapMarkerImage(feature.properties, 'Point') },
        }))
      } else nonPointFeatures.push(feature)
    }
    const collection: FeatureCollection<Geometry, NetworkMapProperties> = { type: 'FeatureCollection', features: nonPointFeatures }
    const pointCollection: FeatureCollection<Geometry, NetworkMapProperties> = { type: 'FeatureCollection', features: pointFeatures }
    source.setData(collection)
    pointSource.setData(pointCollection)

    const LngLatBoundsClass = boundsConstructorRef.current
    if (previousFeaturesRef.current !== features) {
      previousFeaturesRef.current = features
      if (!hasAutoFitRef.current && visibleFeatures.length > 0 && LngLatBoundsClass) {
        const bounds = getFeatureBounds(visibleFeatures, LngLatBoundsClass)
        if (!bounds.isEmpty()) {
          hasAutoFitRef.current = true
          map.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 0 })
        }
      }
    }
  }, [features, mapReady, visibleLayers])

  return (
    <>
      <div ref={containerRef} className={`network-map-canvas${cssFullscreen ? ' network-map-canvas-fallback-fullscreen' : ''}`} role="region" aria-label="Peta jaringan OpenFreeMap">
        <button className="network-map-fullscreen btn btn-light btn-sm" type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Keluar dari layar penuh' : 'Tampilkan peta layar penuh'} title={isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}>
          <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`} aria-hidden="true" />
          <span className="visually-hidden">{isFullscreen ? 'Keluar layar penuh' : 'Layar penuh'}</span>
        </button>
      </div>
      {mapLoadFailed && <p className="alert alert-warning mt-2 mb-0" role="alert">Peta gagal dimuat. Periksa koneksi lalu muat ulang halaman.</p>}
    </>
  )
}
