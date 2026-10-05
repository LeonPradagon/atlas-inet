import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { entities } from './access.schema.js'
import { user } from './auth.schema.js'
import { networkSegments } from './network.schema.js'
import { policyChangeRequests } from './policy-change.schema.js'

export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id),
  key: text('key').notNull(), version: integer('version').notNull(), value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: text('updated_by').notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  changeRequestId: uuid('change_request_id').unique().references(() => policyChangeRequests.id),
}, (t) => [unique('settings_entity_key_version').on(t.entityId, t.key, t.version), check('settings_version_positive', sql`${t.version} > 0`)])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id),
  actorId: text('actor_id').notNull(), action: text('action').notNull(), resourceId: text('resource_id').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('audit_entity_time_idx').on(t.entityId, t.createdAt)])

function customerColumns() {
  return {
    customerName: text('customer_name').notNull(), customerReference: text('customer_reference'),
    customerPicName: text('customer_pic_name').notNull(), customerPicContact: text('customer_pic_contact').notNull(),
    presalesUserId: text('presales_user_id').notNull(), coreCount: integer('core_count').notNull(), reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
}

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull(), segmentId: uuid('segment_id').notNull(),
  ...customerColumns(), status: text('status').notNull().default('BOOKED'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), policyVersion: integer('policy_version').notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }), closedReason: text('closed_reason'),
}, (t) => [
  unique('bookings_id_entity_unique').on(t.id, t.entityId),
  foreignKey({ columns: [t.segmentId, t.entityId], foreignColumns: [networkSegments.id, networkSegments.ownerEntityId] }),
  check('bookings_core_positive', sql`${t.coreCount} > 0`),
  check('bookings_status_valid', sql`${t.status} IN ('BOOKED','USED','RELEASED','EXPIRED')`),
  check('bookings_expiry_valid', sql`${t.expiresAt} > ${t.createdAt}`),
  index('bookings_segment_status_expiry_idx').on(t.segmentId, t.status, t.expiresAt),
])

export const allocations = pgTable('core_allocations', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull(), segmentId: uuid('segment_id').notNull(),
  sourceBookingId: uuid('source_booking_id').notNull().unique(), coreCount: integer('core_count').notNull(),
  operationalReference: text('operational_reference').notNull(), activatedBy: text('activated_by').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
  deallocatedAt: timestamp('deallocated_at', { withTimezone: true }), deallocatedBy: text('deallocated_by'), deallocationReason: text('deallocation_reason'),
}, (t) => [
  foreignKey({ columns: [t.segmentId, t.entityId], foreignColumns: [networkSegments.id, networkSegments.ownerEntityId] }),
  foreignKey({ columns: [t.sourceBookingId, t.entityId], foreignColumns: [bookings.id, bookings.entityId] }),
  check('allocations_core_positive', sql`${t.coreCount} > 0`), index('allocations_segment_active_idx').on(t.segmentId, t.deallocatedAt),
])

export const waitingList = pgTable('waiting_list_entries', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull(), segmentId: uuid('segment_id').notNull(),
  ...customerColumns(), status: text('status').notNull().default('WAITING'), bookingId: uuid('booking_id').unique(),
  closedAt: timestamp('closed_at', { withTimezone: true }), closedReason: text('closed_reason'),
}, (t) => [
  foreignKey({ columns: [t.segmentId, t.entityId], foreignColumns: [networkSegments.id, networkSegments.ownerEntityId] }),
  foreignKey({ columns: [t.bookingId, t.entityId], foreignColumns: [bookings.id, bookings.entityId] }),
  check('waiting_core_positive', sql`${t.coreCount} > 0`),
  check('waiting_status_valid', sql`${t.status} IN ('WAITING','ALLOCATED','CANCELLED')`),
  check('waiting_booking_valid', sql`(${t.status} = 'ALLOCATED') = (${t.bookingId} IS NOT NULL)`),
  index('waiting_segment_order_idx').on(t.segmentId, t.status, t.createdAt, t.id),
])

export const idempotencyRecords = pgTable('idempotency_records', {
  id: uuid('id').primaryKey().defaultRandom(), userId: text('user_id').notNull(), action: text('action').notNull(),
  key: text('key').notNull(), payloadHash: text('payload_hash').notNull(), response: jsonb('response').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('idempotency_scope_unique').on(t.userId, t.action, t.key)])

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id),
  type: text('type').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), deliveredAt: timestamp('delivered_at', { withTimezone: true }),
}, (t) => [index('outbox_pending_idx').on(t.deliveredAt, t.createdAt)])

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(), eventId: uuid('event_id').notNull().references(() => outboxEvents.id),
  entityId: uuid('entity_id').notNull().references(() => entities.id), recipientId: text('recipient_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [unique('notification_event_recipient_unique').on(t.eventId, t.recipientId), index('notification_recipient_time_idx').on(t.recipientId, t.createdAt)])

export const analysisResults = pgTable('analysis_results', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id), userId: text('user_id').notNull(),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(), result: jsonb('result').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('analysis_owner_time_idx').on(t.userId, t.createdAt)])

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id), ownerId: text('owner_id').notNull(),
  type: text('type').notNull(), status: text('status').notNull().default('QUEUED'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(), output: jsonb('output').$type<Record<string, unknown>>(),
  total: integer('total').notNull().default(0), completed: integer('completed').notNull().default(0), succeeded: integer('succeeded').notNull().default(0), failed: integer('failed').notNull().default(0),
  attempts: integer('attempts').notNull().default(0), leaseToken: uuid('lease_token'), leaseUntil: timestamp('lease_until', { withTimezone: true }), error: text('error'),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  check('jobs_status_valid', sql`${t.status} IN ('QUEUED','RUNNING','COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')`),
  check('jobs_progress_valid', sql`${t.total} >= 0 AND ${t.completed} >= 0 AND ${t.completed} <= ${t.total} AND ${t.succeeded} >= 0 AND ${t.failed} >= 0 AND ${t.completed} = ${t.succeeded} + ${t.failed}`),
  index('jobs_claim_idx').on(t.status, t.leaseUntil), index('jobs_owner_idx').on(t.ownerId, t.createdAt),
])

export const jobRows = pgTable('job_rows', {
  id: uuid('id').primaryKey().defaultRandom(), jobId: uuid('job_id').notNull().references(() => jobs.id), rowNumber: integer('row_number').notNull(),
  referenceId: text('reference_id').notNull(), input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  result: jsonb('result').$type<Record<string, unknown>>(), error: text('error'),
}, (t) => [unique('job_row_unique').on(t.jobId, t.rowNumber)])

export const importPreviews = pgTable('import_previews', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id), ownerId: text('owner_id').notNull(),
  sourceName: text('source_name').notNull(), sourceSystem: text('source_system').notNull(),
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(), areas: jsonb('areas').$type<Record<string, unknown>[]>().notNull().default([]), referenceFeatures: jsonb('reference_features').$type<Record<string, unknown>[]>().notNull().default([]), errors: jsonb('errors').$type<Record<string, unknown>[]>().notNull(),
  status: text('status').notNull().default('PREVIEW'), datasetId: uuid('dataset_id'), areasPublishedAt: timestamp('areas_published_at', { withTimezone: true }),
  baseFingerprint: text('base_fingerprint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), publishedAt: timestamp('published_at', { withTimezone: true }),
}, (t) => [index('import_owner_time_idx').on(t.ownerId, t.createdAt)])

export const cableNameHistory = pgTable('cable_name_history', {
  id: uuid('id').primaryKey().defaultRandom(), segmentId: uuid('segment_id').notNull().references(() => networkSegments.id),
  oldName: text('old_name').notNull(), newName: text('new_name').notNull(), policyVersion: integer('policy_version').notNull(),
  actorId: text('actor_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const analysisUploads = pgTable('analysis_uploads', {
  id: uuid('id').primaryKey().defaultRandom(), entityId: uuid('entity_id').notNull().references(() => entities.id), ownerId: text('owner_id').notNull(),
  rows: jsonb('rows').$type<Record<string, unknown>[]>().notNull(), sourceName: text('source_name').notNull(),
  jobId: uuid('job_id').references(() => jobs.id), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('analysis_upload_owner_idx').on(t.ownerId, t.createdAt)])
