import { classifyKmlCandidate } from './kml-classification'

export const networkMapMarkerStyles = {
  'pole-5m': { label: 'Tiang · 5 m', color: '#eab308', glyph: '5' },
  'pole-7m': { label: 'Tiang · 7 m', color: '#c2410c', glyph: '7' },
  'pole-unknown': { label: 'Tiang · tinggi tidak tercatat', color: '#9a3412', glyph: 'T' },
  odc: { label: 'ODC', color: '#7c3aed', glyph: 'C' },
  odp: { label: 'ODP', color: '#16a34a', glyph: 'D' },
  pop: { label: 'POP', color: '#dc2626', glyph: 'P' },
  fdt: { label: 'FDT', color: '#0891b2', glyph: 'F' },
  fat: { label: 'FAT', color: '#ca8a04', glyph: 'A' },
  olt: { label: 'OLT', color: '#2563eb', glyph: 'L' },
  odf: { label: 'ODF', color: '#4f46e5', glyph: 'O' },
  slack: { label: 'Slack kabel', color: '#db2777', glyph: 'S' },
  reference: { label: 'Referensi KML lain', color: '#64748b', glyph: '?' },
  analysis: { label: 'Lokasi analisis', color: '#be123c', glyph: 'A' },
} as const

export type NetworkMapMarkerKind = keyof typeof networkMapMarkerStyles

type MarkerProperties = Record<string, unknown>

function explicitPoleHeight(properties: MarkerProperties, attributes: MarkerProperties): 5 | 7 | undefined {
  const direct = Number(properties.heightM)
  if (direct === 5 || direct === 7) return direct
  for (const [key, value] of Object.entries(attributes)) {
    if (!['height', 'heightm', 'poleheight', 'tinggi', 'tinggitiang'].includes(key.toLowerCase().replace(/[^a-z]/g, ''))) continue
    const match = /^(5|7)(?:\s*m)?$/i.exec(String(value).trim())
    if (match) return Number(match[1]) as 5 | 7
  }
  return undefined
}

export function networkMapMarkerImage(properties: MarkerProperties, geometryType: string) {
  const layer = typeof properties.layer === 'string' ? properties.layer : ''
  if (layer === 'poles') {
    const height = explicitPoleHeight(properties, {})
    return height ? `atlas-pole-${height}m` : 'atlas-pole-unknown'
  }
  if (layer === 'odc' || layer === 'odp' || layer === 'pops') return `atlas-pin-${layer === 'pops' ? 'pop' : layer}`
  if (layer === 'analysis') return 'atlas-pin-analysis'
  if (layer !== 'references') return 'atlas-pin-reference'

  const attributes = properties.attributes && typeof properties.attributes === 'object'
    ? properties.attributes as MarkerProperties
    : {}
  const folderPath = properties.kmlFolderPath ?? attributes.kmlFolderPath
  const candidate = classifyKmlCandidate({
    name: String(properties.name ?? ''),
    geometryType,
    folderPath: typeof folderPath === 'string' ? folderPath : undefined,
    attributes,
  })
  if (!candidate) return 'atlas-pin-reference'

  let kind: NetworkMapMarkerKind
  switch (candidate.kind) {
    case 'pole': {
      const height = explicitPoleHeight(properties, attributes)
      kind = height ? `pole-${height}m` : 'pole-unknown'
      break
    }
    case 'ODC': kind = 'odc'; break
    case 'ODP': kind = 'odp'; break
    case 'POP': kind = 'pop'; break
    case 'FDT': kind = 'fdt'; break
    case 'FAT': kind = 'fat'; break
    case 'OLT': kind = 'olt'; break
    case 'ODF': kind = 'odf'; break
    case 'slack': kind = 'slack'; break
    default: return 'atlas-pin-reference'
  }
  return kind.startsWith('pole-') ? `atlas-pole-${kind.slice(5)}-candidate` : `atlas-pin-${kind}-candidate`
}

export const networkMapMarkerLegend = [
  { kind: 'segments', label: 'Segmen kabel', color: '#0d6efd', glyph: '—', candidate: false },
  { kind: 'areas', label: 'Area referensi', color: '#ffd400', glyph: 'A', candidate: false },
  { kind: 'pole-5m', label: networkMapMarkerStyles['pole-5m'].label, color: networkMapMarkerStyles['pole-5m'].color, glyph: networkMapMarkerStyles['pole-5m'].glyph },
  { kind: 'pole-7m', label: networkMapMarkerStyles['pole-7m'].label, color: networkMapMarkerStyles['pole-7m'].color, glyph: networkMapMarkerStyles['pole-7m'].glyph },
  { kind: 'pole-candidate', label: 'Kandidat tiang dari KML', color: networkMapMarkerStyles['pole-unknown'].color, glyph: networkMapMarkerStyles['pole-unknown'].glyph, candidate: true },
  { kind: 'odc', label: 'ODC operasional', color: networkMapMarkerStyles.odc.color, glyph: networkMapMarkerStyles.odc.glyph },
  { kind: 'odc-candidate', label: 'Kandidat ODC dari KML', color: networkMapMarkerStyles.odc.color, glyph: networkMapMarkerStyles.odc.glyph, candidate: true },
  { kind: 'odp', label: 'ODP operasional', color: networkMapMarkerStyles.odp.color, glyph: networkMapMarkerStyles.odp.glyph },
  { kind: 'odp-candidate', label: 'Kandidat ODP dari KML', color: networkMapMarkerStyles.odp.color, glyph: networkMapMarkerStyles.odp.glyph, candidate: true },
  { kind: 'pop', label: 'POP operasional', color: networkMapMarkerStyles.pop.color, glyph: networkMapMarkerStyles.pop.glyph },
  { kind: 'pop-candidate', label: 'Kandidat POP dari KML', color: networkMapMarkerStyles.pop.color, glyph: networkMapMarkerStyles.pop.glyph, candidate: true },
  { kind: 'fdt-candidate', label: 'Kandidat FDT dari KML', color: networkMapMarkerStyles.fdt.color, glyph: networkMapMarkerStyles.fdt.glyph, candidate: true },
  { kind: 'fat-candidate', label: 'Kandidat FAT dari KML', color: networkMapMarkerStyles.fat.color, glyph: networkMapMarkerStyles.fat.glyph, candidate: true },
  { kind: 'olt-candidate', label: 'Kandidat OLT dari KML', color: networkMapMarkerStyles.olt.color, glyph: networkMapMarkerStyles.olt.glyph, candidate: true },
  { kind: 'odf-candidate', label: 'Kandidat ODF dari KML', color: networkMapMarkerStyles.odf.color, glyph: networkMapMarkerStyles.odf.glyph, candidate: true },
  { kind: 'slack-candidate', label: 'Kandidat slack dari KML', color: networkMapMarkerStyles.slack.color, glyph: networkMapMarkerStyles.slack.glyph, candidate: true },
  { kind: 'reference', label: 'Referensi KML lain', color: networkMapMarkerStyles.reference.color, glyph: networkMapMarkerStyles.reference.glyph },
] as const satisfies ReadonlyArray<{ kind: string; label: string; color: string; glyph: string; candidate?: boolean }>
