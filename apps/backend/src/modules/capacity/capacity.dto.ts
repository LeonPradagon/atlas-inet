import { z } from 'zod'
import { entityPageSchema } from '../../common/domain-input.js'
export const customerFields = {
  customerName: z.string().trim().min(1).max(200), customerReference: z.string().trim().max(200).nullish(),
  customerPicName: z.string().trim().min(1).max(200), customerPicContact: z.string().trim().min(3).max(200),
  presalesUserId: z.string().min(1).max(200), coreCount: z.number().int().min(1).max(1_000_000), reason: z.string().trim().min(1).max(1000),
}
export const createBookingSchema = z.object({ segmentId: z.uuid(), ...customerFields }).strict()
export const activateSchema = z.object({ operationalReference: z.string().trim().min(1).max(200) }).strict()
export const existingUsageSchema = z.object({
  installedCoreCount: z.number().int().min(1).max(1_000_000),
  existingCoreCount: z.number().int().min(0).max(1_000_000),
  operationalReference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000), verified: z.literal(true),
}).strict()
export type ExistingUsageInput = z.infer<typeof existingUsageSchema>
export type CreateBooking = z.infer<typeof createBookingSchema>
export const bookingListSchema = entityPageSchema.extend({ segmentId:z.uuid().optional(),status:z.enum(['BOOKED','USED','RELEASED','EXPIRED']).optional() })
export const waitingListSchema = entityPageSchema.extend({ segmentId:z.uuid().optional(),status:z.enum(['WAITING','ALLOCATED','CANCELLED']).optional() })
