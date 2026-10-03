import { Injectable } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import { DatabaseService } from '../../database/database.service.js'
import { analysisResults } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { InternalAdapters } from './internal-adapters.js'
import type { AnalysisInput } from './analysis.dto.js'
import { analysisPolicySchema, currentSetting } from '../settings/settings.service.js'

@Injectable()
export class AnalysisService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService, private readonly adapters: InternalAdapters) {}
  async analyze(userId: string, input: AnalysisInput, persist = true): Promise<Record<string, unknown>> {
    await this.access.requireEntityPermission(userId, input.entityId, 'analysis.create')
    const setting = await currentSetting(this.database.db,input.entityId,'analysis-policy')
    const policy = analysisPolicySchema.parse(setting?.value ?? { radiusM:5000,formulaApproved:false,slackPercent:null,extraLengthM:null,maxDetourPercent:null })
    let coordinates = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude } : null
    let preliminary: Record<string, unknown> | null = null
    let geocodingProvenance: Record<string, unknown> = {}
    if (!coordinates) {
      const geocoding = await this.adapters.geocode(input.address!)
      if (geocoding.status !== 'OK') preliminary = { ...geocoding, needsSurvey: true }
      else {
        coordinates = { latitude: geocoding.candidate.latitude, longitude: geocoding.candidate.longitude }
        geocodingProvenance = { geocodingProvider: geocoding.provider, geocodingDatasetVersion: geocoding.datasetVersion }
        if ('attribution' in geocoding) geocodingProvenance.attribution = geocoding.attribution
      }
    }
    let result: Record<string, unknown>
    if (preliminary) result = preliminary
    else {
      const { latitude, longitude } = coordinates!
      const rows = await this.database.db.execute<{ segmentId: string; cableName: string; datasetVersion: string; distanceM: number; referencePoint: unknown; installedCoreCount: number | null; capacityValidated: boolean }>(sql`
        WITH p AS (SELECT ST_SetSRID(ST_MakePoint(${longitude},${latitude}),4326) AS geometry)
        SELECT s.id AS "segmentId",s.cable_name AS "cableName",d.version AS "datasetVersion",
          ST_Distance(s.geometry::geography,p.geometry::geography) AS "distanceM",
          ST_AsGeoJSON(ST_ClosestPoint(s.geometry,p.geometry),15)::jsonb AS "referencePoint",
          s.installed_core_count AS "installedCoreCount",s.capacity_validated AS "capacityValidated",s.owner_entity_id AS "ownerEntityId",
          jsonb_build_object('total',CASE WHEN s.capacity_validated THEN s.installed_core_count END,
            'used',(SELECT COALESCE(sum(core_count),0) FROM core_allocations WHERE segment_id=s.id AND deallocated_at IS NULL),
            'booked',(SELECT COALESCE(sum(core_count),0) FROM bookings WHERE segment_id=s.id AND status='BOOKED' AND expires_at>statement_timestamp()),'asOf',statement_timestamp()) AS capacity
        FROM network_segments s JOIN network_datasets d ON d.id=s.dataset_id,p
        WHERE s.owner_entity_id=${input.entityId}::uuid AND s.status='ACTIVE' AND d.status='PUBLISHED'
          AND ST_DWithin(s.geometry::geography,p.geometry::geography,${policy.radiusM})
        ORDER BY ST_Distance(s.geometry::geography,p.geometry::geography),s.id LIMIT 1`)
      const nearest = rows.rows[0]
      result = { status: nearest ? 'OK' : 'NO_NETWORK_IN_RADIUS', coordinates, coordinateSource: input.latitude !== undefined ? 'INPUT_COORDINATES_USED' : 'INTERNAL_GEOCODING', radiusM: policy.radiusM, policyVersion:setting?.version ?? 0, nearest: nearest ?? null, estimationMethod: nearest ? 'GEOMETRIC_PRELIMINARY' : 'NOT_AVAILABLE', nearestNetworkDistanceM: nearest?.distanceM ?? null, estimatedCableLengthM: null, route: null, needsSurvey: true }
      if (nearest && input.connectionPointId) {
        const points = await this.database.db.execute<{ geometry: unknown }>(sql`SELECT ST_AsGeoJSON(p.geometry,15)::jsonb AS geometry FROM odps p JOIN segment_odps l ON l.asset_id=p.id WHERE l.segment_id=${nearest.segmentId}::uuid AND p.id=${input.connectionPointId}::uuid
          UNION ALL SELECT ST_AsGeoJSON(p.geometry,15)::jsonb FROM odcs p JOIN segment_odcs l ON l.asset_id=p.id WHERE l.segment_id=${nearest.segmentId}::uuid AND p.id=${input.connectionPointId}::uuid`)
        if (!points.rows[0]) result.routeStatus = 'CONNECTION_POINT_NOT_VALIDATED'
        else {
          const route = await this.adapters.route(coordinates!, points.rows[0].geometry)
          const detourPercent = route ? route.shortestFeasibleDistanceM === 0 ? route.distanceM === 0 ? 0 : Infinity : (route.distanceM/route.shortestFeasibleDistanceM-1)*100 : null
          const accepted = route && policy.maxDetourPercent !== null && detourPercent !== null && detourPercent<=policy.maxDetourPercent
          result.route = accepted ? route : null
          result.routeStatus = route ? 'ROAD_ROUTE_ESTIMATE' : 'ROUTING_NOT_AVAILABLE'
          if (route && !accepted) result.routeStatus = 'ROUTE_POLICY_NOT_MET_OR_UNCONFIGURED'
          if (accepted) {
            result.estimationMethod = 'ROAD_ROUTE_ESTIMATE'
            result.selectedRouteDetourPercent = detourPercent
            if (policy.formulaApproved) {
              result.estimatedCableLengthM = Math.ceil(route.distanceM*(1+policy.slackPercent!/100)+policy.extraLengthM!)
              result.formulaVersion = setting!.version
            }
          }
        }
      }
    }
    Object.assign(result, geocodingProvenance)
    result.analysisTime = new Date().toISOString()
    if (persist) {
      const [record] = await this.database.db.insert(analysisResults).values({ entityId: input.entityId, userId, input, result }).returning({ id: analysisResults.id })
      result.analysisId = record.id
    }
    return result
  }
  async history(userId: string,entityId: string,page: number,pageSize: number) {
    await this.access.requireEntityPermission(userId,entityId,'analysis.read')
    const where = and(eq(analysisResults.entityId,entityId),eq(analysisResults.userId,userId))
    const data = await this.database.db.select().from(analysisResults).where(where).orderBy(desc(analysisResults.createdAt),desc(analysisResults.id)).limit(pageSize).offset((page-1)*pageSize)
    const [{ total }] = await this.database.db.select({ total:sql<number>`count(*)::int` }).from(analysisResults).where(where)
    return { data,meta:{ page,pageSize,total } }
  }
}
