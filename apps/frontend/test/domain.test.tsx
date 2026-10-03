import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PolicyChangeRequest } from '../src/shared/domain-types'
import { ApiError, atlasApi, currentUserQueryKey, type CurrentUserResponse } from '../src/shared/api'
import { domainKey, EntityScopeProvider, resolveEntity, useEntityScope } from '../src/shared/EntityScope'
import { ReservationWorkspace } from '../src/components/ReservationWorkspace'
import { DashboardPage } from '../src/pages/DashboardPage'
import { NotificationsPage } from '../src/pages/NotificationsPage'
import { AnalysisPage } from '../src/pages/AnalysisPage'
import { JobPanel } from '../src/components/JobPanel'
import { SettingsPage } from '../src/pages/SettingsPage'
import { AssetsPage } from '../src/pages/AssetsPage'
import { NetworkMapPage } from '../src/pages/NetworkMapPage'
import { ReportsPage } from '../src/pages/ReportsPage'

vi.mock('../src/components/NetworkMapCanvas', () => ({ NetworkMapCanvas: ({ onViewportChange, features }: { onViewportChange?: (bbox: string) => void; features: unknown[] }) => <div>Map: {features.length} features {onViewportChange && <button onClick={() => onViewportChange('106,-7,107,-6')}>Report viewport</button>}</div> }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: ReactNode }) => <span>{children}</span> }))

const alpha = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const beta = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const segment = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
function session(permissions: string[], betaPermissions: string[] = []): CurrentUserResponse {
  return { user: { id: 'alice', name: 'Admin', email: 'alice@example.test', emailVerified: true }, entities: [alpha, beta], permissions: ['*', ...permissions, ...betaPermissions], entityAccess: [
    { id: alpha, code: 'ALPHA', name: 'Alpha', roles: ['Admin'], permissions },
    { id: beta, code: 'BETA', name: 'Beta', roles: ['Admin'], permissions: betaPermissions },
  ] }
}
function mockActivePolicies() {
  return vi.spyOn(atlasApi.settings, 'get').mockImplementation(async (_entity, key) => ({ data: { key, version: 7, value: key === 'booking-policy' ? { duration: 1, unit: 'MONTH' } : key === 'naming-policy' ? { approved: false, pattern: null, uniquePerEntity: true } : { radiusM: 5000, formulaApproved: false, slackPercent: null, extraLengthM: null, maxDetourPercent: null } } }) as never)
}
const pendingPolicy: PolicyChangeRequest = {
  id: 'policy-request-real', entityId: alpha, key: 'booking-policy', baseVersion: 7,
  baseValue: { duration: 1, unit: 'MONTH' }, proposedValue: { duration: 2, unit: 'MONTH' },
  reason: 'Fixture change', requestedBy: 'alice', status: 'PENDING', approvedVersion: null,
  decidedBy: null, decisionReason: null, createdAt: '2026-10-03T00:00:00Z', decidedAt: null,
}
function ScopeHarness({ children }: { children: ReactNode }) {
  const { entity, user, select, can } = useEntityScope()
  return <><p data-testid="scope">{entity?.code ?? 'NONE'} / {can('bookings.create') ? 'CAN_BOOK' : 'NO_BOOK'}</p><button onClick={() => select(beta)}>Select beta</button><div key={`${user?.id}:${entity?.id}:${entity?.permissions.join(',')}`}>{children}</div></>
}
function mount(children: ReactNode, permissions: string[], betaPermissions: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(currentUserQueryKey, session(permissions, betaPermissions))
  render(<QueryClientProvider client={client}><EntityScopeProvider><ScopeHarness>{children}</ScopeHarness></EntityScopeProvider></QueryClientProvider>)
  return client
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('entity and session isolation', () => {
  it('uses per-entity grants, never Admin, union or wildcard', async () => {
    mount(<ReservationWorkspace />, [], ['bookings.create'])
    expect(screen.getByTestId('scope').textContent).toContain('NO_BOOK')
    expect(screen.queryByRole('button', { name: 'Booking core' })).toBeNull()
    await userEvent.click(screen.getByText('Select beta'))
    expect(screen.getByTestId('scope').textContent).toContain('CAN_BOOK')
    expect(screen.getByRole('button', { name: 'Booking core' })).toBeTruthy()
  })
  it('resolves revoked selection and separates user/entity cache keys', () => {
    const entities = session([]).entityAccess
    expect(resolveEntity(entities.slice(0, 1), beta)?.id).toBe(alpha)
    expect(resolveEntity([], alpha)).toBeUndefined()
    expect(domainKey(alpha, 'alice', 'notifications')).not.toEqual(domainKey(alpha, 'bob', 'notifications'))
    expect(domainKey(alpha, 'alice')).not.toEqual(domainKey(beta, 'alice'))
  })
  it('resets forms and requests the new entity when selection changes', async () => {
    const list = vi.spyOn(atlasApi.capacity, 'bookings').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } })
    mount(<ReservationWorkspace />, ['bookings.create', 'bookings.read'], ['bookings.create', 'bookings.read'])
    await userEvent.type(screen.getByLabelText('Nama customer'), 'Private Alpha')
    await userEvent.click(screen.getByText('Select beta'))
    expect((screen.getByLabelText('Nama customer') as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(list).toHaveBeenCalledWith(beta, 1, '', expect.any(AbortSignal)))
  })
  it('401 clears domain cache and disables grants before session recheck completes', async () => {
    const auth = vi.spyOn(atlasApi.auth, 'currentUser').mockImplementation(() => new Promise(() => {}))
    const client = mount(<ReservationWorkspace />, ['bookings.create'])
    client.setQueryData(domainKey(alpha, 'alice', 'private'), { secret: 'private' })
    act(() => window.dispatchEvent(new Event('atlas-session-expired')))
    await waitFor(() => expect(screen.getByTestId('scope').textContent).toContain('NONE / NO_BOOK'))
    expect(client.getQueryData(domainKey(alpha, 'alice', 'private'))).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Booking core' })).toBeNull()
    expect(auth).toHaveBeenCalled()
  })
})

describe('operational API interactions', () => {
  it('booking errors never show success; unchanged retry retains idempotency key', async () => {
    const book = vi.spyOn(atlasApi.capacity, 'book').mockRejectedValueOnce(new ApiError('Capacity conflict', 409)).mockResolvedValue({ data: { id: 'booking-real' } } as never)
    mount(<ReservationWorkspace />, ['bookings.create'])
    fireEvent.change(screen.getByLabelText('ID segmen jaringan'), { target: { value: segment } })
    for (const label of ['Nama customer', 'PIC customer', 'Kontak PIC customer', 'Kebutuhan / alasan']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'Fixture only' } })
    fireEvent.change(screen.getByLabelText('Kebutuhan core'), { target: { value: '2' } })
    await userEvent.click(screen.getByRole('button', { name: 'Booking core' }))
    expect(await screen.findByText('Capacity conflict')).toBeTruthy()
    expect(screen.queryByText('Permintaan berhasil diproses oleh server.')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Booking core' }))
    expect(await screen.findByText('booking-real')).toBeTruthy()
    expect(book.mock.calls[0][1]).toBe(book.mock.calls[1][1])
    expect(book.mock.calls[0][0]).toMatchObject({ segmentId: segment, coreCount: 2, presalesUserId: 'alice' })
  })
  it('uses server-wide dashboard summary and preserves unknown capacity', async () => {
    vi.spyOn(atlasApi.reports, 'utilization').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 51, asOf: '2026-10-03T00:00:00Z', summary: { segmentCount: 51, unknownCapacityCount: 1, total: null, used: 5, booked: 3, idle: null, available: null, waitingCount: 0, waitingCores: 0 } } })
    mount(<DashboardPage />, ['reports.read'])
    expect(await screen.findByText('51')).toBeTruthy()
    expect(screen.getAllByText('Belum diketahui')).toHaveLength(2)
    expect(screen.getByText(/1 segmen belum memiliki kapasitas/)).toBeTruthy()
  })
  it('marks notification read through API, not local fake state', async () => {
    vi.spyOn(atlasApi.notifications, 'list').mockResolvedValue({ data: [{ id: 'notification', type: 'BOOKING_EXPIRED', payload: { coreCount: 2 }, readAt: null, createdAt: '2026-10-03T00:00:00Z' }] })
    const read = vi.spyOn(atlasApi.notifications, 'read').mockRejectedValue(new ApiError('Permission revoked', 403))
    mount(<NotificationsPage />, ['notifications.read'])
    await userEvent.click(await screen.findByRole('button', { name: 'Tandai dibaca' }))
    expect(await screen.findByText('Permission revoked')).toBeTruthy()
    expect(read).toHaveBeenCalledWith('notification')
    expect(screen.getByRole('button', { name: 'Tandai dibaca' })).toBeTruthy()
  })
  it('dependency-unconfigured analysis remains honest, without route length', async () => {
    const run = vi.spyOn(atlasApi.analysis, 'run').mockResolvedValue({ data: { status: 'GEOCODING_NOT_CONFIGURED', needsSurvey: true } })
    mount(<AnalysisPage />, ['analysis.create'])
    await userEvent.selectOptions(screen.getByLabelText('Sumber lokasi'), 'address')
    await userEvent.type(screen.getByLabelText('Alamat lengkap'), 'Fixture address')
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan analisis' }))
    expect(await screen.findByText('Status: GEOCODING_NOT_CONFIGURED')).toBeTruthy()
    expect(screen.getByText('Estimasi kabel: Belum diketahui m')).toBeTruthy()
    expect(run).toHaveBeenCalledWith({ entityId: alpha, address: 'Fixture address' })
  })
  it('bulk starts only after explicit approval of persisted upload', async () => {
    vi.spyOn(atlasApi.analysis, 'upload').mockResolvedValue({ data: { id: 'upload-real', preview: [{ rowNumber: 2, referenceId: 'REF', error: null }] } })
    const submit = vi.spyOn(atlasApi.analysis, 'submit').mockResolvedValue({ data: { id: 'job-real' } })
    vi.spyOn(atlasApi.jobs, 'get').mockResolvedValue({ data: { id: 'job-real', entityId: alpha, type: 'ANALYSIS', status: 'COMPLETED', total: 1, completed: 1, succeeded: 1, failed: 0, error: null, cancelRequestedAt: null } })
    vi.spyOn(atlasApi.jobs, 'rows').mockResolvedValue({ data: [] })
    mount(<AnalysisPage />, ['analysis.create', 'analysis.bulk'])
    await userEvent.upload(screen.getByLabelText(/File .xlsx/), new File(['test'], 'fixture.xlsx'))
    // jsdom's file-input constraint validation does not recognize user-event's FileList.
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('REF')
    expect(submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Setujui proses baris valid' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith('upload-real'))
    expect(await screen.findByText('job-real')).toBeTruthy()
  })
  it('import stays in staging until publish confirmation', async () => {
    vi.spyOn(atlasApi.imports, 'preview').mockResolvedValue({ data: { id: 'preview-real', rows: [{ rowNumber: 1, kind: 'SEGMENT', code: 'REF' }], errors: [], status: 'PREVIEW', datasetId: null } })
    const publish = vi.spyOn(atlasApi.imports, 'publish').mockRejectedValue(new ApiError('Naming policy unapproved', 422))
    mount(<AssetsPage />, ['imports.write'])
    await userEvent.type(screen.getByLabelText('Identitas source system'), 'fixture')
    await userEvent.upload(screen.getByLabelText(/File KML/), new File(['test'], 'fixture.kml'))
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('preview-real')
    expect(publish).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Version dataset baru yang disetujui'), 'v1')
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi publish dataset' }))
    expect(await screen.findByText('Naming policy unapproved')).toBeTruthy()
    expect(publish).toHaveBeenCalledWith('preview-real', 'v1')
  })
  it('address-only asset lookup stays unresolved until explicit coordinate confirmation; failures block publish', async () => {
    const initial = { id: 'address-preview', status: 'PREVIEW', datasetId: null, rows: [], errors: [{ rowNumber: 2, code: 'ADDRESS_NEEDS_GEOCODING', message: 'Coordinates required', sourceRow: { kind: 'ODP', code: 'TEST-ODP', address: 'Synthetic address' } }] }
    const lookedUp = { ...initial, errors: [{ ...initial.errors[0], lookupId: 'lookup-real', candidates: [{ latitude: -6.2, longitude: 106.8, label: 'Synthetic candidate', precision: 'street' }] }] }
    vi.spyOn(atlasApi.imports, 'preview').mockResolvedValue({ data: initial })
    const geocode = vi.spyOn(atlasApi.imports, 'geocodeRow').mockResolvedValue({ data: lookedUp })
    const confirm = vi.spyOn(atlasApi.imports, 'confirmCoordinates').mockRejectedValueOnce(new ApiError('Candidates changed', 409)).mockResolvedValue({ data: { ...initial, errors: [], rows: [{ rowNumber: 2, kind: 'ODP', code: 'TEST-ODP', geometry: { type: 'Point', coordinates: [106.8, -6.2] } }] } })
    const publish = vi.spyOn(atlasApi.imports, 'publish').mockResolvedValue({ data: { id: 'address-preview', status: 'PUBLISHED', datasetId: 'dataset-real' } })
    mount(<AssetsPage />, ['imports.write'])
    await userEvent.type(screen.getByLabelText('Identitas source system'), 'fixture')
    await userEvent.upload(screen.getByLabelText(/File KML/), new File(['test'], 'fixture.xlsx'))
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('Coordinates required', { exact: false })
    const publishButton = screen.getByRole('button', { name: 'Konfirmasi publish dataset' }) as HTMLButtonElement
    expect(publishButton.disabled).toBe(true)
    expect(geocode).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cari koordinat baris 2' }))
    await screen.findByText(/Synthetic candidate/)
    expect(geocode).toHaveBeenCalledWith('address-preview', 2)
    expect(publishButton.disabled).toBe(true); expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi kandidat 1 baris 2' }))
    expect(await screen.findByText('Candidates changed')).toBeTruthy()
    expect(publishButton.disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi kandidat 1 baris 2' }))
    await waitFor(() => expect(publishButton.disabled).toBe(false))
    expect(confirm).toHaveBeenCalledWith('address-preview', 2, 'lookup-real', 0)
    expect(publish).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Version dataset baru yang disetujui'), 'v1')
    await userEvent.click(publishButton)
    await waitFor(() => expect(publish).toHaveBeenCalledWith('address-preview', 'v1'))
  })
  it('ambiguous analysis uses only the explicitly selected candidate coordinates', async () => {
    const run = vi.spyOn(atlasApi.analysis, 'run').mockResolvedValueOnce({ data: { status: 'AMBIGUOUS_ADDRESS', provider: 'PHOTON_INTERNAL', datasetVersion: 'synthetic-v1', candidates: [{ latitude: -6.2, longitude: 106.8, label: 'Synthetic candidate', precision: 'street' }], needsSurvey: true } }).mockResolvedValue({ data: { status: 'NO_NETWORK_IN_RADIUS', coordinates: { latitude: -6.2, longitude: 106.8 }, estimatedCableLengthM: null, needsSurvey: true } })
    mount(<AnalysisPage />, ['analysis.create'])
    await userEvent.selectOptions(screen.getByLabelText('Sumber lokasi'), 'address')
    await userEvent.type(screen.getByLabelText('Alamat lengkap'), 'Synthetic address')
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan analisis' }))
    await screen.findByText('Status: AMBIGUOUS_ADDRESS')
    expect(run).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /Synthetic candidate.*konfirmasi koordinat/ }))
    await screen.findByText('Status: NO_NETWORK_IN_RADIUS')
    expect(run).toHaveBeenLastCalledWith({ entityId: alpha, address: 'Synthetic address', latitude: -6.2, longitude: 106.8 })
    expect(screen.getByText('Estimasi kabel: Belum diketahui m')).toBeTruthy()
  })
  it('policy proposal uses the loaded version, conflict does not claim activated', async () => {
    vi.spyOn(atlasApi.settings, 'get').mockImplementation(async (_entity, key) => ({ data: { key, version: 7, value: key === 'booking-policy' ? { duration: 1, unit: 'MONTH' } : key === 'naming-policy' ? { approved: false, pattern: null, uniquePerEntity: true } : { radiusM: 5000, formulaApproved: false, slackPercent: null, extraLengthM: null, maxDetourPercent: null } } }) as never)
    vi.spyOn(atlasApi.settings, 'requests').mockResolvedValue({ data: [] })
    const propose = vi.spyOn(atlasApi.settings, 'propose').mockRejectedValue(new ApiError('Stale version', 409))
    mount(<SettingsPage />, ['settings.read', 'settings.write'])
    await screen.findByLabelText('Lama berlaku')
    fireEvent.change(screen.getByLabelText('Lama berlaku'), { target: { value: '2' } })
    await userEvent.type(screen.getAllByLabelText('Alasan perubahan kebijakan')[0], 'Fixture change')
    await userEvent.click(screen.getAllByRole('button', { name: 'Ajukan perubahan untuk approval' })[0])
    expect(await screen.findByText('Stale version')).toBeTruthy()
    expect(propose).toHaveBeenCalledWith(alpha, 'booking-policy', 7, { duration: 2, unit: 'MONTH' }, 'Fixture change', expect.any(String))
    expect(screen.queryByText('Permintaan berhasil diproses oleh server.')).toBeNull()
  })
  it('submission remains pending, keeps active version and reuses unchanged retry key', async () => {
    mockActivePolicies()
    vi.spyOn(atlasApi.settings, 'requests').mockResolvedValue({ data: [] })
    const propose = vi.spyOn(atlasApi.settings, 'propose').mockRejectedValueOnce(new ApiError('Connection interrupted')).mockResolvedValue({ data: pendingPolicy })
    mount(<SettingsPage />, ['settings.read', 'settings.write'])
    await screen.findByLabelText('Lama berlaku')
    fireEvent.change(screen.getByLabelText('Lama berlaku'), { target: { value: '2' } })
    await userEvent.type(screen.getAllByLabelText('Alasan perubahan kebijakan')[0], 'Fixture change')
    await userEvent.click(screen.getAllByRole('button', { name: 'Ajukan perubahan untuk approval' })[0])
    await screen.findByText('Connection interrupted')
    await userEvent.click(screen.getAllByRole('button', { name: 'Ajukan perubahan untuk approval' })[0])
    expect(await screen.findByText(/policy-request-real: PENDING/)).toBeTruthy()
    expect(screen.getAllByText(/Kebijakan aktif: versi 7/)).toHaveLength(3)
    expect(propose.mock.calls[0][5]).toBe(propose.mock.calls[1][5])
    expect(screen.queryByText('Permintaan berhasil diproses oleh server.')).toBeNull()
  })
  it('administrator permissions never show self-approval; owner can withdraw', async () => {
    mockActivePolicies()
    vi.spyOn(atlasApi.settings, 'requests').mockResolvedValue({ data: [pendingPolicy] })
    const decide = vi.spyOn(atlasApi.settings, 'decide').mockResolvedValue({ data: { ...pendingPolicy, status: 'CANCELLED' } })
    mount(<SettingsPage />, ['settings.read', 'settings.write', 'settings.approve-operational', 'settings.approve-engineering'])
    expect(await screen.findByText('Tidak dapat menyetujui pengajuan sendiri.')).toBeTruthy()
    expect(screen.queryByText('Setujui dan aktifkan')).toBeNull()
    await userEvent.click(screen.getByText('Batalkan pengajuan'))
    await userEvent.type(screen.getByLabelText('Alasan: Batalkan pengajuan'), 'Withdraw fixture')
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi batalkan pengajuan' }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith(pendingPolicy.id, 'cancel', 'Withdraw fixture'))
  })
  it.each(['approve', 'reject'] as const)('authorized independent reviewer can %s with a mandatory decision reason', async (action) => {
    mockActivePolicies()
    vi.spyOn(atlasApi.settings, 'requests').mockResolvedValue({ data: [{ ...pendingPolicy, requestedBy: 'maker' }] })
    const decide = vi.spyOn(atlasApi.settings, 'decide').mockResolvedValue({ data: { ...pendingPolicy, status: action === 'approve' ? 'APPROVED' : 'REJECTED' } })
    mount(<SettingsPage />, ['settings.read', 'settings.approve-operational'])
    const label = action === 'approve' ? 'Setujui dan aktifkan' : 'Tolak pengajuan'
    await userEvent.click(await screen.findByText(label))
    await userEvent.click(screen.getByRole('button', { name: `Konfirmasi ${label.toLowerCase()}` }))
    expect(decide).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(`Alasan: ${label}`), 'Independent review')
    await userEvent.click(screen.getByRole('button', { name: `Konfirmasi ${label.toLowerCase()}` }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith(pendingPolicy.id, action, 'Independent review'))
  })
  it('operational reviewer cannot decide an engineering request', async () => {
    mockActivePolicies()
    vi.spyOn(atlasApi.settings, 'requests').mockResolvedValue({ data: [{ ...pendingPolicy, key: 'analysis-policy', requestedBy: 'maker' }] })
    mount(<SettingsPage />, ['settings.read', 'settings.approve-operational'])
    expect(await screen.findByText('Menunggu pemeriksa berizin sesuai jenis kebijakan.')).toBeTruthy()
    expect(screen.queryByText('Setujui dan aktifkan')).toBeNull()
    expect(screen.queryByText('Tolak pengajuan')).toBeNull()
  })
  it('job from a different entity does not expose counters or download', async () => {
    vi.spyOn(atlasApi.jobs, 'get').mockResolvedValue({ data: { id: 'foreign', entityId: beta, type: 'ANALYSIS', status: 'COMPLETED', total: 1234, completed: 1234, succeeded: 1234, failed: 0, error: null, cancelRequestedAt: null } })
    mount(<JobPanel id="foreign" onChange={() => {}} />, ['analysis.bulk'])
    expect(await screen.findByText(/Job berada di entitas lain/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unduh hasil XLSX' })).toBeNull()
  })
  it('map requests real viewport and warns when the 1,000-feature limit is reached', async () => {
    const map = vi.spyOn(atlasApi.network, 'map').mockImplementation(async (_entity, _bbox, _layers, page) => ({ data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: `segments:${page}`, properties: { id: String(page), name: 'Synthetic fixture', layer: 'segments' }, geometry: { type: 'LineString', coordinates: [[106, -7], [107, -6]] } }] }, meta: { page, pageSize: 100, total: 1001 } }))
    mount(<NetworkMapPage />, ['network.read'])
    expect(map).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Report viewport' }))
    expect(await screen.findByText(/Viewport berisi lebih dari 1.000 fitur/)).toBeTruthy()
    expect(map).toHaveBeenCalledTimes(10)
    expect(map.mock.calls[0].slice(0, 4)).toEqual([alpha, '106,-7,107,-6', 'segments,poles,odc,odp', 1])
    expect(screen.getByText('Map: 10 features')).toBeTruthy()
  })
  it('monitoring export creates a job, not an immediate fabricated file', async () => {
    const exportJob = vi.spyOn(atlasApi.reports, 'export').mockResolvedValue({ data: { id: 'export-real', asOf: '2026-10-03T00:00:00Z' } })
    vi.spyOn(atlasApi.jobs, 'get').mockResolvedValue({ data: { id: 'export-real', entityId: alpha, type: 'UTILIZATION_EXPORT', status: 'QUEUED', total: 1, completed: 0, succeeded: 0, failed: 0, error: null, cancelRequestedAt: null } })
    mount(<ReportsPage />, ['reports.export'])
    await userEvent.click(screen.getByRole('button', { name: 'Buat snapshot export' }))
    expect(await screen.findByText('export-real')).toBeTruthy()
    expect(exportJob).toHaveBeenCalledWith(alpha)
    expect(await screen.findByText('QUEUED')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Unduh hasil XLSX' })).toBeNull()
  })
  it('manual FIFO promotion calls only the chosen entry and displays conflict', async () => {
    vi.spyOn(atlasApi.capacity, 'waiting').mockResolvedValue({ data: [{ id: 'tail', segmentId: segment, status: 'WAITING', customerName: 'Tail fixture', customerPicName: 'PIC', customerPicContact: 'test', presalesUserId: 'alice', coreCount: 1, reason: 'test', createdAt: '2026-10-03T00:00:00Z', bookingId: null }] })
    const allocate = vi.spyOn(atlasApi.capacity, 'allocate').mockRejectedValue(new ApiError('Earlier waiting entry must be allocated first', 409))
    mount(<ReservationWorkspace waiting />, ['waiting-list.read', 'waiting-list.allocate'])
    await userEvent.click(await screen.findByRole('button', { name: 'Alokasikan seluruh kebutuhan' }))
    expect(await screen.findByText('Earlier waiting entry must be allocated first')).toBeTruthy()
    expect(allocate).toHaveBeenCalledWith('tail', expect.any(String))
    expect(screen.queryByText('Permintaan berhasil diproses oleh server.')).toBeNull()
  })
  it('master creation requires explicit approved values and returns server ID', async () => {
    const create = vi.spyOn(atlasApi.network, 'createType').mockResolvedValue({ data: { id: 'master-real', code: 'COMPANY-CODE', name: 'Company type' } })
    mount(<AssetsPage />, ['network.master-write'])
    await userEvent.type(screen.getByLabelText('Kode tipe kabel'), 'COMPANY-CODE')
    await userEvent.type(screen.getByLabelText('Nama tipe kabel'), 'Company type')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan master tipe kabel' }))
    expect(await screen.findByText('master-real')).toBeTruthy()
    expect(create).toHaveBeenCalledWith(alpha, 'COMPANY-CODE', 'Company type')
  })
})
