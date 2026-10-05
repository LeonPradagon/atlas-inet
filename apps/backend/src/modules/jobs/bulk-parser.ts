import { BadRequestException } from '@nestjs/common'
import { analysisSchema } from '../analysis/analysis.dto.js'
import { readKmlDocument, type UploadFile } from '../files/tabular-files.js'

function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function placemarkData(placemark: Record<string, unknown>) {
  const output: Record<string, string> = {}
  const extended = placemark.ExtendedData as Record<string, unknown> | undefined
  const data = extended?.Data
  for (const item of (Array.isArray(data) ? data : data ? [data] : []) as Record<string, unknown>[]) {
    const key = text(item['@_name'])
    if (key) output[key.toLowerCase()] = text(item.value)
  }
  const schemaData = extended?.SchemaData
  for (const schema of (Array.isArray(schemaData) ? schemaData : schemaData ? [schemaData] : []) as Record<string, unknown>[]) {
    const simple = schema.SimpleData
    for (const item of (Array.isArray(simple) ? simple : simple ? [simple] : []) as Record<string, unknown>[]) {
      const key = text(item['@_name'])
      if (key) output[key.toLowerCase()] = text(item['#text'] ?? item)
    }
  }
  return output
}

export async function parseBulkFile(file: UploadFile, entityId: string) {
  const document = await readKmlDocument(file)
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
  if (!placemarks.length || placemarks.length > 20_000) throw new BadRequestException('KML needs 1..20,000 Placemarks')

  const seen = new Set<string>()
  return placemarks.map((placemark, index) => {
    const rowNumber = index + 1
    const metadata = placemarkData(placemark)
    const point = placemark.Point as Record<string, unknown> | undefined
    const coordinatePairs = text(point?.coordinates).split(/\s+/).filter(Boolean)
    const address = metadata.address || text(placemark.address)
    let latitude: number | undefined
    let longitude: number | undefined
    let error: string | null = null
    if (placemark.LineString || placemark.Polygon || placemark.MultiGeometry) error = 'Analysis KML accepts Point placemarks or address-only placemarks; network lines/areas belong in asset import'
    else if (!point && !address) error = 'Analysis KML needs a Point or address in each Placemark'
    else if (point && coordinatePairs.length !== 1) error = 'Point placemark must contain exactly one coordinate pair'
    else if (point) {
      const parts = coordinatePairs[0].split(',')
      longitude = Number(parts[0]); latitude = Number(parts[1])
      if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part.trim()) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) error = 'Point coordinates must be valid WGS84 longitude,latitude'
    }

    const referenceId = metadata.reference_id || text(placemark.name) || text(placemark['@_id']) || String(rowNumber)
    if (referenceId.length > 200) error ??= 'Placemark reference exceeds 200 characters'
    if (seen.has(referenceId)) error ??= 'Duplicate Placemark reference'
    seen.add(referenceId)

    const values = {
      reference_id: referenceId,
      customer_name: metadata.customer_name || text(placemark.name),
      address,
      latitude,
      longitude,
      notes: metadata.notes,
      connection_point_id: metadata.connection_point_id || metadata.connectionpointid,
      connection_point_type: metadata.connection_point_type || metadata.connectionpointtype,
    }
    const analysis = analysisSchema.safeParse({
      entityId,
      address: values.address || undefined,
      latitude,
      longitude,
      connectionPointId: values.connection_point_id || undefined,
      connectionPointType: values.connection_point_type || undefined,
    })
    if (!error && !analysis.success) error = analysis.error.issues.map((issue) => issue.message).join('; ')
    return { rowNumber, referenceId, input: { ...values, ...(analysis.success ? { analysis: analysis.data } : {}) }, error }
  })
}
