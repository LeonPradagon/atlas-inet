import { z } from 'zod'
export const coordinateFields = { latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional(), address: z.string().trim().min(1).max(1000).optional() }
export const analysisSchema = z.object({ entityId: z.uuid(), ...coordinateFields, connectionPointId: z.uuid().optional() }).strict()
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), 'Latitude and longitude must be paired')
  .refine((value) => value.latitude !== undefined || value.address !== undefined, 'Address or paired coordinates are required')
export type AnalysisInput = z.infer<typeof analysisSchema>
