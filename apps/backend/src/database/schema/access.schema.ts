import { sql } from 'drizzle-orm'
import { boolean, check, foreignKey, index, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth.schema.js'

export const entities = pgTable('entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('entities_code_format', sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'`),
  check('entities_name_not_blank', sql`length(trim(${table.name})) > 0`),
])

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
}, (table) => [check('permissions_code_format', sql`${table.code} ~ '^[a-z][a-z0-9_-]*[.][a-z][a-z0-9_-]*$'`)])

// Roles belong to an entity; identical role names do not imply cross-entity access.
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entities.id),
  code: text('code').notNull(),
  active: boolean('active').notNull().default(true),
}, (table) => [
  unique('roles_entity_code_unique').on(table.entityId, table.code),
  unique('roles_id_entity_unique').on(table.id, table.entityId),
  check('roles_code_format', sql`${table.code} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
])

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id),
  permissionCode: text('permission_code').notNull().references(() => permissions.code),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })])

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').notNull().references(() => entities.id),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('memberships_user_entity_unique').on(table.userId, table.entityId),
  unique('memberships_id_entity_unique').on(table.id, table.entityId),
])

export const membershipRoles = pgTable('membership_roles', {
  membershipId: uuid('membership_id').notNull(),
  roleId: uuid('role_id').notNull(),
  entityId: uuid('entity_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.membershipId, table.roleId] }),
  foreignKey({ columns: [table.membershipId, table.entityId], foreignColumns: [memberships.id, memberships.entityId] }).onDelete('cascade'),
  foreignKey({ columns: [table.roleId, table.entityId], foreignColumns: [roles.id, roles.entityId] }),
])

export const accessAudit = pgTable('access_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityId: uuid('entity_id').notNull().references(() => entities.id),
  subjectUserId: text('subject_user_id').notNull(),
  action: text('action').notNull(),
  source: text('source').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('access_audit_entity_created_idx').on(table.entityId, table.createdAt)])
