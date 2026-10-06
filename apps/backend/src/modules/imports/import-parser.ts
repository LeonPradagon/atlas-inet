import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { readKmlDocument, type UploadFile } from '../files/tabular-files.js'

const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2).max(10_000) }).strict(),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2).max(10_000)).min(1).max(100) }).strict(),
])
const referenceFeatureSchema = z.object({
  rowNumber: z.number().int().positive(), externalId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500), geometry: geometrySchema, assetRowValid: z.boolean(),
  properties: z.record(z.string(), z.string()).default({}),
}).strict().refine((feature) => {
  if (feature.geometry.type === 'Point') return true
  const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates
  return lines.some((line) => line.some((point) => point[0] !== line[0][0] || point[1] !== line[0][1]))
}, 'Reference line must have nonzero length')
export type ReferenceFeatureRow = z.infer<typeof referenceFeatureSchema>
const polygonRing = z.array(position).min(4).max(100_000).refine((ring) => {
  const first = ring[0], last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1]
}, 'Polygon ring must be closed')
const referenceAreaGeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(polygonRing).min(1).max(1_000) }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(polygonRing).min(1).max(1_000)).min(1).max(1_000) }).strict(),
])
const referenceAreaSchema = z.object({
  rowNumber: z.number().int().positive(), externalId: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(500), geometry: referenceAreaGeometrySchema,
  properties: z.record(z.string(), z.string()).default({}),
}).strict()
export type ReferenceAreaRow = z.infer<typeof referenceAreaSchema>
const assetFields = z.object({
  rowNumber: z.number().int().positive(), kind: z.enum(['SEGMENT','NODE','POLE','ODC','ODP']), externalId: z.string().trim().min(1).max(200), code: z.string().trim().min(1).max(200),
  geometry: geometrySchema, cableName: z.string().trim().min(1).max(200).optional(), cableTypeCode: z.string().trim().min(1).max(200).optional(),
  installedCoreCount: z.number().int().positive().max(1_000_000).optional(), capacityValidated: z.boolean().optional(),
  installationMethod: z.enum(['BURIAL','AERIAL']).optional(), roadSide: z.enum(['LEFT','RIGHT']).optional(),
  startNodeCode: z.string().max(200).optional(), endNodeCode: z.string().max(200).optional(), heightM: z.union([z.literal(7),z.literal(9)]).optional(), segmentCodes: z.array(z.string().min(1).max(200)).max(100).optional(),
  address: z.string().trim().min(1).max(1000).optional(),
  geocoding: z.object({ provider: z.string(), datasetVersion: z.string().nullable(), confirmedBy: z.string(), confirmedAt: z.string(), label: z.string(), precision: z.string().optional() }).strict().optional(),
}).strict()
export const pointAddressSchema = assetFields.omit({ geometry: true, geocoding: true }).extend({ kind: z.enum(['NODE','POLE','ODC','ODP']), address: z.string().trim().min(1).max(1000) })
  .refine((row) => row.kind !== 'POLE' || row.heightM !== undefined, 'Pole requires height 7 or 9')
  .refine((row) => !row.capacityValidated || row.installedCoreCount !== undefined, 'Validated capacity needs installed core')
  .refine((row) => !!row.startNodeCode === !!row.endNodeCode, 'Topology endpoints must be paired')
  .refine((row) => !row.roadSide || !!row.startNodeCode, 'Road side requires topology direction')
export type PointAddressRow = z.infer<typeof pointAddressSchema>
export interface ImportError {
  rowNumber: number; message: string; code?: string; sourceRow?: PointAddressRow;
  candidates?: { latitude: number; longitude: number; label: string; precision?: string }[];
  lookupId?: string; provider?: string; datasetVersion?: string | null;
  [key: string]: unknown;
}
export const assetRowSchema = assetFields.refine((row) => row.kind === 'SEGMENT' ? row.geometry.type !== 'Point' && !!row.cableName : row.geometry.type === 'Point', 'Segment needs a cable name and line geometry; other assets need Point geometry')
  .refine((row) => {
    if (row.geometry.type === 'Point') return true
    const lines = row.geometry.type === 'LineString' ? [row.geometry.coordinates] : row.geometry.coordinates
    return lines.some((line) => line.some((p) => p[0] !== line[0][0] || p[1] !== line[0][1]))
  }, 'Segment line must have nonzero length')
  .refine((row) => row.kind !== 'POLE' || row.heightM !== undefined, 'Pole requires height 7 or 9')
  .refine((row) => !row.capacityValidated || row.installedCoreCount !== undefined, 'Validated capacity needs installed core')
  .refine((row) => !!row.startNodeCode === !!row.endNodeCode, 'Topology endpoints must be paired')
  .refine((row) => !row.roadSide || !!row.startNodeCode, 'Road side requires topology direction')
export type AssetRow = z.infer<typeof assetRowSchema>
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}
export async function parseAssetFile(file: UploadFile, mappings: Record<string, Record<string, unknown>> = {}) {
  const input: { rowNumber: number; row: unknown; error?: string; reference?: unknown }[] = []
  const areas: ReferenceAreaRow[] = []
  const referenceFeatures: ReferenceFeatureRow[] = []
  {
    const document = await readKmlDocument(file)
    const placemarks: { placemark: Record<string, unknown>; folderPath: string[] }[] = []
    function walk(value: unknown, depth = 0, folderPath: string[] = []) {
      if (depth > 64) throw new BadRequestException('KML nesting is too deep')
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1, folderPath)); return }
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'Placemark') placemarks.push(...(Array.isArray(entry) ? entry : [entry]).map((placemark) => ({ placemark: placemark as Record<string, unknown>, folderPath })))
        else if (key === 'Folder') {
          for (const folder of (Array.isArray(entry) ? entry : [entry]) as Record<string, unknown>[]) {
            const name = String(folder.name ?? '').trim()
            walk(folder, depth + 1, name && folderPath.at(-1) !== name ? [...folderPath, name] : folderPath)
          }
        } else walk(entry, depth + 1, folderPath)
      }
    }
    const root = (document.kml ?? document) as Record<string, unknown>
    const documentNode = root.Document as Record<string, unknown> | undefined
    const documentName = String(documentNode?.name ?? '').trim()
    walk(document, 0, documentName ? [documentName] : [])
    if (!placemarks.length || placemarks.length > 20_000) throw new BadRequestException('KML needs 1..20,000 Placemarks')
    for (const [index, entry] of placemarks.entries()) {
      const p = entry.placemark
      const rowNumber = index + 1
      const metadata: Record<string, unknown> = {}
      const properties: Record<string, string> = {}
      const propertyValue = (value: unknown): string => {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim().slice(0, 2_000)
        if (value && typeof value === 'object') {
          const record = value as Record<string, unknown>
          return propertyValue(record['#text'] ?? record.value ?? JSON.stringify(value))
        }
        return ''
      }
      const extended = p.ExtendedData as Record<string, unknown> | undefined
      const setMetadata = (item: Record<string, unknown>, value: unknown) => {
        const key = String(item['@_name'] ?? '')
        if (key) {
          metadata[key] = value
          metadata[key.toLowerCase()] = value
          if (Object.keys(properties).length < 100) properties[key] = propertyValue(value)
        }
      }
      const data = extended?.Data
      for (const item of (Array.isArray(data) ? data : data ? [data] : []) as Record<string, unknown>[]) setMetadata(item, item.value)
      const schemaData = extended?.SchemaData
      for (const schema of (Array.isArray(schemaData) ? schemaData : schemaData ? [schemaData] : []) as Record<string, unknown>[]) {
        const simple = schema.SimpleData
        for (const item of (Array.isArray(simple) ? simple : simple ? [simple] : []) as Record<string, unknown>[]) setMetadata(item, item['#text'] ?? item)
      }
      const styles = p.Style === undefined ? [] : Array.isArray(p.Style) ? p.Style as Record<string, unknown>[] : [p.Style as Record<string, unknown>]
      for (const style of styles) {
        const labelStyle = style.LabelStyle as Record<string, unknown> | undefined
        if (labelStyle?.color !== undefined && properties['label-color'] === undefined) {
          const color = propertyValue(labelStyle.color)
          const kmlColor = /^([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)
          properties['label-color'] = kmlColor ? `#${kmlColor[4]}${kmlColor[3]}${kmlColor[2]}` : color
          if (kmlColor && properties['label-opacity'] === undefined) properties['label-opacity'] = String(Number.parseInt(kmlColor[1], 16) / 255)
        }
        if (labelStyle?.scale !== undefined) properties['label-scale'] = propertyValue(labelStyle.scale)
        const iconStyle = style.IconStyle as Record<string, unknown> | undefined
        const icon = iconStyle?.Icon as Record<string, unknown> | undefined
        if (icon?.href !== undefined) properties.icon = propertyValue(icon.href)
      }
      if (entry.folderPath.length) properties.kmlFolderPath = entry.folderPath.join('/')
      const sourceCableNameValue = metadata.cable_name ?? metadata.cablename ?? metadata.fiber_name ?? metadata.fibername ?? p.name ?? metadata.name
      const sourceCableName = sourceCableNameValue === undefined ? undefined : propertyValue(sourceCableNameValue)
      const featureName = sourceCableName || `Placemark ${rowNumber}`
      if (featureName && !properties.name) properties.name = featureName
      const coords = (value: unknown) => String(value).trim().split(/\s+/).map((pair) => {
        const parts = pair.split(',')
        if (parts.length < 2 || parts.length > 3 || parts.some((v) => !v.trim() || !Number.isFinite(Number(v)))) return [NaN,NaN]
        return parts.slice(0,2).map(Number)
      })
      const polygon = (value: unknown): number[][][] => {
        const item = value as Record<string, unknown>
        const rings: number[][][] = []
        const boundaries = (entry: unknown) => (Array.isArray(entry) ? entry : entry ? [entry] : []) as Record<string, unknown>[]
        for (const outer of boundaries(item.outerBoundaryIs)) {
          const ring = (outer.LinearRing as Record<string, unknown> | undefined)?.coordinates
          if (ring !== undefined) rings.push(coords(ring))
        }
        for (const boundary of boundaries(item.innerBoundaryIs)) {
          const ring = (boundary.LinearRing as Record<string, unknown> | undefined)?.coordinates
          if (ring !== undefined) rings.push(coords(ring))
        }
        return rings
      }
      const polygonItems = p.Polygon !== undefined ? [p.Polygon] : p.MultiGeometry !== undefined
        ? (() => {
            const children = p.MultiGeometry as Record<string, unknown>
            const unsupported = Object.keys(children).some((key) => key !== 'Polygon' && !key.startsWith('@_'))
            if (unsupported) return null
            const childPolygons = children.Polygon
            return childPolygons === undefined ? null : (Array.isArray(childPolygons) ? childPolygons : [childPolygons])
          })()
        : undefined
      if (polygonItems !== undefined) {
        if (!polygonItems) { input.push({ rowNumber, row: {}, error: 'Reference-area MultiGeometry may contain only Polygons' }); continue }
        const polygons = polygonItems.map(polygon)
        const geometry = polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons }
        const mapped = mappings[String(rowNumber)] ?? {}
        const fallback = String(p.name ?? metadata.name ?? `Area ${rowNumber}`).trim()
        const parsedArea = referenceAreaSchema.safeParse({
          rowNumber,
          externalId: mapped.externalId ?? p['@_id'] ?? `placemark-${rowNumber}`,
          code: mapped.code ?? metadata.code ?? p['@_id'] ?? fallback,
          name: mapped.name ?? p.name ?? metadata.name ?? fallback,
          geometry,
          properties,
        })
        if (parsedArea.success) areas.push(parsedArea.data)
        else input.push({ rowNumber, row: {}, error: parsedArea.error.issues.map((issue) => issue.message).join('; ') })
        continue
      }
      let geometry: unknown
      const geometryCount = ['LineString','Point','MultiGeometry','Polygon'].filter((key) => p[key] !== undefined).length
      if (geometryCount !== 1 && !(geometryCount === 0 && (p.address || mappings[String(rowNumber)]?.address))) {
        input.push({ rowNumber,row:{},error:'Exactly one supported geometry is required per Placemark' });continue
      }
      if (p.LineString !== undefined) geometry = { type: 'LineString', coordinates: coords((p.LineString as Record<string,unknown>).coordinates) }
      else if (p.Point !== undefined) geometry = { type: 'Point', coordinates: coords((p.Point as Record<string,unknown>).coordinates)[0] }
      else if (p.MultiGeometry !== undefined) {
        if (Object.keys(p.MultiGeometry as Record<string,unknown>).some((key) => key !== 'LineString' && !key.startsWith('@_'))) {
          input.push({ rowNumber,row:{},error:'MultiGeometry may contain only LineStrings' });continue
        }
        const lines = (p.MultiGeometry as Record<string,unknown>).LineString
        if (!lines) { input.push({ rowNumber, row: {}, error: 'MultiGeometry needs nonempty LineStrings' }); continue }
        geometry = { type: 'MultiLineString', coordinates: (Array.isArray(lines) ? lines : [lines]).map((line) => coords((line as Record<string,unknown>).coordinates)) }
      }
      const code = metadata.code ?? p['@_id']
      input.push({ rowNumber, reference: geometry ? { rowNumber, externalId: `placemark-${rowNumber}`, name: featureName.slice(0, 500), geometry, assetRowValid: false, properties } : undefined,
        row: clean({ kind: metadata.kind ?? (geometry && (geometry as { type: string }).type !== 'Point' ? 'SEGMENT' : undefined), externalId: p['@_id'], code, cableName: sourceCableName, geometry, address: p.address, ...(mappings[String(rowNumber)] ?? {}), rowNumber }) })
    }
  }
  const rows: AssetRow[] = []
  const errors: ImportError[] = []
  const seen = new Set<string>()
  const referenceIdentities = new Set<string>()
  const addReferenceFeature = (value: unknown) => {
    const parsed = referenceFeatureSchema.safeParse(value)
    if (!parsed.success || referenceIdentities.has(parsed.data.externalId)) return false
    referenceIdentities.add(parsed.data.externalId)
    referenceFeatures.push(parsed.data)
    return true
  }
  for (const item of input) {
    if ('geocoding' in (item.row as Record<string, unknown>)) { errors.push({ rowNumber: item.rowNumber, message: 'Geocoding provenance is server-owned' }); continue }
    if (!item.error && (item.row as Record<string, unknown>).geometry === undefined) {
      const draft = pointAddressSchema.safeParse(item.row)
      if (draft.success) {
        const identity = `${draft.data.kind}:${draft.data.externalId}`
        if (seen.has(identity)) { errors.push({ rowNumber: item.rowNumber, message: 'Duplicate source identity' }); continue }
        seen.add(identity)
        errors.push({ rowNumber: item.rowNumber, code: 'ADDRESS_NEEDS_GEOCODING', message: 'Alamat belum memiliki koordinat. Cari dan konfirmasi kandidat sebelum publish.', sourceRow: draft.data })
        continue
      }
      if ((item.row as Record<string, unknown>).kind === 'SEGMENT') {
        errors.push({ rowNumber: item.rowNumber, message: 'Segmen kabel memerlukan geometri garis aktual; alamat saja tidak dapat menentukan jalur kabel.' }); continue
      }
    }
    const parsed = assetRowSchema.safeParse(item.row)
    if (item.error || !parsed.success) {
      if (!addReferenceFeature(item.reference)) errors.push({ rowNumber: item.rowNumber, message: item.error ?? parsed.error?.issues.map((issue) => issue.message).join('; ') ?? 'Invalid asset row' })
      continue
    }
    const identity = `${parsed.data.kind}:${parsed.data.externalId}`
    if (seen.has(identity)) {
      if (!addReferenceFeature(item.reference)) errors.push({ rowNumber: item.rowNumber, message: 'Duplicate source identity' })
      continue
    }
    seen.add(identity)
    addReferenceFeature({ ...item.reference as Record<string, unknown>, assetRowValid: true })
    rows.push(parsed.data)
  }
  return { rows, areas, referenceFeatures, errors }
}
