import { useEffect, useRef, useState } from 'react'
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  LngLatBounds,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'

export type NetworkMapLayer = 'segments' | 'poles' | 'odcOdp'
export type NetworkMapStyle = 'liberty' | 'bright' | '3d'

export type NetworkMapProperties = {
  id: string
  name: string
  layer: NetworkMapLayer
  [key: string]: unknown
}

export type NetworkMapFeature = Feature<Geometry, NetworkMapProperties>

interface NetworkMapCanvasProps {
  features: NetworkMapFeature[]
  visibleLayers: Record<NetworkMapLayer, boolean>
  search: string
  style: NetworkMapStyle
}

const featureColor: ExpressionSpecification = [
  'match',
  ['get', 'layer'],
  'segments', '#0d6efd',
  'poles', '#fd7e14',
  'odcOdp', '#198754',
  '#6c757d',
]

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

export function NetworkMapCanvas({ features, visibleLayers, search, style }: NetworkMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const sourceRef = useRef<GeoJSONSource | null>(null)
  const boundsConstructorRef = useRef<typeof LngLatBounds | null>(null)
  const previousFeaturesRef = useRef<NetworkMapFeature[] | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mapLoadFailed, setMapLoadFailed] = useState(false)

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
        style: `https://tiles.openfreemap.org/styles/${style === '3d' ? 'liberty' : style}`,
        center: style === '3d' ? [106.8456, -6.2088] : [118, -2.5],
        zoom: style === '3d' ? 14.5 : 4.5,
        pitch: style === '3d' ? 50 : 0,
        bearing: style === '3d' ? -17.6 : 0,
      })
      map.addControl(new maplibre.NavigationControl(), 'top-right')
      mapRef.current = map

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
            'fill-color': featureColor,
            'fill-opacity': 0.25,
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
        const points: CircleLayerSpecification = {
          id: 'network-points',
          type: 'circle',
          source: 'network-features',
          filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
          paint: {
            'circle-color': featureColor,
            'circle-radius': 7,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        }
        loadedMap.addLayer(points)

        const source = loadedMap.getSource('network-features')
        if (source?.type === 'geojson') sourceRef.current = source as GeoJSONSource
        boundsConstructorRef.current = maplibre.LngLatBounds

        let activePopup: InstanceType<typeof maplibre.Popup> | null = null
        loadedMap.on('click', ['network-polygons', 'network-lines', 'network-points'], (event) => {
          const feature = event.features?.[0]
          if (!feature) return

          const properties = feature.properties as Record<string, unknown> | undefined
          const popupContent = document.createElement('div')
          const title = document.createElement('strong')
          title.textContent = String(properties?.name ?? properties?.id ?? 'Network feature')
          popupContent.append(title)
          if (typeof properties?.layer === 'string') {
            const detail = document.createElement('div')
            detail.textContent = properties.layer
            popupContent.append(detail)
          }

          activePopup?.remove()
          activePopup = new maplibre.Popup()
            .setLngLat(event.lngLat)
            .setDOMContent(popupContent)
            .addTo(loadedMap)
        })

        setMapLoadFailed(false)
        setMapReady(true)
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
      return visibleLayers[layer]
        && (!query || name.toLocaleLowerCase().includes(query) || id.toLocaleLowerCase().includes(query))
    })
    const collection: FeatureCollection<Geometry, NetworkMapProperties> = {
      type: 'FeatureCollection',
      features: visibleFeatures,
    }
    source.setData(collection)

    const LngLatBoundsClass = boundsConstructorRef.current
    if (previousFeaturesRef.current !== features && LngLatBoundsClass) {
      const bounds = getFeatureBounds(visibleFeatures, LngLatBoundsClass)
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 })
      previousFeaturesRef.current = features
    }
  }, [features, mapReady, search, visibleLayers])

  return (
    <>
      <div ref={containerRef} className="network-map-canvas" role="region" aria-label="Peta jaringan OpenFreeMap" />
      {mapLoadFailed && <p className="alert alert-warning mt-2 mb-0" role="alert">Peta gagal dimuat. Periksa koneksi lalu muat ulang halaman.</p>}
    </>
  )
}
