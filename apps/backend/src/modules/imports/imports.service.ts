import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { DatabaseService } from '../../database/database.service.js'
import type { Transaction } from '../../database/transaction.js'
import { auditLogs, cableNameHistory, cableTypes, importPreviews, networkDatasets, networkNodes, networkSegments, odcs, odps, poles, referenceAreas, referenceFeatures, segmentOdcs, segmentOdps, segmentPoles } from '../../database/schema/index.js'
import { AccessService } from '../access/access.service.js'
import { validateCableName } from '../assets/assets.service.js'
import { readUsage } from '../capacity/capacity.repository.js'
import { assetRowSchema, pointAddressSchema, type AssetRow, type ImportError, type ReferenceAreaRow, type ReferenceFeatureRow, parseAssetFile } from './import-parser.js'
import type { UploadFile } from '../files/tabular-files.js'
import { InternalAdapters } from '../analysis/internal-adapters.js'
import { parseInput } from '../../common/domain-input.js'

type Db = Transaction | DatabaseService['db']
async function fingerprint(db: Db, entityId: string, sourceSystem: string) {
  const result = await db.execute<{ hash: string }>(sql`SELECT md5(COALESCE(string_agg(value,',' ORDER BY value),'')) AS hash FROM (
    SELECT 'dataset:' || to_jsonb(d)::text AS value FROM network_datasets d WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'segment:' || to_jsonb(s)::text FROM network_segments s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'node:' || to_jsonb(s)::text FROM network_nodes s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'pole:' || to_jsonb(s)::text FROM poles s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'odc:' || to_jsonb(s)::text FROM odcs s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'odp:' || to_jsonb(s)::text FROM odps s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'reference-area:' || to_jsonb(s)::text FROM reference_areas s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
    UNION ALL SELECT 'reference-feature:' || to_jsonb(s)::text FROM reference_features s WHERE owner_entity_id=${entityId}::uuid AND source_system=${sourceSystem}
  ) state`)
  return result.rows[0].hash
}
const geom = (row: { geometry: unknown }) => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(row.geometry)}),4326)`
const hasUnmappedReferenceFeatures = (preview: { referenceFeatures: Record<string, unknown>[] }) =>
  preview.referenceFeatures.some((feature) => feature.assetRowValid !== true)

@Injectable()
export class ImportsService {
  constructor(private readonly database: DatabaseService, private readonly access: AccessService, private readonly adapters: InternalAdapters) {}

  async preview(userId: string, entityId: string, sourceSystem: string, file: UploadFile, mappings: Record<string, Record<string, unknown>>) {
    await this.access.requireEntityPermission(userId, entityId, 'imports.write')
    const parsed = await parseAssetFile(file, mappings)
    const baseFingerprint = await fingerprint(this.database.db, entityId, sourceSystem)
    const [preview] = await this.database.db.insert(importPreviews).values({ entityId, ownerId: userId, sourceSystem, sourceName: file.originalname, rows: parsed.rows, areas: parsed.areas, referenceFeatures: parsed.referenceFeatures, errors: parsed.errors, baseFingerprint }).returning()
    const hasReferences = parsed.areas.length > 0 || parsed.referenceFeatures.length > 0
    const published = hasReferences ? await this.publishAreas(userId, preview.id, `reference-${preview.id}`) : { data: preview }
    return { data: published.data, meta: { valid: parsed.rows.length, referenceAreas: parsed.areas.length, referenceFeatures: parsed.referenceFeatures.length, invalid: parsed.errors.length, referenceAutoPublished: hasReferences, publishRequiresDomainValidation: true } }
  }

  async get(userId: string, id: string) {
    const [preview] = await this.database.db.select().from(importPreviews).where(and(eq(importPreviews.id, id), eq(importPreviews.ownerId, userId)))
    if (!preview) throw new NotFoundException('Import not found')
    await this.access.requireEntityPermission(userId, preview.entityId, 'imports.write')
    return { data: preview }
  }

  async geocodeRow(userId: string, id: string, rowNumber: number) {
    const { data: preview } = await this.get(userId, id)
    if (preview.status !== 'PREVIEW') throw new ConflictException('Published import cannot be changed')
    const error = (preview.errors as ImportError[]).find((row) => row.rowNumber === rowNumber && row.sourceRow)
    if (!error) throw new ConflictException('This row does not need address geocoding')
    const draft = parseInput(pointAddressSchema, error.sourceRow)
    // Only the address is sent, never asset code, customer/PIC metadata or contacts.
    const result = await this.adapters.geocode(draft.address)
    await this.access.requireEntityPermission(userId, preview.entityId, 'imports.write')
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(importPreviews).where(eq(importPreviews.id, id)).for('update')
      if (current.status !== 'PREVIEW') throw new ConflictException('Published import cannot be changed')
      const errors = current.errors as ImportError[]
      const pending = errors.find((row) => row.rowNumber === rowNumber && row.sourceRow)
      if (!pending) throw new ConflictException('Import row changed; reload preview')
      const candidates = result.status === 'OK' ? [result.candidate] : result.status === 'AMBIGUOUS_ADDRESS' ? result.candidates : []
      const updated = errors.map((row) => row === pending ? { ...row, code: candidates.length ? 'COORDINATE_CONFIRMATION_REQUIRED' : result.status,
        message: candidates.length ? 'Konfirmasi kandidat koordinat sebelum publish. Geocoding tidak membuktikan lokasi aset fisik.' : result.status,
        candidates, lookupId: randomUUID(), provider: 'provider' in result ? result.provider : 'INTERNAL_GEOCODING', datasetVersion: 'datasetVersion' in result ? result.datasetVersion : null } : row)
      const [record] = await tx.update(importPreviews).set({ errors: updated }).where(eq(importPreviews.id, id)).returning()
      return { data: record }
    })
  }

  async confirmRow(userId: string, id: string, rowNumber: number, lookupId: string, candidateIndex: number) {
    const { data: preview } = await this.get(userId, id)
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx.select().from(importPreviews).where(eq(importPreviews.id, id)).for('update')
      if (current.status !== 'PREVIEW') throw new ConflictException('Published import cannot be changed')
      const errors = current.errors as ImportError[]
      const pending = errors.find((row) => row.rowNumber === rowNumber && row.sourceRow)
      if (!pending || pending.lookupId !== lookupId) throw new ConflictException('Geocoding candidates changed; reload preview')
      const candidate = pending.candidates?.[candidateIndex]
      if (!candidate) throw new UnprocessableEntityException('Choose a candidate returned for this import row')
      const draft = parseInput(pointAddressSchema, pending.sourceRow)
      const row = parseInput(assetRowSchema, { ...draft, geometry: { type: 'Point', coordinates: [candidate.longitude, candidate.latitude] },
        geocoding: { provider: pending.provider ?? 'INTERNAL_GEOCODING', datasetVersion: pending.datasetVersion ?? null, confirmedBy: userId, confirmedAt: new Date().toISOString(), label: candidate.label, ...(candidate.precision ? { precision: candidate.precision } : {}) } })
      const rows = [...current.rows, row].sort((a, b) => Number(a.rowNumber) - Number(b.rowNumber))
      const [record] = await tx.update(importPreviews).set({ rows, errors: errors.filter((error) => error !== pending) }).where(eq(importPreviews.id, id)).returning()
      await tx.insert(auditLogs).values({ entityId: preview.entityId, actorId: userId, action: 'IMPORT_COORDINATES_CONFIRMED', resourceId: id, details: { rowNumber, provider: row.geocoding?.provider, datasetVersion: row.geocoding?.datasetVersion, coordinates: row.geometry.coordinates } })
      return { data: record }
    })
  }

  async publishAreas(userId: string, id: string, version: string) {
    const { data: preview } = await this.get(userId, id)
    if (!preview.areas.length && !preview.referenceFeatures.length) throw new UnprocessableEntityException('Import preview has no valid reference features')
    if (preview.status !== 'PREVIEW') throw new ConflictException('Import is already published')
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${preview.entityId + ':network-write'},0))`)
      const [current] = await tx.select().from(importPreviews).where(eq(importPreviews.id, id)).for('update')
      if (current.areasPublishedAt) return { data: current }
      if (current.status !== 'PREVIEW') throw new ConflictException('Import is already published')
      const areas = current.areas as ReferenceAreaRow[]
      const referenceRows = current.referenceFeatures as ReferenceFeatureRow[]
      if (!areas.length && !referenceRows.length) throw new UnprocessableEntityException('Import preview has no valid reference features')
      if (await fingerprint(tx, preview.entityId, preview.sourceSystem) !== current.baseFingerprint) throw new ConflictException('Source dataset changed; create a new preview')
      const datasets = await tx.select().from(networkDatasets).where(and(eq(networkDatasets.ownerEntityId, preview.entityId), eq(networkDatasets.sourceSystem, preview.sourceSystem)))
      if (datasets.length > 1 || datasets.some((dataset) => dataset.status !== 'PUBLISHED')) throw new ConflictException('Source has multiple or unpublished datasets; explicit migration is required')
      let dataset = datasets[0]
      if (!dataset) [dataset] = await tx.insert(networkDatasets).values({ ownerEntityId: preview.entityId, version, sourceSystem: preview.sourceSystem, createdBy: userId }).returning()
      else if (dataset.version === version) throw new ConflictException('Publish requires a new dataset version')
      const source = { ownerEntityId: preview.entityId, datasetId: dataset.id, sourceSystem: preview.sourceSystem, sourceFile: preview.sourceName }
      const identities = new Set<string>()
      for (const area of areas) {
        if (identities.has(area.externalId)) throw new ConflictException(`Duplicate reference-area identity at row ${area.rowNumber}`)
        identities.add(area.externalId)
        const [existing] = await tx.select().from(referenceAreas).where(and(
          eq(referenceAreas.ownerEntityId, preview.entityId), eq(referenceAreas.sourceSystem, preview.sourceSystem), eq(referenceAreas.externalId, area.externalId),
        ))
        const data = { ...source, externalId: area.externalId, code: area.code, name: area.name, properties: area.properties, geometry: geom(area) }
        if (existing) await tx.update(referenceAreas).set(data).where(eq(referenceAreas.id, existing.id))
        else await tx.insert(referenceAreas).values({ ...data, createdBy: userId })
      }
      for (const feature of referenceRows) {
        if (identities.has(feature.externalId)) throw new ConflictException(`Duplicate reference-feature identity at row ${feature.rowNumber}`)
        identities.add(feature.externalId)
        const [existing] = await tx.select().from(referenceFeatures).where(and(
          eq(referenceFeatures.ownerEntityId, preview.entityId), eq(referenceFeatures.sourceSystem, preview.sourceSystem), eq(referenceFeatures.externalId, feature.externalId),
        ))
        const data = { ...source, externalId: feature.externalId, name: feature.name, properties: feature.properties, geometry: geom(feature) }
        if (existing) await tx.update(referenceFeatures).set(data).where(eq(referenceFeatures.id, existing.id))
        else await tx.insert(referenceFeatures).values({ ...data, createdBy: userId })
      }
      await tx.update(networkDatasets).set({ version, status: 'PUBLISHED', publishedAt: sql`clock_timestamp()` }).where(eq(networkDatasets.id, dataset.id))
      const baseFingerprint = await fingerprint(tx, preview.entityId, preview.sourceSystem)
      const [updated] = await tx.update(importPreviews).set({ datasetId: dataset.id, areasPublishedAt: sql`clock_timestamp()`, baseFingerprint }).where(eq(importPreviews.id, id)).returning()
      await tx.insert(auditLogs).values({ entityId: preview.entityId, actorId: userId, action: 'IMPORT_REFERENCE_AREAS_PUBLISHED', resourceId: id, details: { datasetId: dataset.id, version, referenceAreas: areas.length, referenceFeatures: referenceRows.length } })
      return { data: updated }
    })
  }

  async publish(userId: string, id: string, version: string) {
    const { data: preview } = await this.get(userId, id)
    if (preview.errors.length || hasUnmappedReferenceFeatures(preview) || (!preview.rows.length && !preview.areas.length)) throw new UnprocessableEntityException('Resolve import errors and map reference features before operational publish')
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${preview.entityId + ':network-write'},0))`)
      const [current] = await tx.select().from(importPreviews).where(eq(importPreviews.id, id)).for('update')
      if (current.status === 'PUBLISHED') return { data: { id, datasetId: current.datasetId, status: current.status } }
      if (current.errors.length || hasUnmappedReferenceFeatures(current) || (!current.rows.length && !current.areas.length)) throw new UnprocessableEntityException('Resolve import errors and map reference features before operational publish')
      if (await fingerprint(tx, preview.entityId, preview.sourceSystem) !== preview.baseFingerprint) throw new ConflictException('Source dataset changed; create a new preview')
      const rows = current.rows as AssetRow[]
      const areas = current.areas as ReferenceAreaRow[]
      const referenceRows = current.referenceFeatures as ReferenceFeatureRow[]
      const datasets = await tx.select().from(networkDatasets).where(and(eq(networkDatasets.ownerEntityId, preview.entityId), eq(networkDatasets.sourceSystem, preview.sourceSystem)))
      if (datasets.length > 1 || datasets.some((d) => d.status !== 'PUBLISHED')) throw new ConflictException('Source has multiple or unpublished datasets; explicit migration is required')
      let dataset = datasets[0]
      if (!dataset) [dataset] = await tx.insert(networkDatasets).values({ ownerEntityId: preview.entityId, version, sourceSystem: preview.sourceSystem, createdBy: userId }).returning()
      else if (dataset.version === version) throw new ConflictException('Publish requires a new dataset version')
      // One canonical dataset per source. Imports merge; absent assets are never deleted.
      const locked = await tx.select().from(networkSegments).where(eq(networkSegments.datasetId, dataset.id)).orderBy(asc(networkSegments.id)).for('update')
      const source = { ownerEntityId: preview.entityId, datasetId: dataset.id, sourceSystem: preview.sourceSystem, sourceFile: preview.sourceName }
      const nodes = new Map((await tx.select().from(networkNodes).where(eq(networkNodes.datasetId, dataset.id))).map((n) => [n.code, n.id]))
      const segments = new Map(locked.map((s) => [s.segmentCode, s.id]))
      const codes = new Set<string>()
      for (const row of rows) {
        const code = `${row.kind}:${row.code}`
        if (codes.has(code)) throw new ConflictException(`Duplicate ${row.kind} code at row ${row.rowNumber}`)
        codes.add(code)
      }
      for (const row of rows.filter((r) => r.kind === 'NODE')) {
        const [existing] = await tx.select().from(networkNodes).where(and(eq(networkNodes.ownerEntityId, preview.entityId), eq(networkNodes.sourceSystem, preview.sourceSystem), eq(networkNodes.externalId, row.externalId)))
        const data = { ...source, code: row.code, geometry: geom(row), externalId: row.externalId }
        const [node] = existing ? await tx.update(networkNodes).set(data).where(eq(networkNodes.id, existing.id)).returning() : await tx.insert(networkNodes).values({ ...data, createdBy: userId }).returning()
        if (existing) nodes.delete(existing.code)
        nodes.set(node.code, node.id)
      }
      for (const row of rows.filter((r) => r.kind === 'SEGMENT')) {
        const existing = locked.find((s) => s.externalId === row.externalId && s.sourceSystem === preview.sourceSystem)
        const policyVersion = await validateCableName(tx, preview.entityId, row.cableName!, existing?.id)
        const startNodeId = row.startNodeCode ? nodes.get(row.startNodeCode) : existing?.startNodeId
        const endNodeId = row.endNodeCode ? nodes.get(row.endNodeCode) : existing?.endNodeId
        if ((row.startNodeCode && !startNodeId) || (row.endNodeCode && !endNodeId)) throw new UnprocessableEntityException(`Unknown topology node at row ${row.rowNumber}`)
        if (existing?.roadSide && (row.startNodeCode || JSON.stringify(row.geometry)) && row.roadSide === undefined) {
          const same = await tx.execute<{ same: boolean }>(sql`SELECT ST_OrderingEquals(geometry,${geom(row)}) AS same FROM network_segments WHERE id=${existing.id}::uuid`)
          if (!same.rows[0].same || startNodeId !== existing.startNodeId || endNodeId !== existing.endNodeId) throw new UnprocessableEntityException('Geometry/direction change requires explicit road-side confirmation')
        }
        let cableTypeId = existing?.cableTypeId
        if (row.cableTypeCode) {
          const [type] = await tx.select().from(cableTypes).where(eq(cableTypes.code, row.cableTypeCode))
          if (!type) throw new UnprocessableEntityException(`Unknown cable type at row ${row.rowNumber}`)
          cableTypeId = type.id
        }
        if (existing) {
          const usage = await readUsage(tx, existing)
          if (row.installedCoreCount !== undefined && row.installedCoreCount < usage.used + usage.booked) throw new ConflictException('Imported capacity is below Used + Booked')
        }
        const data = { ...source, segmentCode: row.code, cableName: row.cableName!, geometry: geom(row), externalId: row.externalId,
          cableTypeId, startNodeId, endNodeId, installedCoreCount: row.installedCoreCount ?? existing?.installedCoreCount,
          capacityValidated: row.capacityValidated ?? existing?.capacityValidated ?? false,
          installationMethod: row.installationMethod ?? existing?.installationMethod, roadSide: row.roadSide ?? existing?.roadSide }
        const [record] = existing ? await tx.update(networkSegments).set({ ...data, version: existing.version + 1, updatedAt: sql`clock_timestamp()` }).where(eq(networkSegments.id, existing.id)).returning()
          : await tx.insert(networkSegments).values({ ...data, createdBy: userId }).returning()
        if (existing) segments.delete(existing.segmentCode)
        segments.set(record.segmentCode, record.id)
        if (existing && existing.cableName !== record.cableName) await tx.insert(cableNameHistory).values({ segmentId: record.id, oldName: existing.cableName, newName: record.cableName, policyVersion, actorId: userId })
      }
      for (const row of rows.filter((r) => ['POLE','ODC','ODP'].includes(r.kind))) {
        const table = row.kind === 'POLE' ? poles : row.kind === 'ODC' ? odcs : odps
        const links = row.kind === 'POLE' ? segmentPoles : row.kind === 'ODC' ? segmentOdcs : segmentOdps
        const [existing] = await tx.select().from(table).where(and(eq(table.ownerEntityId, preview.entityId), eq(table.sourceSystem, preview.sourceSystem), eq(table.externalId, row.externalId)))
        const data = { ...source, code: row.code, externalId: row.externalId, geometry: geom(row), heightM: row.heightM! }
        const [asset] = existing ? await tx.update(table).set(data).where(eq(table.id, existing.id)).returning() : await tx.insert(table).values({ ...data, createdBy: userId }).returning()
        if (row.segmentCodes !== undefined) {
          await tx.delete(links).where(eq(links.assetId, asset.id))
          for (const code of row.segmentCodes) {
            const segmentId = segments.get(code)
            if (!segmentId) throw new UnprocessableEntityException(`Unknown segment relation at row ${row.rowNumber}`)
            await tx.insert(links).values({ segmentId, assetId: asset.id, ownerEntityId: preview.entityId, datasetId: dataset.id }).onConflictDoNothing()
          }
        }
      }
      const areaIdentities = new Set<string>()
      for (const area of areas) {
        if (areaIdentities.has(area.externalId)) throw new ConflictException(`Duplicate reference-area identity at row ${area.rowNumber}`)
        areaIdentities.add(area.externalId)
        const [existing] = await tx.select().from(referenceAreas).where(and(
          eq(referenceAreas.ownerEntityId, preview.entityId), eq(referenceAreas.sourceSystem, preview.sourceSystem), eq(referenceAreas.externalId, area.externalId),
        ))
        const data = { ...source, externalId: area.externalId, code: area.code, name: area.name, properties: area.properties, geometry: geom(area) }
        if (existing) await tx.update(referenceAreas).set(data).where(eq(referenceAreas.id, existing.id))
        else await tx.insert(referenceAreas).values({ ...data, createdBy: userId })
      }
      for (const feature of referenceRows.filter((row) => row.assetRowValid !== true)) {
        const [existing] = await tx.select().from(referenceFeatures).where(and(
          eq(referenceFeatures.ownerEntityId, preview.entityId), eq(referenceFeatures.sourceSystem, preview.sourceSystem), eq(referenceFeatures.externalId, feature.externalId),
        ))
        const data = { ...source, externalId: feature.externalId, name: feature.name, properties: feature.properties, geometry: geom(feature) }
        if (existing) await tx.update(referenceFeatures).set(data).where(eq(referenceFeatures.id, existing.id))
        else await tx.insert(referenceFeatures).values({ ...data, createdBy: userId })
      }
      if (rows.length) await tx.delete(referenceFeatures).where(and(
        eq(referenceFeatures.ownerEntityId, preview.entityId), eq(referenceFeatures.sourceSystem, preview.sourceSystem),
        inArray(referenceFeatures.externalId, rows.map((row) => `placemark-${row.rowNumber}`)),
      ))
      await tx.update(networkDatasets).set({ version, status: 'PUBLISHED', publishedAt: sql`clock_timestamp()` }).where(eq(networkDatasets.id, dataset.id))
      await tx.update(importPreviews).set({ status: 'PUBLISHED', datasetId: dataset.id, publishedAt: sql`clock_timestamp()` }).where(eq(importPreviews.id, id))
      await tx.insert(auditLogs).values({ entityId: preview.entityId, actorId: userId, action: 'IMPORT_PUBLISHED', resourceId: id, details: { datasetId: dataset.id, version, rows: rows.length, referenceAreas: areas.length, referenceFeatures: referenceRows.length, mode: 'MERGE' } })
      return { data: { id, datasetId: dataset.id, status: 'PUBLISHED' } }
    })
  }
}
