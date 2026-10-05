import { Injectable, NotFoundException } from '@nestjs/common'
import { AccessService } from '../access/access.service.js'
import { NetworkRepository, type SegmentRecord } from './network.repository.js'
import type { MapQuery, NetworkSearchQuery, SegmentsQuery } from './network.dto.js'

function segmentCompleteness(segment: SegmentRecord) {
  const missingFields: string[] = []
  if (!segment.cableType) missingFields.push('cableType')
  if (segment.installedCoreCount === null || !segment.capacityValidated) missingFields.push('validatedCapacity')
  if (!segment.installationMethod) missingFields.push('installationMethod')
  if (!segment.startNodeId || !segment.endNodeId) missingFields.push('topology')
  if (!segment.roadSide) missingFields.push('roadSide')
  if (segment.installationMethod === 'AERIAL' && segment.assetCounts.poles === 0) missingFields.push('poleRelations')
  return { ...segment, completeness: { status: missingFields.length ? 'INCOMPLETE' : 'COMPLETE', missingFields } }
}

@Injectable()
export class NetworkService {
  constructor(private readonly repository: NetworkRepository, private readonly access: AccessService) {}

  async listSegments(userId: string, query: SegmentsQuery) {
    await this.access.requireEntityPermission(userId, query.entityId, 'network.read')
    const { data, total } = await this.repository.listSegments(query)
    return { data: data.map(segmentCompleteness), meta: { page: query.page, pageSize: query.pageSize, total, geometryClipped: true } }
  }

  async getSegment(userId: string, id: string) {
    const allowed = (await this.access.getUserAccess(userId)).filter((entity) => entity.permissions.includes('network.read')).map((entity) => entity.id)
    if (!allowed.length) throw new NotFoundException('Segment not found')
    const segment = await this.repository.findSegment(id, allowed)
    if (!segment) throw new NotFoundException('Segment not found')
    return { data: segmentCompleteness(segment) }
  }

  async getMap(userId: string, query: MapQuery) {
    await this.access.requireEntityPermission(userId, query.entityId, 'network.read')
    const { features, total } = await this.repository.mapFeatures(query)
    return {
      data: { type: 'FeatureCollection', features },
      meta: { page: query.page, pageSize: query.pageSize, total, geometryClipped: true, layers: query.layers },
    }
  }

  async search(userId: string, query: NetworkSearchQuery) {
    await this.access.requireEntityPermission(userId, query.entityId, 'network.read')
    const { data, total } = await this.repository.search(query)
    return { data, meta: { page: 1, pageSize: query.limit, total } }
  }
}
