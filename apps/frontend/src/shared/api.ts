import axios, { type AxiosInstance } from 'axios'
import type { AnalysisHistory, AnalysisResult, ApiResponse, AuditRecord, Booking, CableType, CustomerInput, EntityAccess, ImportPreview, ImportPreviewSummary, Job, JobRow, NameHistory, Notification, PolicyChangeRequest, Segment, Setting, UploadPreview, Utilization, WaitingEntry } from './domain-types'
import type { NetworkMapFeature } from '../components/NetworkMapCanvas'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export const API_SERVICE_BASE = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '/api/v1')
export const AUTH_SERVICE_BASE = normalizeBaseUrl(import.meta.env.VITE_AUTH_BASE_URL || '/api/auth')

export const API_ENDPOINTS = {
  currentUser: `${API_SERVICE_BASE}/me`,
  signInEmail: `${AUTH_SERVICE_BASE}/sign-in/email`,
  signOut: `${AUTH_SERVICE_BASE}/sign-out`,
  segments: `${API_SERVICE_BASE}/network/segments`,
  networkMap: `${API_SERVICE_BASE}/network/map`,
  networkSearch: `${API_SERVICE_BASE}/network/search`,
  cableTypes: `${API_SERVICE_BASE}/network/cable-types`,
  bookings: `${API_SERVICE_BASE}/bookings`,
  waitingList: `${API_SERVICE_BASE}/waiting-list`,
  allocations: `${API_SERVICE_BASE}/allocations`,
  analysis: `${API_SERVICE_BASE}/analysis`,
  imports: `${API_SERVICE_BASE}/imports`,
  jobs: `${API_SERVICE_BASE}/jobs`,
  reports: `${API_SERVICE_BASE}/reports`,
  notifications: `${API_SERVICE_BASE}/notifications`,
  settings: `${API_SERVICE_BASE}/settings`,
  policyRequests: `${API_SERVICE_BASE}/settings/requests`,
  entityPresales: `${API_SERVICE_BASE}/entities`,
  audit: `${API_SERVICE_BASE}/audit-logs`,
} as const

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

export interface CurrentUserResponse {
  user: CurrentUser
  entities: string[]
  permissions: string[]
  entityAccess: EntityAccess[]
}

export const currentUserQueryKey = ['auth', 'current-user'] as const

function responseMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const payload = data as Record<string, unknown>
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.error === 'object' && payload.error !== null && 'message' in payload.error) {
    const message = payload.error.message
    if (typeof message === 'string') return message
  }
  return undefined
}

function createHttpClient(): AxiosInstance {
  const client = axios.create({
    headers: { Accept: 'application/json' },
    withCredentials: true,
  })

  client.interceptors.request.use((config) => {
    config.headers.set('Accept', 'application/json')
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 && error.config?.url?.startsWith(API_SERVICE_BASE) && error.config.url !== API_ENDPOINTS.currentUser) window.dispatchEvent(new Event('atlas-session-expired'))
        let data: unknown = error.response?.data
        if (data instanceof Blob) {
          try { data = JSON.parse(await data.text()) } catch { /* Keep the transport error for non-JSON downloads. */ }
        }
        return Promise.reject(new ApiError(
          responseMessage(data) ?? error.message ?? 'API request failed',
          error.response?.status,
        ))
      }
      return Promise.reject(error instanceof Error ? error : new Error('Unexpected API error'))
    },
  )

  return client
}

export const axiosClient = createHttpClient()

async function get<T>(url: string, params?: object, signal?: AbortSignal): Promise<ApiResponse<T>> {
  return (await axiosClient.get<ApiResponse<T>>(url, { params, signal })).data
}
async function post<T>(url: string, body?: unknown, key?: string): Promise<ApiResponse<T>> {
  return (await axiosClient.post<ApiResponse<T>>(url, body, { headers: key ? { 'Idempotency-Key': key } : undefined })).data
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Permintaan gagal.' }
export async function downloadFile(url: string, filename: string) {
  const response = await axiosClient.get<Blob>(url, { responseType: 'blob' })
  const objectUrl = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = objectUrl; link.download = filename; link.click()
  // The browser needs the URL through the download dispatch.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export const atlasApi = {
  network: {
    types: (entityId: string, page: number, signal?: AbortSignal) => get<CableType[]>(API_ENDPOINTS.cableTypes, { entityId, page }, signal),
    createType: (entityId: string, code: string, name: string) => post<CableType>(API_ENDPOINTS.cableTypes, { entityId, code, name }),
    nameHistory: (id: string, page: number, signal?: AbortSignal) => get<NameHistory[]>(`${API_ENDPOINTS.segments}/${encodeURIComponent(id)}/name-history`, { page }, signal),
    segments: (entityId: string, page: number, signal?: AbortSignal) => get<Segment[]>(API_ENDPOINTS.segments, { entityId, page, pageSize: 25, bbox: '-180,-90,180,90' }, signal),
    segment: (id: string, signal?: AbortSignal) => get<Segment>(`${API_ENDPOINTS.segments}/${encodeURIComponent(id)}`, undefined, signal),
    map: (entityId: string, bbox: string, layers: string, page: number, signal?: AbortSignal) => get<{ type: 'FeatureCollection'; features: NetworkMapFeature[] }>(API_ENDPOINTS.networkMap, { entityId, bbox, layers, page, pageSize: 1000 }, signal),
    search: (entityId: string, q: string, signal?: AbortSignal) => get<NetworkMapFeature[]>(API_ENDPOINTS.networkSearch, { entityId, q, limit: 15 }, signal),
    update: async (id: string, version: number, fields: object) => (await axiosClient.patch<ApiResponse<{ id: string; version: number }>>(`${API_ENDPOINTS.segments}/${encodeURIComponent(id)}`, fields, { headers: { 'If-Match': String(version) } })).data,
  },
  capacity: {
    presalesUsers: (entityId: string, signal?: AbortSignal) => get<{ id: string; name: string }[]>(`${API_ENDPOINTS.entityPresales}/${encodeURIComponent(entityId)}/presales`, undefined, signal),
    book: (input: CustomerInput, key: string) => post<Booking>(API_ENDPOINTS.bookings, input, key),
    wait: (input: CustomerInput, key: string) => post<WaitingEntry>(API_ENDPOINTS.waitingList, input, key),
    bookings: (entityId: string, page: number, status: string, signal?: AbortSignal) => get<Booking[]>(API_ENDPOINTS.bookings, { entityId, page, status: status || undefined }, signal),
    waiting: (entityId: string, page: number, status: string, signal?: AbortSignal) => get<WaitingEntry[]>(API_ENDPOINTS.waitingList, { entityId, page, status: status || undefined }, signal),
    release: (id: string, reason: string) => post<Booking>(`${API_ENDPOINTS.bookings}/${encodeURIComponent(id)}/release`, { reason }),
    activate: (id: string, operationalReference: string) => post<{ id: string }>(`${API_ENDPOINTS.bookings}/${encodeURIComponent(id)}/activate`, { operationalReference }),
    deallocate: (id: string, reason: string) => post(`${API_ENDPOINTS.allocations}/${encodeURIComponent(id)}/deallocate`, { reason }),
    allocate: (id: string, key: string) => post<Booking>(`${API_ENDPOINTS.waitingList}/${encodeURIComponent(id)}/allocate`, undefined, key),
    cancelWaiting: (id: string, reason: string) => post(`${API_ENDPOINTS.waitingList}/${encodeURIComponent(id)}/cancel`, { reason }),
  },
  analysis: {
    history: (entityId: string, page: number, signal?: AbortSignal) => get<AnalysisHistory[]>(API_ENDPOINTS.analysis, { entityId, page }, signal),
    run: (input: { entityId: string; address?: string; latitude?: number; longitude?: number; connectionPointId?: string; connectionPointType?: 'ODC' | 'ODP' }) => post<AnalysisResult>(API_ENDPOINTS.analysis, input),
    upload: (entityId: string, file: File) => { const form = new FormData(); form.set('entityId', entityId); form.set('file', file); return post<UploadPreview>(`${API_ENDPOINTS.analysis}/uploads`, form) },
    submit: (uploadId: string) => post<{ id: string }>(`${API_ENDPOINTS.analysis}/jobs`, { uploadId, processValidRows: true }),
  },
  imports: {
    list: (entityId: string, page: number, signal?: AbortSignal) => get<ImportPreviewSummary[]>(API_ENDPOINTS.imports, { entityId, page }, signal),
    get: (id: string, signal?: AbortSignal) => get<ImportPreview>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}`, undefined, signal),
    geocodeRow: (id: string, rowNumber: number) => post<ImportPreview>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}/rows/${rowNumber}/geocode`),
    confirmCoordinates: (id: string, rowNumber: number, lookupId: string, candidateIndex: number) => post<ImportPreview>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}/rows/${rowNumber}/confirm-coordinates`, { lookupId, candidateIndex }),
    confirmClassification: (id: string, rowNumber: number, input: { kind: 'SEGMENT' | 'NODE' | 'POLE' | 'ODC' | 'ODP' | 'POP'; code: string; cableName?: string; cableTypeCode?: string; installedCoreCount?: number; capacityValidated?: boolean; installationMethod?: 'BURIAL' | 'AERIAL'; roadSide?: 'LEFT' | 'RIGHT'; startNodeCode?: string; endNodeCode?: string; heightM?: 7 | 9; segmentCodes?: string[] }) => post<ImportPreview>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}/rows/${rowNumber}/confirm-classification`, input),
    preview: (entityId: string, sourceSystem: string, file: File, mappings: string) => { const form = new FormData(); form.set('entityId', entityId); form.set('sourceSystem', sourceSystem); form.set('file', file); if (mappings.trim()) form.set('mappings', mappings); return post<ImportPreview>(API_ENDPOINTS.imports, form) },
    publish: (id: string) => post<{ id: string; datasetId: string; status: string }>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}/publish`),
    publishAreas: (id: string) => post<ImportPreview>(`${API_ENDPOINTS.imports}/${encodeURIComponent(id)}/publish-areas`),
  },
  jobs: {
    get: (id: string, signal?: AbortSignal) => get<Job>(`${API_ENDPOINTS.jobs}/${encodeURIComponent(id)}`, undefined, signal),
    rows: (id: string, page: number, signal?: AbortSignal) => get<JobRow[]>(`${API_ENDPOINTS.jobs}/${encodeURIComponent(id)}/rows`, { page }, signal),
    cancel: (id: string) => post(`${API_ENDPOINTS.jobs}/${encodeURIComponent(id)}/cancel`),
    retry: (id: string) => post<{ id: string }>(`${API_ENDPOINTS.jobs}/${encodeURIComponent(id)}/retry`),
  },
  reports: {
    utilization: (entityId: string, page: number, signal?: AbortSignal) => get<Utilization[]>(`${API_ENDPOINTS.reports}/utilization`, { entityId, page }, signal),
    export: (entityId: string) => post<{ id: string; asOf: string }>(`${API_ENDPOINTS.reports}/exports`, { entityId }),
  },
  notifications: {
    list: (entityId: string, page: number, signal?: AbortSignal) => get<Notification[]>(API_ENDPOINTS.notifications, { entityId, page }, signal),
    unreadCount: (entityId: string, signal?: AbortSignal) => get<number>(`${API_ENDPOINTS.notifications}/unread-count`, { entityId }, signal),
    read: (id: string) => post<Notification>(`${API_ENDPOINTS.notifications}/${encodeURIComponent(id)}/read`),
  },
  settings: {
    get: <T,>(entityId: string, key: string, signal?: AbortSignal) => get<Setting<T>>(`${API_ENDPOINTS.settings}/${key}`, { entityId }, signal),
    propose: async <T,>(entityId: string, key: string, version: number, value: T, reason: string, submissionKey: string) => (await axiosClient.post<ApiResponse<PolicyChangeRequest>>(`${API_ENDPOINTS.settings}/${key}/requests`, { value, reason }, { params: { entityId }, headers: { 'If-Match': String(version), 'Idempotency-Key': submissionKey } })).data,
    requests: (entityId: string, page: number, status: string, signal?: AbortSignal) => get<PolicyChangeRequest[]>(API_ENDPOINTS.policyRequests, { entityId, page, status: status || undefined }, signal),
    decide: (id: string, action: 'approve' | 'reject' | 'cancel', reason: string) => post<PolicyChangeRequest>(`${API_ENDPOINTS.policyRequests}/${encodeURIComponent(id)}/${action}`, { reason }),
  },
  audit: (entityId: string, page: number, filters: { search?: string; action?: string; from?: string; to?: string }, signal?: AbortSignal) => get<AuditRecord[]>(API_ENDPOINTS.audit, { entityId, page, ...filters }, signal),
  auth: {
    async signIn(email: string, password: string): Promise<void> {
      await axiosClient.post(API_ENDPOINTS.signInEmail, { email, password, callbackURL: '/' })
    },
    async signOut(): Promise<void> {
      await axiosClient.post(API_ENDPOINTS.signOut)
    },
    async currentUser(signal?: AbortSignal): Promise<CurrentUserResponse> {
      const response = await axiosClient.get<{ data: CurrentUserResponse }>(API_ENDPOINTS.currentUser, { signal })
      return response.data.data
    },
  },
}
