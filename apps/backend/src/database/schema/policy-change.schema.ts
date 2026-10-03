import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { entities } from './access.schema.js'

// Actor IDs are retained as audit identities even if an account is later deleted.
export const policyChangeRequests = pgTable('policy_change_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entities.id),
  key: text('key').notNull(), baseVersion: integer('base_version').notNull(),
  proposedValue: jsonb('proposed_value').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(), requestedBy: text('requested_by').notNull(),
  submissionKey: text('submission_key').notNull(),
  status: text('status').notNull().default('PENDING'),
  decidedBy: text('decided_by'), decisionReason: text('decision_reason'),
  approvedVersion: integer('approved_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => [
  unique('policy_change_submission_unique').on(t.entityId, t.requestedBy, t.submissionKey),
  index('policy_change_entity_status_time_idx').on(t.entityId, t.status, t.createdAt),
  check('policy_change_key_valid', sql`${t.key} IN ('booking-policy','naming-policy','analysis-policy')`),
  check('policy_change_base_version_valid', sql`${t.baseVersion} >= 0`),
  check('policy_change_status_valid', sql`${t.status} IN ('PENDING','APPROVED','REJECTED','CANCELLED')`),
  check('policy_change_reason_not_blank', sql`length(trim(${t.reason})) > 0`),
  check('policy_change_decision_valid', sql`
    (${t.status} = 'PENDING' AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.decisionReason} IS NULL AND ${t.approvedVersion} IS NULL)
    OR (${t.status} IN ('APPROVED','REJECTED','CANCELLED') AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL
      AND ${t.decisionReason} IS NOT NULL AND length(trim(${t.decisionReason})) > 0
      AND ((${t.status} = 'APPROVED' AND ${t.approvedVersion} IS NOT NULL AND ${t.approvedVersion} = ${t.baseVersion} + 1)
        OR (${t.status} <> 'APPROVED' AND ${t.approvedVersion} IS NULL)))`),
  check('policy_change_separation_of_duties', sql`
    ${t.status} = 'PENDING' OR (${t.status} = 'CANCELLED' AND ${t.decidedBy} = ${t.requestedBy})
    OR (${t.status} IN ('APPROVED','REJECTED') AND ${t.decidedBy} <> ${t.requestedBy})`),
])
