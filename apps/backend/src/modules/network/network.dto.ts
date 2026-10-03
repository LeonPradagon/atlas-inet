import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'

const bboxSchema = z.string().transform((value) => value.split(',').map((item) => item.trim() === '' ? NaN : Number(item)))
  .pipe(z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]))
  .refine(([west, south, east, north]) => west < east && south < north, 'Expected west,south,east,north; wrapped bounds are not supported')

const viewportFields = {
  entityId: z.uuid(),
  bbox: bboxSchema,
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}

export const segmentsQuerySchema = z.object({
  ...viewportFields,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict()

export const mapQuerySchema = z.object({
  ...viewportFields,
  layers: z.string().default('segments,poles,odc,odp').transform((value) => [...new Set(value.split(',').map((item) => item.trim()))])
    .pipe(z.array(z.enum(['segments', 'poles', 'odc', 'odp'])).min(1).max(4)),
}).strict()

export type SegmentsQuery = z.output<typeof segmentsQuerySchema>
export type MapQuery = z.output<typeof mapQuerySchema>
export type BBox = SegmentsQuery['bbox']

export function parseNetworkInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
