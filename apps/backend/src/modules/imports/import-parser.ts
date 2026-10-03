import { BadRequestException } from '@nestjs/common'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { z } from 'zod'
import { readWorkbook, type UploadFile } from '../files/tabular-files.js'

const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)])
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2).max(10_000) }).strict(),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2).max(10_000)).min(1).max(100) }).strict(),
])
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
export const importColumns = ['kind','external_id','code','cable_name','geometry','cable_type_code','installed_core_count','capacity_validated','installation_method','road_side','start_node_code','end_node_code','height_m','segment_codes','address','latitude','longitude']

function clean(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== ''))
}
export async function parseAssetFile(file: UploadFile, mappings: Record<string, Record<string, unknown>> = {}) {
  const input: { rowNumber: number; row: unknown; error?: string }[] = []
  if (/\.xlsx$/i.test(file.originalname)) {
    const parsed = await readWorkbook(file, 'Assets')
    if (parsed.headers.some((header) => !importColumns.includes(header))) throw new BadRequestException('Unknown asset import column')
    for (const item of parsed.rows) {
      const v = item.values
      let geometry: unknown
      if (v.geometry !== undefined && v.geometry !== null && v.geometry !== '') {
        try { geometry = JSON.parse(String(v.geometry)) } catch { input.push({ rowNumber: item.rowNumber, row: {}, error: 'Invalid geometry JSON' }); continue }
      } else if ([v.latitude, v.longitude].some((value) => value !== undefined && value !== null && value !== '')) {
        const paired = position.safeParse([v.longitude, v.latitude])
        if (!paired.success) { input.push({ rowNumber: item.rowNumber, row: {}, error: 'Latitude and longitude must be paired numeric WGS84 coordinates' }); continue }
        geometry = { type: 'Point', coordinates: paired.data }
      }
      input.push({ rowNumber: item.rowNumber, error: item.error, row: clean({ rowNumber: item.rowNumber, kind: v.kind, externalId: v.external_id, code: v.code, cableName: v.cable_name, geometry, address: v.address, cableTypeCode: v.cable_type_code, installedCoreCount: v.installed_core_count, capacityValidated: v.capacity_validated, installationMethod: v.installation_method, roadSide: v.road_side, startNodeCode: v.start_node_code, endNodeCode: v.end_node_code, heightM: v.height_m, segmentCodes: typeof v.segment_codes === 'string' && v.segment_codes.trim() ? v.segment_codes.split(',').map((value) => value.trim()) : undefined }) })
    }
  } else {
    if (!['application/vnd.google-earth.kml+xml','application/xml','text/xml','application/octet-stream'].includes(file.mimetype)) throw new BadRequestException('Invalid KML content type')
    let text: string
    try { text = new TextDecoder('utf8', { fatal: true }).decode(file.buffer) } catch { throw new BadRequestException('KML must be UTF-8') }
    if (/<!\s*(DOCTYPE|ENTITY)\b|\u0000/i.test(text) || XMLValidator.validate(text) !== true) throw new BadRequestException('Unsafe or invalid KML XML')
    const document = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: false }).parse(text) as Record<string, unknown>
    const placemarks: Record<string, unknown>[] = []
    function walk(value: unknown, depth = 0) {
      if (depth > 64) throw new BadRequestException('KML nesting is too deep')
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach((entry) => walk(entry, depth + 1)); return }
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'Placemark') placemarks.push(...(Array.isArray(entry) ? entry : [entry]) as Record<string, unknown>[])
        else walk(entry, depth + 1)
      }
    }
    walk(document)
    if (!placemarks.length || placemarks.length > 10_000) throw new BadRequestException('KML needs 1..10,000 Placemarks')
    for (const [index, p] of placemarks.entries()) {
      const rowNumber = index + 1
      const metadata: Record<string, unknown> = {}
      const extended = (p.ExtendedData as Record<string, unknown> | undefined)?.Data
      for (const item of (Array.isArray(extended) ? extended : extended ? [extended] : []) as Record<string, unknown>[]) metadata[String(item['@_name'])] = item.value
      const coords = (value: unknown) => String(value).trim().split(/\s+/).map((pair) => {
        const parts = pair.split(',')
        if (parts.length < 2 || parts.length > 3 || parts.some((v) => !v.trim() || !Number.isFinite(Number(v)))) return [NaN,NaN]
        return parts.slice(0,2).map(Number)
      })
      let geometry: unknown
      const geometryCount = ['LineString','Point','MultiGeometry','Polygon'].filter((key) => p[key] !== undefined).length
      if (p.Polygon !== undefined) { input.push({ rowNumber, row: {}, error: 'Polygon is not a supported asset geometry' }); continue }
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
      input.push({ rowNumber, row: clean({ kind: metadata.kind ?? (geometry && (geometry as { type: string }).type !== 'Point' ? 'SEGMENT' : undefined), externalId: p['@_id'], code, cableName: p.name, geometry, address: p.address, ...(mappings[String(rowNumber)] ?? {}), rowNumber }) })
    }
  }
  const rows: AssetRow[] = []
  const errors: ImportError[] = []
  const seen = new Set<string>()
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
    if (item.error || !parsed.success) { errors.push({ rowNumber: item.rowNumber, message: item.error ?? parsed.error?.issues.map((issue) => issue.message).join('; ') ?? 'Invalid asset row' }); continue }
    const identity = `${parsed.data.kind}:${parsed.data.externalId}`
    if (seen.has(identity)) { errors.push({ rowNumber: item.rowNumber, message: 'Duplicate source identity' }); continue }
    seen.add(identity)
    rows.push(parsed.data)
  }
  return { rows, errors }
}
