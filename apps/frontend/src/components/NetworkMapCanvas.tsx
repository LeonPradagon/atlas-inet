import { useEffect, useRef, useState } from 'react'
import type {
  ExpressionSpecification,
  FillLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  LngLatBounds,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'

export type NetworkMapLayer = 'segments' | 'poles' | 'odc' | 'odp' | 'areas' | 'references'
export type NetworkMapFeatureLayer = NetworkMapLayer | 'analysis'
export type NetworkMapStyle = 'liberty' | 'bright' | 'satellite' | '3d'

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
  search: string
  focusFeature?: NetworkMapFeature | null
  style: NetworkMapStyle
  onViewportChange?: (bbox: string) => void
  onSegmentSelect?: (id: string) => void
}

const featureColor: ExpressionSpecification = [
  'match',
  ['get', 'layer'],
  'segments', '#0d6efd',
  'poles', '#fd7e14',
  'odc', '#6f42c1',
  'odp', '#198754',
  'areas', '#ffd400',
  'references', '#d63384',
  'analysis', '#dc3545',
  '#6c757d',
]

function addPinIcon(map: MapLibreMap, name: string, color: string) {
  if (map.hasImage(name)) return
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 44
  const context = canvas.getContext('2d')
  if (!context) return
  context.beginPath()
  context.moveTo(16, 42)
  context.bezierCurveTo(13, 37, 3, 25, 3, 15)
  context.arc(16, 15, 13, Math.PI, 0)
  context.bezierCurveTo(29, 25, 19, 37, 16, 42)
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#ffffff'
  context.stroke()
  context.beginPath()
  context.arc(16, 14, 4, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()
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

export function NetworkMapCanvas({ features, visibleLayers, search, focusFeature, style, onViewportChange, onSegmentSelect }: NetworkMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const sourceRef = useRef<GeoJSONSource | null>(null)
  const boundsConstructorRef = useRef<typeof LngLatBounds | null>(null)
  const previousFeaturesRef = useRef<NetworkMapFeature[] | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapLoadFailed, setMapLoadFailed] = useState(false)
  const viewportCallback = useRef(onViewportChange)
  const segmentCallback = useRef(onSegmentSelect)
  viewportCallback.current = onViewportChange
  segmentCallback.current = onSegmentSelect

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

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
        addPinIcon(loadedMap, 'atlas-pin-pole', '#fd7e14')
        addPinIcon(loadedMap, 'atlas-pin-odc', '#6f42c1')
        addPinIcon(loadedMap, 'atlas-pin-odp', '#198754')
        addPinIcon(loadedMap, 'atlas-pin-analysis', '#dc3545')
        addPinIcon(loadedMap, 'atlas-pin-reference', '#d63384')
        const points: SymbolLayerSpecification = {
          id: 'network-points',
          type: 'symbol',
          source: 'network-features',
          filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
          layout: {
            'icon-image': ['match', ['get', 'layer'], 'poles', 'atlas-pin-pole', 'odc', 'atlas-pin-odc', 'odp', 'atlas-pin-odp', 'references', 'atlas-pin-reference', 'analysis', 'atlas-pin-analysis', 'atlas-pin-analysis'],
            'icon-anchor': 'bottom',
            'icon-size': 0.9,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        }
        loadedMap.addLayer(points)

        const source = loadedMap.getSource('network-features')
        if (source?.type === 'geojson') sourceRef.current = source as GeoJSONSource
        boundsConstructorRef.current = maplibre.LngLatBounds

        let activePopup: InstanceType<typeof maplibre.Popup> | null = null
        let highlightedAreaId: string | number | null = null
        let popupTitleHovered = false
        const highlightArea = (id: string | number | null) => {
          if (highlightedAreaId !== null) loadedMap.setFeatureState({ source: 'network-features', id: highlightedAreaId }, { active: false })
          highlightedAreaId = id
          if (id !== null) loadedMap.setFeatureState({ source: 'network-features', id }, { active: true })
        }
        loadedMap.on('mousemove', 'network-polygons', (event) => {
          const feature = event.features?.find((candidate) => candidate.properties?.layer === 'areas')
          const id = feature?.id
          highlightArea(typeof id === 'string' || typeof id === 'number' ? id : null)
          loadedMap.getCanvas().style.cursor = feature ? 'pointer' : ''
        })
        loadedMap.on('mouseleave', 'network-polygons', () => {
          loadedMap.getCanvas().style.cursor = ''
          if (!popupTitleHovered) highlightArea(null)
        })
        loadedMap.on('click', ['network-polygons', 'network-lines', 'network-points', 'area-boundaries', 'area-boundary-casing'], (event) => {
          const feature = event.features?.[0]
          if (!feature) return

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
          popupContent.append(title)
          if (typeof properties?.layer === 'string') {
            const detail = document.createElement('div')
            detail.className = 'network-map-popup-layer'
            detail.textContent = properties.layer
            popupContent.append(detail)
          }
          const attributes = properties?.attributes && typeof properties.attributes === 'object'
            ? Object.entries(properties.attributes as Record<string, unknown>)
            : []
          if (!attributes.some(([key]) => key.toLowerCase() === 'name')) attributes.unshift(['name', properties?.name ?? ''])
          const geometry = feature.geometry
          const coordinate = geometry.type === 'Point' ? geometry.coordinates
            : geometry.type === 'LineString' ? geometry.coordinates[0]
              : geometry.type === 'MultiLineString' ? geometry.coordinates[0]?.[0] : undefined
          if (coordinate && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1])) {
            attributes.push(['koordinat', `${coordinate[1].toFixed(5)}, ${coordinate[0].toFixed(5)}`])
          }
          if (attributes.length) {
            const details = document.createElement('dl')
            details.className = 'network-map-popup-details'
            for (const [key, value] of attributes) {
              const term = document.createElement('dt')
              term.textContent = key
              const description = document.createElement('dd')
              description.textContent = value === null || value === undefined ? '' : String(value)
              details.append(term, description)
            }
            popupContent.append(details)
          }

          activePopup?.remove()
          activePopup = new maplibre.Popup({ maxWidth: 'min(34rem, 84vw)' })
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
      map?.remove()
      mapRef.current = null
      sourceRef.current = null
      boundsConstructorRef.current = null
      previousFeaturesRef.current = null
    }
  }, [style])

  useEffect(() => {
    const map = mapRef.current
    const source = sourceRef.current
    if (!mapReady || !map || !source) return

    const query = search.trim().toLocaleLowerCase()
    const visibleFeatures = features.filter((feature) => {
      const { id, name, layer } = feature.properties
      return visibleLayers[layer] !== false
        && (!query || name.toLocaleLowerCase().includes(query) || id.toLocaleLowerCase().includes(query))
    })
    const focusIsVisible = focusFeature && visibleLayers[focusFeature.properties.layer]
      && !visibleFeatures.some((feature) => feature.id === focusFeature.id) ? [focusFeature] : []
    const collection: FeatureCollection<Geometry, NetworkMapProperties> = {
      type: 'FeatureCollection',
      features: [...visibleFeatures, ...focusIsVisible],
    }
    source.setData(collection)

    const LngLatBoundsClass = boundsConstructorRef.current
    if (!viewportCallback.current && previousFeaturesRef.current !== features && LngLatBoundsClass) {
      const bounds = getFeatureBounds(visibleFeatures, LngLatBoundsClass)
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 })
      previousFeaturesRef.current = features
    }
  }, [features, focusFeature, mapReady, search, visibleLayers])

  useEffect(() => {
    const map = mapRef.current
    const Bounds = boundsConstructorRef.current
    if (!mapReady || !map || !focusFeature || !Bounds) return
    if (focusFeature.geometry.type === 'Point') {
      const [longitude, latitude] = focusFeature.geometry.coordinates
      map.flyTo({ center: [longitude, latitude], zoom: 16, duration: 700 })
      return
    }
    const bounds = getFeatureBounds([focusFeature], Bounds)
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 700 })
  }, [focusFeature, mapReady])

  return (
    <>
      <div ref={containerRef} className="network-map-canvas" role="region" aria-label="Peta jaringan OpenFreeMap" />
      {mapLoadFailed && <p className="alert alert-warning mt-2 mb-0" role="alert">Peta gagal dimuat. Periksa koneksi lalu muat ulang halaman.</p>}
    </>
  )
}
