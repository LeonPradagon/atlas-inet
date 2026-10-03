import { BadRequestException, ConflictException } from '@nestjs/common'
import { z } from 'zod'

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new BadRequestException(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  return result.data
}
export const entityPageSchema = z.object({ entityId: z.uuid(), page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).strict()
export const reasonSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict()
export function requireVersion(header: string | undefined): number {
  if (!header || !/^(?:\d+|"\d+")$/.test(header)) throw new BadRequestException('If-Match version is required')
  const version = Number(header.replaceAll('"', ''))
  if (!Number.isSafeInteger(version) || version < 0) throw new ConflictException('Invalid version')
  return version
}
