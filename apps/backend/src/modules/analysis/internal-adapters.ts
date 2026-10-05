import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js'

async function boundedJson(url: string, body?: Record<string, unknown>, timeoutMs = 5000) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
  if (!response.ok || !response.body) throw new Error('Internal provider failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 1_000_000) throw new Error('Provider response is too large')
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

@Injectable()
export class InternalAdapters {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async geocode(address: string, individual = false) {
    const publicDevUrl = individual ? this.config.photonPublicDevUrl : undefined
    const photonUrl = this.config.photonInternalUrl ?? publicDevUrl
    if (photonUrl) {
      const provider = publicDevUrl ? 'PHOTON_PUBLIC_DEV' as const : 'PHOTON_INTERNAL' as const
      try {
        const url = new URL('api', photonUrl.replace(/\/?$/, '/'))
        url.searchParams.set('q', address)
        url.searchParams.set('countrycode', 'ID')
        url.searchParams.set('limit', '5')
        const response = z.object({ features: z.array(z.object({
          geometry: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]) }),
          properties: z.object({ countrycode: z.string(), name: z.string().optional(), street: z.string().optional(), housenumber: z.string().optional(), city: z.string().optional(), district: z.string().optional(), county: z.string().optional(), state: z.string().optional(), postcode: z.string().optional(), country: z.string().optional(), osm_value: z.string().optional() }),
        })).max(20) }).parse(await boundedJson(url.toString()))
        const candidates = response.features.filter((feature) => feature.properties.countrycode.toUpperCase() === 'ID').map((feature) => ({
          longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
          label: [...new Set([feature.properties.name, [feature.properties.street, feature.properties.housenumber].filter(Boolean).join(' '), feature.properties.district, feature.properties.city, feature.properties.county, feature.properties.state, feature.properties.postcode, feature.properties.country].filter(Boolean))].join(', ').slice(0, 1000),
          precision: feature.properties.housenumber ? 'ADDRESS' : feature.properties.osm_value ?? 'UNKNOWN',
        }))
        const provenance = { provider, datasetVersion: publicDevUrl ? null : this.config.geocodingDatasetVersion ?? null, attribution: '© OpenStreetMap contributors · ODbL 1.0' }
        if (!candidates.length) return { status: 'ADDRESS_NOT_FOUND' as const, ...provenance }
        // Photon has no calibrated confidence score. Never silently accept an area/street centroid.
        if (candidates.length > 1 || candidates[0].precision !== 'ADDRESS') return { status: 'AMBIGUOUS_ADDRESS' as const, candidates, ...provenance }
        return { status: 'OK' as const, candidate: candidates[0], ...provenance }
      } catch { return { status: 'GEOCODING_UNAVAILABLE' as const, provider } }
    }
    if (!this.config.geocodingInternalUrl) return { status: 'GEOCODING_NOT_CONFIGURED' as const }
    try {
      const result = z.object({ candidates: z.array(z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), label: z.string().max(1000) })).max(20) }).parse(await boundedJson(this.config.geocodingInternalUrl, { address }))
      if (!result.candidates.length) return { status: 'ADDRESS_NOT_FOUND' as const }
      if (result.candidates.length > 1) return { status: 'AMBIGUOUS_ADDRESS' as const, candidates: result.candidates }
      return { status: 'OK' as const, candidate: result.candidates[0], provider: 'INTERNAL_GEOCODING', datasetVersion: this.config.geocodingDatasetVersion ?? null }
    } catch { return { status: 'GEOCODING_UNAVAILABLE' as const } }
  }
  async route(from: { latitude: number; longitude: number }, to: unknown) {
    if (!this.config.routingInternalUrl) return null
    try {
      return z.object({ distanceM: z.number().finite().nonnegative(), shortestFeasibleDistanceM: z.number().finite().nonnegative(), policyVersion: z.string(), roadDatasetVersion: z.string(), geometry: z.object({ type: z.literal('LineString'), coordinates: z.array(z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])).min(2).max(10_000) }) })
        .refine((value) => value.distanceM >= value.shortestFeasibleDistanceM).parse(await boundedJson(this.config.routingInternalUrl, { from, to }, 30_000))
    } catch { return null }
  }
}
