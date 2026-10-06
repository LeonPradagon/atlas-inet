import { ConflictException } from '@nestjs/common'
import { z } from 'zod'
import { RE2JS } from 're2js'
import { parseInput } from '../../common/domain-input.js'

export const bookingPolicySchema = z.object({ duration: z.number().int().min(1).max(1200), unit: z.enum(['DAY', 'MONTH']) }).strict()
export const namingPolicySchema = z.object({ approved: z.boolean(), pattern: z.string().min(1).max(200).nullable(), uniquePerEntity: z.literal(true) }).strict()
  .refine((data) => !data.approved || data.pattern !== null, 'Enabled naming policy needs a pattern')
export const analysisPolicySchema = z.object({ radiusM: z.number().int().min(1).max(100_000), formulaApproved: z.boolean(), slackPercent: z.number().finite().min(0).max(100).nullable(), extraLengthM: z.number().finite().min(0).max(10_000).nullable(), maxDetourPercent: z.number().finite().min(0).max(1000).nullable() }).strict()
  .refine((data) => !data.formulaApproved || (data.slackPercent !== null && data.extraLengthM !== null && data.maxDetourPercent !== null), 'Enabled estimation needs slack, extra length and detour parameters')
export const settingKeySchema = z.enum(['booking-policy', 'naming-policy', 'analysis-policy'])
export type SettingKey = z.infer<typeof settingKeySchema>
export type BookingPolicy = z.infer<typeof bookingPolicySchema>
export const DEFAULT_NAMING_POLICY_PATTERN = '[A-Za-z0-9_\\s.,/-]+'
export const approvalPermission = (key: SettingKey) => key === 'analysis-policy' ? 'settings.approve-engineering' : 'settings.approve-operational'
export const defaultPolicy = (key: SettingKey) => key === 'booking-policy' ? { duration: 1, unit: 'MONTH' } : key === 'naming-policy' ? { approved: false, pattern: DEFAULT_NAMING_POLICY_PATTERN, uniquePerEntity: true } : { radiusM: 5000, formulaApproved: false, slackPercent: null, extraLengthM: null, maxDetourPercent: null }

export function parsePolicy(key: SettingKey, input: unknown): Record<string, unknown> {
  const value = key === 'booking-policy' ? parseInput(bookingPolicySchema, input) : key === 'naming-policy' ? parseInput(namingPolicySchema, input) : parseInput(analysisPolicySchema, input)
  if ('pattern' in value && value.pattern) {
    try { RE2JS.compile(value.pattern) } catch { throw new ConflictException('Naming pattern must be a valid RE2-compatible regex') }
  }
  return value
}
