export type KmlCandidateKind = 'cable' | 'POP' | 'ODC' | 'ODP' | 'FDT' | 'FAT' | 'OLT' | 'ODF' | 'pole' | 'slack'

export interface KmlCandidateClassification {
  kind: KmlCandidateKind
  label: string
  evidence: 'atribut KML' | 'nama/folder KML'
}

const candidateLabels: Record<KmlCandidateKind, string> = {
  cable: 'Jalur kabel',
  POP: 'POP',
  ODC: 'ODC',
  ODP: 'ODP',
  FDT: 'FDT',
  FAT: 'FAT',
  OLT: 'OLT',
  ODF: 'ODF',
  pole: 'Tiang',
  slack: 'Titik slack kabel',
}

const explicitTypeFields = new Set([
  'type', 'kind', 'assetkind', 'assettype', 'networkkind', 'networktype', 'networkassettype', 'featuretype',
  'assetcategory', 'jenis', 'jenisaset', 'tipe', 'tipeaset', 'kategori', 'classification',
])

function kindFromText(value: string, geometryType: string): KmlCandidateKind | null {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    const pointKinds: Array<[KmlCandidateKind, RegExp]> = [
      ['ODC', /\b(?:ODC|OPTICAL DISTRIBUTION CABINET)\b/i],
      ['ODP', /\b(?:ODP|OPTICAL DISTRIBUTION POINT)\b/i],
      ['pole', /\b(?:POLE|TIANG)\b/i],
      ['FDT', /\bFDT\b/i],
      ['FAT', /\bFAT\b/i],
      ['OLT', /\bOLT\b/i],
      ['ODF', /\bODF\b/i],
      ['slack', /\bSLACK\b/i],
      ['POP', /\b(?:POP|POINT OF PRESENCE)\b/i],
    ]
    return pointKinds.find(([, pattern]) => pattern.test(value))?.[0] ?? null
  }

  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    return /\b(?:KABEL|CABLE|FIBER|FIBRE|BACKBONE|FEEDER|DISTRIBUTION)\b|\bBB[-_ ]?\d+\b|\bFDR[-_ ]?[A-Z0-9]+\b/i.test(value)
      ? 'cable'
      : null
  }

  return null
}

export function classifyKmlCandidate(input: {
  name: string
  geometryType: string
  folderPath?: string
  attributes?: Record<string, unknown>
}): KmlCandidateClassification | null {
  const explicitKinds = new Set<KmlCandidateKind>()
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    if (!explicitTypeFields.has(key.toLowerCase().replace(/[^a-z]/g, '')) || typeof value !== 'string') continue
    const kind = kindFromText(value, input.geometryType)
    if (kind) explicitKinds.add(kind)
  }
  if (explicitKinds.size > 1) return null
  const explicitKind = explicitKinds.values().next().value
  if (explicitKind) return { kind: explicitKind, label: candidateLabels[explicitKind], evidence: 'atribut KML' }

  const nameKind = kindFromText(input.name, input.geometryType)
  const folders = (input.folderPath ?? '').split('/').map((folder) => folder.trim()).filter(Boolean).reverse()
  let folderKind: KmlCandidateKind | null = null
  for (const [index, folder] of folders.entries()) {
    const candidate = kindFromText(folder, input.geometryType)
    if (!candidate) continue
    if (candidate === 'POP' && index !== 0) break
    folderKind = candidate
    break
  }
  const kind = nameKind ?? folderKind
  return kind ? { kind, label: candidateLabels[kind], evidence: 'nama/folder KML' } : null
}
