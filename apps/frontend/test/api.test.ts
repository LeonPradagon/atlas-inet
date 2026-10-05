import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosAdapter } from 'axios'
import { API_ENDPOINTS, ApiError, atlasApi, axiosClient } from '../src/shared/api'

const original = axiosClient.defaults.adapter
afterEach(() => { axiosClient.defaults.adapter = original; vi.restoreAllMocks() })
describe('central API contracts', () => {
  it('sends scope, paging, abort signal and version headers', async () => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ config, data: { data: [] }, status: 200, statusText: 'OK', headers: {} }))
    axiosClient.defaults.adapter = adapter
    const signal = new AbortController().signal
    await atlasApi.network.map('alpha', '1,2,3,4', 'odc,odp', 2, signal)
    expect(adapter.mock.calls[0][0]).toMatchObject({ url: API_ENDPOINTS.networkMap, params: { entityId: 'alpha', bbox: '1,2,3,4', layers: 'odc,odp', page: 2, pageSize: 100 }, signal, withCredentials: true })
    await atlasApi.settings.propose('alpha', 'booking-policy', 9, { duration: 1, unit: 'MONTH' }, 'Fixture reason', 'approval-key')
    expect(adapter.mock.calls[1][0].headers.get('If-Match')).toBe('9')
    expect(adapter.mock.calls[1][0].headers.get('Idempotency-Key')).toBe('approval-key')
    expect(adapter.mock.calls[1][0].method).toBe('post')
    expect(adapter.mock.calls[1][0].url).toBe(`${API_ENDPOINTS.settings}/booking-policy/requests`)
    await atlasApi.capacity.book({ segmentId: 's' } as never, 'stable-key')
    expect(adapter.mock.calls[2][0].headers.get('Idempotency-Key')).toBe('stable-key')
    await atlasApi.notifications.unreadCount('alpha', signal)
    expect(adapter.mock.calls[3][0]).toMatchObject({ url: `${API_ENDPOINTS.notifications}/unread-count`, params: { entityId: 'alpha' }, signal })
  })
  it('searches the entity-wide network with scoped query and cancellation', async () => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ config, data: { data: [], meta: { total: 0 } }, status: 200, statusText: 'OK', headers: {} }))
    axiosClient.defaults.adapter = adapter
    const signal = new AbortController().signal
    await atlasApi.network.search('alpha', 'ODP-12', signal)
    expect(adapter.mock.calls[0][0]).toMatchObject({ url: API_ENDPOINTS.networkSearch, params: { entityId: 'alpha', q: 'ODP-12', limit: 15 }, signal, withCredentials: true })
  })
  it('multipart upload preserves file and approval is explicit', async () => {
    const adapter = vi.fn<AxiosAdapter>(async (config) => ({ config, data: { data: { id: 'real' } }, status: 201, statusText: 'Created', headers: {} }))
    axiosClient.defaults.adapter = adapter
    const file = new File(['kml'], 'network.kml')
    await atlasApi.imports.preview('alpha', 'source', file, '{"1":{"kind":"ODP"}}')
    const form = adapter.mock.calls[0][0].data as FormData
    expect(form.get('entityId')).toBe('alpha')
    expect(form.get('sourceSystem')).toBe('source')
    expect(form.get('file')).toBe(file)
    await atlasApi.analysis.submit('upload-real')
    expect(JSON.parse(adapter.mock.calls[1][0].data)).toEqual({ uploadId: 'upload-real', processValidRows: true })
  })
  it('normalizes backend errors and dispatches session expiry only for private 401', async () => {
    const event = vi.fn()
    window.addEventListener('atlas-session-expired', event)
    axiosClient.defaults.adapter = async (config) => { throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, { config, data: { error: { message: 'Session required' } }, status: 401, statusText: 'Unauthorized', headers: {} }) }
    try {
      await expect(atlasApi.notifications.list('alpha', 1)).rejects.toEqual(new ApiError('Session required', 401))
      expect(event).toHaveBeenCalledTimes(1)
      await expect(atlasApi.auth.currentUser()).rejects.toThrow('Session required')
      expect(event).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('atlas-session-expired', event) }
  })
})
