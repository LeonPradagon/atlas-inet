import type { Geometry } from 'geojson'
export interface EntityAccess { id: string; code: string; name: string; roles: string[]; permissions: string[] }
export interface UtilizationSummary { segmentCount: number; unknownCapacityCount: number; total: number | null; used: number; booked: number; idle: number | null; available: number | null; waitingCount: number; waitingCores: number }
export interface PageMeta { page: number; pageSize: number; total: number; asOf?: string; summary?: UtilizationSummary }
export interface ApiResponse<T> { data: T; meta?: PageMeta }
export interface Capacity { total: number | null; used: number; booked: number; idle: number | null; available: number | null; waitingCount: number; waitingCores: number; asOf: string; expiryPendingCount?: number }
export interface Segment {
  id: string; ownerEntityId: string; segmentCode: string; cableName: string; datasetVersion: string; version: number;
  installedCoreCount: number | null; capacityValidated: boolean; installationMethod: string | null; roadSide: string | null; status: string;
  cableType: { id: string; code: string; name: string } | null; geometry: Geometry; capacity: Capacity;
  completeness: { status: string; missingFields: string[] };
  assets?: { poles: { id: string; code: string; heightM: number }[]; odcs: { id: string; code: string }[]; odps: { id: string; code: string }[] }
}
export interface CustomerInput { segmentId: string; customerName: string; customerReference?: string; customerPicName: string; customerPicContact: string; presalesUserId: string; coreCount: number; reason: string }
export interface Booking extends CustomerInput { id: string; entityId: string; status: string; expiresAt: string; createdAt: string; closedReason: string | null }
export interface WaitingEntry extends CustomerInput { id: string; status: string; bookingId: string | null; createdAt: string }
export interface AnalysisResult {
  status: string; coordinates?: { latitude: number; longitude: number }; candidates?: { latitude: number; longitude: number; label: string; precision?: string }[];
  attribution?: string; geocodingProvider?: string; geocodingDatasetVersion?: string | null; provider?: string; datasetVersion?: string | null;
  nearest?: { segmentId: string; cableName: string; datasetVersion: string; referencePoint: Geometry; capacity: Pick<Capacity, 'total' | 'used' | 'booked' | 'asOf'> } | null;
  nearestNetworkDistanceM?: number | null; estimatedCableLengthM?: number | null; estimationMethod?: string; analysisTime?: string; routeStatus?: string;
  route?: { distanceM: number; shortestFeasibleDistanceM: number; geometry: Geometry } | null; needsSurvey: boolean;
}
export interface UploadPreview { id: string; preview: { rowNumber: number; referenceId: string; error: string | null }[] }
export interface ImportPreview {
  id: string; rows: { rowNumber: number; kind: string; code: string; geometry?: Geometry; address?: string; geocoding?: { provider: string; datasetVersion: string | null; confirmedAt: string } }[];
  errors: { rowNumber: number; message: string; code?: string; sourceRow?: { kind: string; code: string; address: string }; lookupId?: string; candidates?: { latitude: number; longitude: number; label: string; precision?: string }[] }[];
  status: string; datasetId: string | null;
}
export interface Job { id: string; entityId: string; type: string; status: string; total: number; completed: number; succeeded: number; failed: number; error: string | null; cancelRequestedAt: string | null }
export interface JobRow { id: string; rowNumber: number; referenceId: string; error: string | null; result: { status?: string } | null }
export interface Utilization { segmentId: string; segmentCode: string; cableName: string; total: number | null; used: number; booked: number; idle: number | null; available: number | null; waitingCount: number; waitingCores: number }
export interface Notification { id: string; type: string; payload: { segmentId?: string; resourceId?: string; coreCount?: number; reason?: string; key?: string; status?: string }; readAt: string | null; createdAt: string }
export interface AuditRecord { id: string; actor: string; action: string; resource: string; details: unknown; created_at: string }
export interface CableType { id: string; code: string; name: string }
export interface NameHistory { id: string; oldName: string; newName: string; policyVersion: number; actorId: string; createdAt: string }
export interface AnalysisHistory { id: string; input: { address?: string; latitude?: number; longitude?: number }; result: AnalysisResult; createdAt: string }
export interface Setting<T> { key: string; version: number; value: T }
export interface BookingPolicy { duration: number; unit: 'DAY' | 'MONTH' }
export interface NamingPolicy { approved: boolean; pattern: string | null; uniquePerEntity: true }
export interface AnalysisPolicy { radiusM: number; formulaApproved: boolean; slackPercent: number | null; extraLengthM: number | null; maxDetourPercent: number | null }
export interface PolicyChangeRequest {
  id: string; entityId: string; key: string; baseVersion: number; baseValue?: Record<string, unknown> | null;
  proposedValue: Record<string, unknown>; reason: string; requestedBy: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; approvedVersion: number | null;
  decidedBy: string | null; decisionReason: string | null; createdAt: string; decidedAt: string | null;
}
