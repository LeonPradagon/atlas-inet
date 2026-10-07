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
  rowNumber: z.number().int().positive(), kind: z.enum(['SEGMENT','NODE','POLE','ODC','ODP','POP']), externalId: z.string().trim().min(1).max(200), code: z.string().trim().min(1).max(200),
  geometry: geometrySchema, cableName: z.string().trim().min(1).max(200).optional(), cableTypeCode: z.string().trim().min(1).max(200).optional(),
  installedCoreCount: z.number().int().positive().max(1_000_000).optional(), capacityValidated: z.boolean().optional(),
  installationMethod: z.enum(['BURIAL','AERIAL']).optional(), roadSide: z.enum(['LEFT','RIGHT']).optional(),
  startNodeCode: z.string().max(200).optional(), endNodeCode: z.string().max(200).optional(), heightM: z.union([z.literal(5),z.literal(7)]).optional(), segmentCodes: z.array(z.string().min(1).max(200)).max(100).optional(),
  address: z.string().trim().min(1).max(1000).optional(),
  geocoding: z.object({ provider: z.string(), datasetVersion: z.string().nullable(), confirmedBy: z.string(), confirmedAt: z.string(), label: z.string(), precision: z.string().optional() }).strict().optional(),
}).strict()
export const assetClassificationSchema = assetFields.omit({ rowNumber: true, externalId: true, geometry: true, geocoding: true })
export type AssetClassificationInput = z.infer<typeof assetClassificationSchema>
export const pointAddressSchema = assetFields.omit({ geometry: true, geocoding: true }).extend({ kind: z.enum(['NODE','POLE','ODC','ODP','POP']), address: z.string().trim().min(1).max(1000) })
  .refine((row) => row.kind !== 'POLE' || row.heightM !== undefined, 'Pole requires height 5 or 7')
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
  .refine((row) => row.kind !== 'POLE' || row.heightM !== undefined, 'Pole requires height 5 or 7')
  .refine((row) => !row.capacityValidated || row.installedCoreCount !== undefined, 'Validated capacity needs installed core')
  .refine((row) => !!row.startNodeCode === !!row.endNodeCode, 'Topology endpoints must be paired')
  .refine((row) => !row.roadSide || !!row.startNodeCode, 'Road side requires topology direction')
export type AssetRow = z.infer<typeof assetRowSchema>
function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}
type ExplicitAssetKind = 'SEGMENT' | 'NODE' | 'POLE' | 'ODC' | 'ODP' | 'POP'
const explicitTypeFields = new Set([
  'type', 'kind', 'assetkind', 'assettype', 'networkkind', 'networktype', 'networkassettype', 'featuretype',
  'assetcategory', 'jenis', 'jenisaset', 'tipe', 'tipeaset', 'kategori', 'classification',
])
function metadataText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return metadataText(record['#text'] ?? record.value)
  }
  return ''
}
function explicitAssetKind(metadata: Record<string, unknown>): ExplicitAssetKind | null | undefined {
  const recognized = new Set<ExplicitAssetKind>()
  for (const [key, value] of Object.entries(metadata)) {
    if (!explicitTypeFields.has(key.toLowerCase().replace(/[^a-z]/g, ''))) continue
    const type = metadataText(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
    const kind: ExplicitAssetKind | undefined = ({
      POP: 'POP', 'POP SITE': 'POP', 'POINT OF PRESENCE': 'POP',
      ODC: 'ODC', 'OPTICAL DISTRIBUTION CABINET': 'ODC',
      ODP: 'ODP', 'OPTICAL DISTRIBUTION POINT': 'ODP',
      POLE: 'POLE', TIANG: 'POLE', 'TIANG JARINGAN': 'POLE',
      NODE: 'NODE', 'NETWORK NODE': 'NODE', 'NODE JARINGAN': 'NODE',
      SEGMENT: 'SEGMENT', CABLE: 'SEGMENT', 'CABLE LINE': 'SEGMENT',
      FIBER: 'SEGMENT', FIBRE: 'SEGMENT', 'FIBER CABLE': 'SEGMENT', 'FIBRE CABLE': 'SEGMENT',
      KABEL: 'SEGMENT', 'JALUR KABEL': 'SEGMENT', 'KABEL FIBER': 'SEGMENT',
      BACKBONE: 'SEGMENT', FEEDER: 'SEGMENT', DISTRIBUTION: 'SEGMENT',
    } as Record<string, ExplicitAssetKind>)[type]
    if (kind) recognized.add(kind)
  }
  if (recognized.size > 1) return null
  return recognized.values().next().value
}
function hasExplicitAssetType(metadata: Record<string, unknown>) {
  return Object.keys(metadata).some((key) => explicitTypeFields.has(key.toLowerCase().replace(/[^a-z]/g, '')))
}
function nameAssetKind(name: string, folderPath: string, geometryType: string): ExplicitAssetKind | undefined {
  const kindFromLabel = (label: string): ExplicitAssetKind | undefined => {
    if (geometryType === 'Point') {
      // Prefer specific equipment labels over a broad parent folder such as "POP Depok".
      if (/\b(?:ODC|OPTICAL DISTRIBUTION CABINET)\b/i.test(label)) return 'ODC'
      if (/\b(?:ODP|OPTICAL DISTRIBUTION POINT)\b/i.test(label)) return 'ODP'
      if (/\b(?:POLE|TIANG)\b/i.test(label)) return 'POLE'
      if (/\b(?:POP|POINT OF PRESENCE)\b/i.test(label)) return 'POP'
    }
    if ((geometryType === 'LineString' || geometryType === 'MultiLineString')
      && /\b(?:KABEL|CABLE|FIBER|FIBRE|BACKBONE|FEEDER|DISTRIBUTION)\b|\bBB[-_ ]?\d+\b|\bFDR[-_ ]?[A-Z0-9]+\b/i.test(label)) return 'SEGMENT'
    return undefined
  }

  const nameKind = kindFromLabel(name)
  if (nameKind) return nameKind
  if (geometryType === 'Point' && /\b(?:FDT|FAT|OLT|ODF|SLACK)\b/i.test(name)) return undefined
  const folders = folderPath.split('/').map((folder) => folder.trim()).filter(Boolean).reverse()
  for (const [index, folder] of folders.entries()) {
    const kind = kindFromLabel(folder)
    if (kind) {
      // A POP folder is commonly a site/container. Only infer POP when Placemark sits
      // directly in it; nested equipment folders must classify themselves.
      if (kind !== 'POP' || index === 0) return kind
      return undefined
    }
    if (geometryType === 'Point' && /\b(?:FDT|FAT|OLT|ODF|SLACK)\b/i.test(folder)) return undefined
  }
  return undefined
}

export const DUPLICATE_ASSET_GEOMETRY_WARNING = 'DUPLICATE_ASSET_GEOMETRY_SKIPPED'
function explicitPoleHeight(metadata: Record<string, unknown>): 5 | 7 | undefined {
  for (const [key, value] of Object.entries(metadata)) {
    if (!['height', 'heightm', 'poleheight', 'tinggi', 'tinggitiang'].includes(key.toLowerCase().replace(/[^a-z]/g, ''))) continue
    const match = /^(5|7)(?:\s*m)?$/i.exec(metadataText(value))
    if (match) return Number(match[1]) as 5 | 7
  }
  return undefined
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
        for (const item of (Array.isArray(simple) ? simple : simple ? [simple] : []) as Record<string, unknown>[]) setMetadata(item, item['#text'] ?? '')
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
      const mapped = mappings[String(rowNumber)] ?? {}
      const sourceAddress = p.address ?? metadata.address ?? metadata.full_address ?? metadata.fulladdress ?? metadata.alamat ?? metadata.alamatlengkap ?? mapped.address
      const address = sourceAddress === undefined ? undefined : propertyValue(sourceAddress)
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
      if (geometryCount !== 1 && !(geometryCount === 0 && address)) {
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
      const code = metadata.code === undefined ? (p['@_id'] ?? featureName) : propertyValue(metadata.code)
      const inferredKind = explicitAssetKind(metadata)
      const namedKind = hasExplicitAssetType(metadata) ? undefined : nameAssetKind(featureName, entry.folderPath.join('/'), (geometry as { type?: string } | undefined)?.type ?? (address ? 'Point' : ''))
      const kind = inferredKind === null ? undefined : inferredKind ?? namedKind
      const heightM = explicitPoleHeight(metadata)
      const cableName = geometry && ['LineString', 'MultiLineString'].includes((geometry as { type?: string }).type ?? '') ? sourceCableName : undefined
      input.push({ rowNumber, reference: geometry ? { rowNumber, externalId: p['@_id'] ?? `placemark-${rowNumber}`, name: featureName.slice(0, 500), geometry, assetRowValid: false, properties } : undefined,
        row: clean({ kind, externalId: p['@_id'] ?? `placemark-${rowNumber}`, code: propertyValue(code).slice(0, 200), cableName, geometry, address, ...(heightM !== undefined ? { heightM } : {}), ...mapped, rowNumber }) })
    }
  }
  const rows: AssetRow[] = []
  const errors: ImportError[] = []
  const seen = new Set<string>()
  const seenAssetFeatures = new Map<string, number>()
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
        errors.push({ rowNumber: item.rowNumber, code: 'ADDRESS_NEEDS_GEOCODING', message: 'Alamat belum memiliki koordinat. Kandidat akan dicari otomatis; konfirmasi hasil sebelum publish.', sourceRow: draft.data })
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
    const featureIdentity = `${parsed.data.kind}:${parsed.data.code}:${JSON.stringify(parsed.data.geometry)}`
    const firstFeatureRow = seenAssetFeatures.get(featureIdentity)
    if (firstFeatureRow !== undefined) {
      const reference = item.reference as Record<string, unknown>
      const properties = reference.properties as Record<string, string> | undefined
      addReferenceFeature({
        ...reference,
        assetRowValid: false,
        properties: { ...properties, duplicateFeatureOfRow: String(firstFeatureRow) },
      })
      errors.push({
        rowNumber: item.rowNumber,
        code: DUPLICATE_ASSET_GEOMETRY_WARNING,
        message: `Kode ${parsed.data.kind} "${parsed.data.code}" dan koordinat sama dengan baris ${firstFeatureRow}; baris ini tetap sebagai referensi KML.`,
      })
      continue
    }
    seenAssetFeatures.set(featureIdentity, parsed.data.rowNumber)
    addReferenceFeature({ ...item.reference as Record<string, unknown>, assetRowValid: true })
    rows.push(parsed.data)
  }
  return { rows, areas, referenceFeatures, errors }
}
