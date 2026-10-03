import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { AccessService } from '../access/access.service.js'

export async function utilization(db: Transaction | DatabaseService['db'], entityId: string, page: number, pageSize: number) {
  const result = await db.execute<{ data: Record<string, unknown>[]; total: number; asOf: string | Date; summary: Record<string, unknown> }>(sql`
    WITH clock AS (SELECT statement_timestamp() AS as_of), scoped AS (
      SELECT s.id, s.segment_code, s.cable_name, d.version AS dataset_version,
        CASE WHEN s.capacity_validated THEN s.installed_core_count ELSE NULL END AS total,
        (SELECT COALESCE(sum(core_count),0)::int FROM core_allocations WHERE segment_id = s.id AND deallocated_at IS NULL) AS used,
        (SELECT COALESCE(sum(core_count),0)::int FROM bookings, clock WHERE segment_id = s.id AND status = 'BOOKED' AND expires_at > clock.as_of) AS booked,
        (SELECT count(*)::int FROM waiting_list_entries WHERE segment_id = s.id AND status = 'WAITING') AS waiting_count,
        (SELECT COALESCE(sum(core_count),0)::float8 FROM waiting_list_entries WHERE segment_id = s.id AND status = 'WAITING') AS waiting_cores
      FROM network_segments s JOIN network_datasets d ON d.id = s.dataset_id
      WHERE s.owner_entity_id = ${entityId}::uuid AND d.status = 'PUBLISHED'
    ), page AS (SELECT * FROM scoped ORDER BY segment_code,id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize})
    SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('segmentId',id,'segmentCode',segment_code,'cableName',cable_name,'datasetVersion',dataset_version,
      'total',total,'used',used,'booked',booked,'idle',total-used,'available',total-used-booked,'waitingCount',waiting_count,'waitingCores',waiting_cores) ORDER BY segment_code,id) FROM page),'[]'::jsonb) AS data,
      (SELECT count(*)::int FROM scoped) AS total, (SELECT as_of FROM clock) AS "asOf",
      (SELECT jsonb_build_object('segmentCount',count(*),'unknownCapacityCount',count(*) FILTER (WHERE total IS NULL),
        'total',CASE WHEN count(*) FILTER (WHERE total IS NULL)=0 THEN COALESCE(sum(total),0) END,
        'used',COALESCE(sum(used),0),'booked',COALESCE(sum(booked),0),
        'idle',CASE WHEN count(*) FILTER (WHERE total IS NULL)=0 THEN COALESCE(sum(total-used),0) END,
        'available',CASE WHEN count(*) FILTER (WHERE total IS NULL)=0 THEN COALESCE(sum(total-used-booked),0) END,
        'waitingCount',COALESCE(sum(waiting_count),0),'waitingCores',COALESCE(sum(waiting_cores),0)) FROM scoped) AS summary`)
  const record = result.rows[0]
  return { data: record.data, meta: { entityId, page, pageSize, total: record.total, asOf: new Date(record.asOf).toISOString(), summary: record.summary } }
}
@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService) {}
  async get(userId: string, entityId: string, page: number, pageSize: number) {
    await this.access.requireEntityPermission(userId, entityId, 'reports.read')
    return utilization(this.database.db, entityId, page, pageSize)
  }
}
