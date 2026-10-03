import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { BBox, MapQuery, SegmentsQuery } from './network.dto.js'

export interface SegmentRecord {
  id: string
  ownerEntityId: string
  datasetId: string
  datasetVersion: string
  segmentCode: string
  cableName: string
  cableType: { id: string; code: string; name: string } | null
  installedCoreCount: number | null
  capacityValidated: boolean
  installationMethod: 'BURIAL' | 'AERIAL' | null
  roadSide: 'LEFT' | 'RIGHT' | null
  startNodeId: string | null
  endNodeId: string | null
  status: 'ACTIVE' | 'INACTIVE'
  geometry: unknown
  version: number
  assetCounts: { poles: number; odcs: number; odps: number }
  [key: string]: unknown
}

function envelope(bbox: BBox) {
  return sql`ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)`
}

// Only fixed identifiers are embedded in SQL; all client input is parameterized.
function segmentJson(shape: SQL) {
  return sql`jsonb_build_object(
    'id', s.id, 'ownerEntityId', s.owner_entity_id, 'datasetId', s.dataset_id,
    'datasetVersion', d.version, 'segmentCode', s.segment_code, 'cableName', s.cable_name,
    'cableType', CASE WHEN ct.id IS NULL THEN NULL ELSE jsonb_build_object('id', ct.id, 'code', ct.code, 'name', ct.name) END,
    'installedCoreCount', s.installed_core_count, 'capacityValidated', s.capacity_validated,
    'installationMethod', s.installation_method, 'roadSide', s.road_side,
    'startNodeId', s.start_node_id, 'endNodeId', s.end_node_id, 'status', s.status,
    'geometry', ST_AsGeoJSON(${shape}, 15)::jsonb, 'version', s.version,
    'capacity', jsonb_build_object(
      'total', CASE WHEN s.capacity_validated THEN s.installed_core_count END,
      'used', (SELECT COALESCE(sum(core_count),0) FROM core_allocations WHERE segment_id=s.id AND deallocated_at IS NULL),
      'booked', (SELECT COALESCE(sum(core_count),0) FROM bookings WHERE segment_id=s.id AND status='BOOKED' AND expires_at>statement_timestamp()),
      'idle', CASE WHEN s.capacity_validated THEN s.installed_core_count END-(SELECT COALESCE(sum(core_count),0) FROM core_allocations WHERE segment_id=s.id AND deallocated_at IS NULL),
      'available', CASE WHEN s.capacity_validated THEN s.installed_core_count END-(SELECT COALESCE(sum(core_count),0) FROM core_allocations WHERE segment_id=s.id AND deallocated_at IS NULL)-(SELECT COALESCE(sum(core_count),0) FROM bookings WHERE segment_id=s.id AND status='BOOKED' AND expires_at>statement_timestamp()),
      'waitingCount',(SELECT count(*) FROM waiting_list_entries WHERE segment_id=s.id AND status='WAITING'),
      'waitingCores',(SELECT COALESCE(sum(core_count),0) FROM waiting_list_entries WHERE segment_id=s.id AND status='WAITING'),
      'expiryPendingCount',(SELECT count(*) FROM bookings WHERE segment_id=s.id AND status='BOOKED' AND expires_at<=statement_timestamp()),
      'asOf',statement_timestamp()),
    'assetCounts', jsonb_build_object(
      'poles', (SELECT count(*) FROM segment_poles WHERE segment_id = s.id),
      'odcs', (SELECT count(*) FROM segment_odcs WHERE segment_id = s.id),
      'odps', (SELECT count(*) FROM segment_odps WHERE segment_id = s.id)),
    'provenance', jsonb_build_object('sourceSystem', s.source_system, 'sourceFile', s.source_file,
      'externalId', s.external_id, 'createdBy', s.created_by, 'createdAt', s.created_at, 'updatedAt', s.updated_at))`
}

@Injectable()
export class NetworkRepository {
  constructor(private readonly database: DatabaseService) {}

  async listSegments(query: SegmentsQuery) {
    const bounds = envelope(query.bbox)
    const status = query.status ? sql`AND s.status = ${query.status}` : sql``
    const result = await this.database.db.execute<{ data: SegmentRecord[]; total: number }>(sql`
      WITH matches AS (
        SELECT s.id, s.segment_code, ST_CollectionExtract(ST_Intersection(s.geometry, ${bounds}), 2) AS clipped FROM network_segments s
        JOIN network_datasets d ON d.id = s.dataset_id AND d.owner_entity_id = s.owner_entity_id
        WHERE s.owner_entity_id = ${query.entityId}::uuid AND d.status = 'PUBLISHED'
          AND ST_Intersects(s.geometry, ${bounds}) ${status}
      ), visible AS (
        SELECT * FROM matches WHERE NOT ST_IsEmpty(clipped)
      ), page AS (
        SELECT * FROM visible ORDER BY segment_code, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      )
      SELECT COALESCE((SELECT jsonb_agg(${segmentJson(sql`p.clipped`)} ORDER BY s.segment_code, s.id)
        FROM page p JOIN network_segments s ON s.id = p.id
        JOIN network_datasets d ON d.id = s.dataset_id LEFT JOIN cable_types ct ON ct.id = s.cable_type_id), '[]'::jsonb) AS data,
        (SELECT count(*)::int FROM visible) AS total`)
    return result.rows[0]
  }

  async findSegment(id: string, allowedEntityIds: string[]) {
    const result = await this.database.db.execute<{ segment: SegmentRecord }>(sql`
      SELECT ${segmentJson(sql`s.geometry`)} || jsonb_build_object(
        'nodes', jsonb_build_object(
          'start', (SELECT jsonb_build_object('id', n.id, 'code', n.code, 'geometry', ST_AsGeoJSON(n.geometry, 15)::jsonb) FROM network_nodes n WHERE n.id = s.start_node_id),
          'end', (SELECT jsonb_build_object('id', n.id, 'code', n.code, 'geometry', ST_AsGeoJSON(n.geometry, 15)::jsonb) FROM network_nodes n WHERE n.id = s.end_node_id)),
        'assets', jsonb_build_object(
          'poles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'heightM', p.height_m, 'geometry', ST_AsGeoJSON(p.geometry, 15)::jsonb) ORDER BY p.code, p.id) FROM segment_poles l JOIN poles p ON p.id = l.asset_id WHERE l.segment_id = s.id), '[]'::jsonb),
          'odcs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'geometry', ST_AsGeoJSON(p.geometry, 15)::jsonb) ORDER BY p.code, p.id) FROM segment_odcs l JOIN odcs p ON p.id = l.asset_id WHERE l.segment_id = s.id), '[]'::jsonb),
          'odps', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'geometry', ST_AsGeoJSON(p.geometry, 15)::jsonb) ORDER BY p.code, p.id) FROM segment_odps l JOIN odps p ON p.id = l.asset_id WHERE l.segment_id = s.id), '[]'::jsonb))) AS segment
      FROM network_segments s JOIN network_datasets d ON d.id = s.dataset_id AND d.owner_entity_id = s.owner_entity_id
      LEFT JOIN cable_types ct ON ct.id = s.cable_type_id
      WHERE s.id = ${id}::uuid AND s.owner_entity_id = ANY(ARRAY[${sql.join(allowedEntityIds.map((entityId) => sql`${entityId}::uuid`), sql`, `)}]::uuid[]) AND d.status = 'PUBLISHED'`)
    return result.rows[0]?.segment ?? null
  }

  async mapFeatures(query: MapQuery) {
    const bounds = envelope(query.bbox)
    const layerQueries: Record<MapQuery['layers'][number], SQL> = {
      segments: sql`SELECT s.id, s.owner_entity_id, s.dataset_id, s.cable_name AS name,
        'segments'::text AS layer, ST_CollectionExtract(ST_Intersection(s.geometry, ${bounds}), 2) AS geometry,
        jsonb_build_object('segmentCode', s.segment_code, 'status', s.status, 'capacityValidated', s.capacity_validated) AS extra
        FROM network_segments s WHERE s.owner_entity_id = ${query.entityId}::uuid AND ST_Intersects(s.geometry, ${bounds})`,
      poles: sql`SELECT p.id, p.owner_entity_id, p.dataset_id, p.code AS name, 'poles'::text AS layer,
        p.geometry, jsonb_build_object('heightM', p.height_m) AS extra
        FROM poles p WHERE p.owner_entity_id = ${query.entityId}::uuid AND ST_Intersects(p.geometry, ${bounds})`,
      odc: sql`SELECT p.id, p.owner_entity_id, p.dataset_id, p.code AS name, 'odc'::text AS layer,
        p.geometry, '{}'::jsonb AS extra
        FROM odcs p WHERE p.owner_entity_id = ${query.entityId}::uuid AND ST_Intersects(p.geometry, ${bounds})`,
      odp: sql`SELECT p.id, p.owner_entity_id, p.dataset_id, p.code AS name, 'odp'::text AS layer,
        p.geometry, '{}'::jsonb AS extra
        FROM odps p WHERE p.owner_entity_id = ${query.entityId}::uuid AND ST_Intersects(p.geometry, ${bounds})`,
    }
    const result = await this.database.db.execute<{ features: unknown[]; total: number }>(sql`
      WITH candidates AS (${sql.join(query.layers.map((layer) => layerQueries[layer]), sql` UNION ALL `)}), matches AS (
        SELECT c.*, d.version AS dataset_version FROM candidates c
        JOIN network_datasets d ON d.id = c.dataset_id AND d.owner_entity_id = c.owner_entity_id
        WHERE d.status = 'PUBLISHED' AND NOT ST_IsEmpty(c.geometry)
      ), page AS (
        SELECT * FROM matches ORDER BY layer, id LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      )
      SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'Feature', 'id', layer || ':' || id,
        'geometry', ST_AsGeoJSON(geometry, 15)::jsonb,
        'properties', jsonb_build_object('id', id, 'name', name, 'layer', layer,
          'ownerEntityId', owner_entity_id, 'datasetId', dataset_id, 'datasetVersion', dataset_version) || extra) ORDER BY layer, id) FROM page), '[]'::jsonb) AS features,
        (SELECT count(*)::int FROM matches) AS total`)
    return result.rows[0]
  }
}
