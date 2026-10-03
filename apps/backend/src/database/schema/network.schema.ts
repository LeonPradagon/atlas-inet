import { sql } from 'drizzle-orm'
import { boolean, check, customType, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { entities } from './access.schema.js'

const geometry = customType<{ data: string; driverData: string; config: { type: 'Point' | 'Geometry' } }>({
  dataType: (config) => `geometry(${config?.type ?? 'Geometry'},4326)`,
})

function geometryChecks(name: string, column: AnyPgColumn) {
  return [
    check(`${name}_geometry_valid`, sql`NOT ST_IsEmpty(${column}) AND ST_IsValid(${column}) AND ST_NDims(${column}) = 2`),
    check(`${name}_geometry_bounds`, sql`ST_XMin(Box3D(${column})) >= -180 AND ST_XMax(Box3D(${column})) <= 180 AND ST_YMin(Box3D(${column})) >= -90 AND ST_YMax(Box3D(${column})) <= 90`),
  ]
}

export const networkDatasets = pgTable('network_datasets', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerEntityId: uuid('owner_entity_id').notNull().references(() => entities.id),
  version: text('version').notNull(),
  sourceSystem: text('source_system').notNull(),
  status: text('status').notNull().default('DRAFT'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull(),
}, (table) => [
  unique('network_datasets_id_owner_unique').on(table.id, table.ownerEntityId),
  unique('network_datasets_owner_version_unique').on(table.ownerEntityId, table.version),
  index('network_datasets_owner_status_idx').on(table.ownerEntityId, table.status),
  check('network_datasets_status_valid', sql`${table.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`),
  check('network_datasets_publication_valid', sql`(${table.status} = 'DRAFT' AND ${table.publishedAt} IS NULL) OR (${table.status} IN ('PUBLISHED', 'ARCHIVED') AND ${table.publishedAt} IS NOT NULL)`),
  check('network_datasets_labels_valid', sql`length(trim(${table.version})) > 0 AND length(trim(${table.sourceSystem})) > 0 AND length(trim(${table.createdBy})) > 0`),
])

export const cableTypes = pgTable('cable_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
}, (table) => [check('cable_types_labels_valid', sql`length(trim(${table.code})) > 0 AND length(trim(${table.name})) > 0`)])

function pointColumns() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerEntityId: uuid('owner_entity_id').notNull(),
    datasetId: uuid('dataset_id').notNull(),
    code: text('code').notNull(),
    geometry: geometry('geometry', { type: 'Point' }).notNull(),
    sourceSystem: text('source_system').notNull(),
    sourceFile: text('source_file'),
    externalId: text('external_id'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  }
}

function pointConstraints(name: string, table: { [K in keyof ReturnType<typeof pointColumns>]: AnyPgColumn }) {
  return [
    unique(`${name}_id_scope_unique`).on(table.id, table.ownerEntityId, table.datasetId),
    unique(`${name}_owner_code_unique`).on(table.ownerEntityId, table.code),
    unique(`${name}_source_identity_unique`).on(table.ownerEntityId, table.sourceSystem, table.externalId),
    foreignKey({ columns: [table.datasetId, table.ownerEntityId], foreignColumns: [networkDatasets.id, networkDatasets.ownerEntityId] }),
    index(`${name}_geometry_gist`).using('gist', table.geometry),
    index(`${name}_owner_dataset_idx`).on(table.ownerEntityId, table.datasetId),
    check(`${name}_labels_valid`, sql`length(trim(${table.code})) > 0 AND length(trim(${table.sourceSystem})) > 0 AND length(trim(${table.createdBy})) > 0`),
    ...geometryChecks(name, table.geometry),
  ]
}

export const networkNodes = pgTable('network_nodes', pointColumns(), (table) => pointConstraints('network_nodes', table))

export const poles = pgTable('poles', {
  ...pointColumns(),
  heightM: integer('height_m').notNull(),
}, (table) => [
  ...pointConstraints('poles', table),
  check('poles_height_valid', sql`${table.heightM} IN (7, 9)`),
])
export const odcs = pgTable('odcs', pointColumns(), (table) => pointConstraints('odcs', table))
export const odps = pgTable('odps', pointColumns(), (table) => pointConstraints('odps', table))

export const networkSegments = pgTable('network_segments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerEntityId: uuid('owner_entity_id').notNull(),
  datasetId: uuid('dataset_id').notNull(),
  segmentCode: text('segment_code').notNull(),
  cableName: text('cable_name').notNull(),
  cableTypeId: uuid('cable_type_id').references(() => cableTypes.id),
  installedCoreCount: integer('installed_core_count'),
  capacityValidated: boolean('capacity_validated').notNull().default(false),
  installationMethod: text('installation_method'),
  roadSide: text('road_side'),
  startNodeId: uuid('start_node_id'),
  endNodeId: uuid('end_node_id'),
  status: text('status').notNull().default('ACTIVE'),
  geometry: geometry('geometry', { type: 'Geometry' }).notNull(),
  sourceSystem: text('source_system').notNull(),
  sourceFile: text('source_file'),
  externalId: text('external_id'),
  version: integer('version').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('network_segments_id_scope_unique').on(table.id, table.ownerEntityId, table.datasetId),
  unique('network_segments_id_owner_unique').on(table.id, table.ownerEntityId),
  unique('network_segments_owner_code_unique').on(table.ownerEntityId, table.segmentCode),
  unique('network_segments_source_identity_unique').on(table.ownerEntityId, table.sourceSystem, table.externalId),
  foreignKey({ columns: [table.datasetId, table.ownerEntityId], foreignColumns: [networkDatasets.id, networkDatasets.ownerEntityId] }),
  foreignKey({ columns: [table.startNodeId, table.ownerEntityId, table.datasetId], foreignColumns: [networkNodes.id, networkNodes.ownerEntityId, networkNodes.datasetId] }),
  foreignKey({ columns: [table.endNodeId, table.ownerEntityId, table.datasetId], foreignColumns: [networkNodes.id, networkNodes.ownerEntityId, networkNodes.datasetId] }),
  index('network_segments_geometry_gist').using('gist', table.geometry),
  index('network_segments_geography_gist').using('gist', sql`(${table.geometry}::geography)`),
  index('network_segments_owner_dataset_idx').on(table.ownerEntityId, table.datasetId),
  check('network_segments_labels_valid', sql`length(trim(${table.segmentCode})) > 0 AND length(trim(${table.cableName})) > 0 AND length(trim(${table.sourceSystem})) > 0 AND length(trim(${table.createdBy})) > 0`),
  check('network_segments_core_positive', sql`${table.installedCoreCount} IS NULL OR ${table.installedCoreCount} > 0`),
  check('network_segments_capacity_valid', sql`NOT ${table.capacityValidated} OR ${table.installedCoreCount} IS NOT NULL`),
  check('network_segments_installation_valid', sql`${table.installationMethod} IS NULL OR ${table.installationMethod} IN ('BURIAL', 'AERIAL')`),
  check('network_segments_road_side_valid', sql`${table.roadSide} IS NULL OR (${table.roadSide} IN ('LEFT', 'RIGHT') AND ${table.startNodeId} IS NOT NULL AND ${table.endNodeId} IS NOT NULL)`),
  check('network_segments_nodes_paired', sql`(${table.startNodeId} IS NULL) = (${table.endNodeId} IS NULL)`),
  check('network_segments_status_valid', sql`${table.status} IN ('ACTIVE', 'INACTIVE')`),
  check('network_segments_version_positive', sql`${table.version} > 0`),
  check('network_segments_geometry_line', sql`ST_GeometryType(${table.geometry}) IN ('ST_LineString', 'ST_MultiLineString') AND ST_Length(${table.geometry}) > 0`),
  ...geometryChecks('network_segments', table.geometry),
])

function linkColumns() {
  return {
    segmentId: uuid('segment_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    ownerEntityId: uuid('owner_entity_id').notNull(),
    datasetId: uuid('dataset_id').notNull(),
  }
}

function linkConstraints(table: { segmentId: AnyPgColumn; assetId: AnyPgColumn; ownerEntityId: AnyPgColumn; datasetId: AnyPgColumn }, asset: { id: AnyPgColumn; ownerEntityId: AnyPgColumn; datasetId: AnyPgColumn }) {
  return [
    primaryKey({ columns: [table.segmentId, table.assetId] }),
    foreignKey({ columns: [table.segmentId, table.ownerEntityId, table.datasetId], foreignColumns: [networkSegments.id, networkSegments.ownerEntityId, networkSegments.datasetId] }),
    foreignKey({ columns: [table.assetId, table.ownerEntityId, table.datasetId], foreignColumns: [asset.id, asset.ownerEntityId, asset.datasetId] }),
    index().on(table.assetId),
  ]
}

export const segmentPoles = pgTable('segment_poles', linkColumns(), (table) => linkConstraints(table, poles))
export const segmentOdcs = pgTable('segment_odcs', linkColumns(), (table) => linkConstraints(table, odcs))
export const segmentOdps = pgTable('segment_odps', linkColumns(), (table) => linkConstraints(table, odps))
