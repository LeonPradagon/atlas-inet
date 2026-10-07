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
  'kind', 'assetkind', 'assettype', 'networkkind', 'networktype', 'featuretype',
  'jenis', 'jenisaset', 'tipe', 'tipeaset', 'kategori', 'classification',
])

function kindFromText(value: string, geometryType: string): KmlCandidateKind | null {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    const pointKinds: Array<[KmlCandidateKind, RegExp]> = [
      ['POP', /\b(?:POP|POINT OF PRESENCE)\b/i],
      ['ODC', /\bODC\b/i],
      ['ODP', /\bODP\b/i],
      ['FDT', /\bFDT\b/i],
      ['FAT', /\bFAT\b/i],
      ['OLT', /\bOLT\b/i],
      ['ODF', /\bODF\b/i],
      ['pole', /\b(?:POLE|TIANG)\b/i],
      ['slack', /\bSLACK\b/i],
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
  for (const [key, value] of Object.entries(input.attributes ?? {})) {
    if (!explicitTypeFields.has(key.toLowerCase().replace(/[^a-z]/g, '')) || typeof value !== 'string') continue
    const kind = kindFromText(value, input.geometryType)
    if (kind) return { kind, label: candidateLabels[kind], evidence: 'atribut KML' }
  }

  const kind = kindFromText(`${input.name} ${input.folderPath ?? ''}`, input.geometryType)
  return kind ? { kind, label: candidateLabels[kind], evidence: 'nama/folder KML' } : null
}
