import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { analysisSchema } from '../analysis/analysis.dto.js'
import { readWorkbook, type UploadFile } from '../files/tabular-files.js'
export const bulkColumns = ['reference_id','customer_name','address','latitude','longitude','notes','connection_point_id']
const metadata = z.object({ reference_id: z.string().max(200).optional(), customer_name: z.string().max(200).optional(), notes: z.string().max(1000).optional() })
export async function parseBulkFile(file: UploadFile, entityId: string) {
  const parsed = await readWorkbook(file, 'Input')
  if (parsed.headers.some((h) => !bulkColumns.includes(h))) throw new BadRequestException('Unknown analysis input column')
  const seen = new Set<string>()
  return parsed.rows.map((row) => {
    const values = Object.fromEntries(Object.entries(row.values).filter(([, value]) => value !== null && value !== ''))
    const referenceId = typeof values.reference_id === 'string' && values.reference_id ? values.reference_id : String(row.rowNumber)
    const input = analysisSchema.safeParse({ entityId, address: values.address, latitude: values.latitude, longitude: values.longitude, connectionPointId: values.connection_point_id })
    const meta = metadata.safeParse(values)
    const duplicate = seen.has(referenceId)
    seen.add(referenceId)
    const error = row.error ?? (duplicate ? 'Duplicate reference_id' : !meta.success ? 'Invalid metadata type or length' : !input.success ? input.error.issues.map((issue) => issue.message).join('; ') : null)
    return { rowNumber: row.rowNumber, referenceId, input: { ...values, ...(input.success ? { analysis: input.data } : {}) }, error }
  })
}
