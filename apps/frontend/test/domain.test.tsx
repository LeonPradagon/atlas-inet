import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { NotificationBell } from '../src/components/NotificationBell'
import { AnalysisPage } from '../src/pages/AnalysisPage'
import { JobPanel } from '../src/components/JobPanel'
import { SettingsPage } from '../src/pages/SettingsPage'
import { AssetsPage } from '../src/pages/AssetsPage'
import { NetworkMapPage } from '../src/pages/NetworkMapPage'
import { SegmentDetail } from '../src/components/SegmentTools'
import { ReportsPage } from '../src/pages/ReportsPage'
import { AccountManagementPage } from '../src/pages/AccountManagementPage'
import { CableTypesPanel } from '../src/components/CableTypesPanel'
import Swal from 'sweetalert2'

vi.mock('sweetalert2', () => ({ default: { fire: vi.fn().mockResolvedValue({}), close: vi.fn(), showLoading: vi.fn() } }))
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
  const { entity, user, can } = useEntityScope()
  return <><p data-testid="scope">{entity?.code ?? 'NONE'} / {can('bookings.create') ? 'CAN_BOOK' : 'NO_BOOK'}</p><div key={`${user?.id}:${entity?.id}:${entity?.permissions.join(',')}`}>{children}</div></>
}
function mount(children: ReactNode, permissions: string[], betaPermissions: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  client.setQueryData(currentUserQueryKey, session(permissions, betaPermissions))
  render(<QueryClientProvider client={client}><EntityScopeProvider><ScopeHarness>{children}</ScopeHarness></EntityScopeProvider></QueryClientProvider>)
  return client
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })
beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(atlasApi.capacity, 'presalesUsers').mockResolvedValue({ data: [{ id: 'alice', name: 'Admin' }] })
  vi.spyOn(atlasApi.imports, 'list').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } })
  vi.spyOn(atlasApi.capacity, 'allocations').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } })
})

describe('entity and session isolation', () => {
  it('uses first entity grant only; entity switcher is removed', async () => {
    mount(<ReservationWorkspace />, [], ['bookings.create'])
    expect(screen.getByTestId('scope').textContent).toContain('NO_BOOK')
    expect(screen.queryByRole('button', { name: 'Booking core' })).toBeNull()
    expect(screen.queryByText('Select beta')).toBeNull()
  })
  it('resolves first available entity and separates user/entity cache keys', () => {
    const entities = session([]).entityAccess
    expect(resolveEntity(entities)?.id).toBe(alpha)
    expect(resolveEntity([])).toBeUndefined()
    expect(domainKey(alpha, 'alice', 'notifications')).not.toEqual(domainKey(alpha, 'bob', 'notifications'))
    expect(domainKey(alpha, 'alice')).not.toEqual(domainKey(beta, 'alice'))
  })
  it('loads data in first entity scope without a selector', async () => {
    const list = vi.spyOn(atlasApi.capacity, 'bookings').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 25, total: 0 } })
    mount(<ReservationWorkspace />, ['bookings.create', 'bookings.read'], ['bookings.create', 'bookings.read'])
    await userEvent.type(screen.getByLabelText('Nama customer'), 'Private Alpha')
    expect((screen.getByLabelText('Nama customer') as HTMLInputElement).value).toBe('Private Alpha')
    await waitFor(() => expect(list).toHaveBeenCalledWith(alpha, 1, '', expect.any(AbortSignal), 25))
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
  it('creates a booking account with confirmed initial password and clears secret fields', async () => {
    const create = vi.spyOn(atlasApi.accounts, 'create').mockResolvedValue({ data: { id: 'new-user', name: 'Booking Tester', email: 'booking@example.test', profile: 'booking-manager' } })
    mount(<AccountManagementPage />, ['accounts.manage'])
    fireEvent.change(screen.getByLabelText('Nama lengkap'), { target: { value: 'Booking Tester' } })
    fireEvent.change(screen.getByLabelText('Email kerja'), { target: { value: 'booking@example.test' } })
    fireEvent.change(screen.getByLabelText('Akses Booking'), { target: { value: 'booking-manager' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'Secret-test-2026' } })
    fireEvent.change(screen.getByLabelText('Konfirmasi password awal'), { target: { value: 'Secret-test-2026' } })
    await userEvent.click(screen.getByRole('button', { name: 'Buat akun' }))
    expect(await screen.findByText(/berhasil dibuat dengan akses booking-manager/)).toBeTruthy()
    expect(create).toHaveBeenCalledWith(alpha, {
      name: 'Booking Tester', email: 'booking@example.test', password: 'Secret-test-2026', profile: 'booking-manager',
    })
    expect((screen.getByLabelText('Password awal') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Secret-test-2026')).toBeNull()
  })
  it('rejects mismatched initial passwords before sending account request', async () => {
    const create = vi.spyOn(atlasApi.accounts, 'create')
    mount(<AccountManagementPage />, ['accounts.manage'])
    fireEvent.change(screen.getByLabelText('Nama lengkap'), { target: { value: 'Booking Tester' } })
    fireEvent.change(screen.getByLabelText('Email kerja'), { target: { value: 'booking@example.test' } })
    fireEvent.change(screen.getByLabelText('Password awal'), { target: { value: 'Secret-test-2026' } })
    fireEvent.change(screen.getByLabelText('Konfirmasi password awal'), { target: { value: 'Different-secret' } })
    await userEvent.click(screen.getByRole('button', { name: 'Buat akun' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Konfirmasi password tidak sama.')
    expect(create).not.toHaveBeenCalled()
  })
  it('booking errors never show success; unchanged retry retains idempotency key', async () => {
    const book = vi.spyOn(atlasApi.capacity, 'book').mockRejectedValueOnce(new ApiError('Capacity conflict', 409)).mockResolvedValue({ data: { id: 'booking-real' } } as never)
    mount(<ReservationWorkspace />, ['bookings.create'])
    expect(await screen.findByRole('option', { name: 'Admin (Anda)' })).toBeTruthy()
    expect(screen.queryByLabelText('PIC Presales · ID user')).toBeNull()
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
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sedang memproses', showConfirmButton: false }))
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ icon: 'error', title: 'Capacity conflict', toast: true }))
    expect(Swal.fire).toHaveBeenCalledWith(expect.objectContaining({ icon: 'success', title: 'Berhasil diproses', toast: true }))
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
  it('shows unread notification count in the header bell for the active entity', async () => {
    const unreadCount = vi.spyOn(atlasApi.notifications, 'unreadCount').mockResolvedValue({ data: 3 })
    vi.spyOn(atlasApi.notifications, 'list').mockResolvedValue({ data: [{ id: 'preview-notification', type: 'BOOKING_EXPIRED', payload: { coreCount: 2 }, readAt: null, createdAt: '2026-10-03T00:00:00Z' }] })
    mount(<NotificationBell />, ['notifications.read'])
    expect(await screen.findByText('3')).toBeTruthy()
    expect(unreadCount).toHaveBeenCalledWith(alpha, expect.any(AbortSignal))
    await userEvent.click(screen.getByRole('button', { name: 'Notifikasi, 3 belum dibaca' }))
    expect(await screen.findByText('BOOKING EXPIRED')).toBeTruthy()
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
    await userEvent.upload(screen.getByLabelText(/File .xlsx/), new File(['<kml/>'], 'fixture.kml', { type: 'application/vnd.google-earth.kml+xml' }))
    // jsdom's file-input constraint validation does not recognize user-event's FileList.
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('REF')
    expect(submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Setujui proses baris valid' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith('upload-real'))
    expect(await screen.findByText('job-real')).toBeTruthy()
  })
  it('loads all bulk preview pages onto the map beyond 100 and pages the table', async () => {
    const row = (i: number) => ({ rowNumber: i + 2, referenceId: `REF-${i}`, error: i === 1000 ? 'Invalid location' : null, input: { latitude: -6.2, longitude: 106.8 } })
    vi.spyOn(atlasApi.analysis, 'upload').mockResolvedValue({ data: { id: 'all-preview', preview: Array.from({ length: 100 }, (_, i) => row(i)) }, meta: { total: 1002 } } as never)
    const pages = vi.spyOn(atlasApi.analysis, 'uploadRows').mockImplementation(async (_id, page) => ({ data: page === 1 ? Array.from({ length: 1000 }, (_, i) => row(i)) : [row(1000), row(1001)], meta: { page, pageSize: 1000, total: 1002 } }))
    const submit = vi.spyOn(atlasApi.analysis, 'submit')
    mount(<AnalysisPage />, ['analysis.bulk'])
    await userEvent.upload(screen.getByLabelText(/File .xlsx/), new File(['synthetic'], 'input.xlsx'))
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    expect(await screen.findByText('Map: 1001 features')).toBeTruthy()
    expect(screen.getByText(/Dimuat 1002 dari 1002/)).toBeTruthy()
    expect(pages).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('REF-100')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya preview analisis' }))
    expect(screen.getByText('REF-100')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Baris per halaman preview analisis'), '10')
    expect(screen.getByText('REF-0')).toBeTruthy()
    expect(screen.queryByText('REF-10')).toBeNull()
    expect(screen.getByText('Map: 1001 features')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })
  it('validates only capacity without naming policy and refreshes detail from server', async () => {
    const initial = { id: segment, ownerEntityId: alpha, segmentCode: 'SEG-1', cableName: 'Imported label', datasetVersion: 'v1', version: 1,
      installedCoreCount: null, capacityValidated: false, status: 'ACTIVE', cableType: null, installationMethod: null, roadSide: null,
      geometry: { type: 'LineString', coordinates: [[106,-7],[107,-6]] }, completeness: { status: 'INCOMPLETE', missingFields: ['cableType'] },
      capacity: { total: null, used: 0, booked: 0, idle: null, available: null, waitingCount: 0, waitingCores: 0, asOf: '2026-10-08T00:00:00Z' } }
    let current = initial
    vi.spyOn(atlasApi.network, 'segment').mockImplementation(async () => ({ data: current }) as never)
    const update = vi.spyOn(atlasApi.network, 'update').mockImplementation(async () => {
      current = { ...initial, version: 2, installedCoreCount: 24, capacityValidated: true, capacity: { ...initial.capacity, total: 24, idle: 24, available: 24 } } as never
      return { data: { id: segment, version: 2 } }
    })
    mount(<SegmentDetail id={segment} />, ['network.read', 'network.write'])
    const field = await screen.findByLabelText('Total core untuk booking')
    fireEvent.change(field, { target: { value: '24' } })
    expect((screen.getByRole('button', { name: 'Simpan kapasitas tervalidasi' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByLabelText('Saya sudah memverifikasi total core dan pencatatan pemakaian existing.'))
    await userEvent.click(screen.getByRole('button', { name: 'Simpan kapasitas tervalidasi' }))
    expect(await screen.findByText('24 core tersedia')).toBeTruthy()
    expect(update).toHaveBeenCalledWith(segment, 1, { installedCoreCount: 24, capacityValidated: true })
    expect(screen.getByRole('img', { name: 'Total 24, Used 0, Booked 0, Available 24' })).toBeTruthy()
  })
  it('refreshes core counters after booking and sends the selected Presales PIC', async () => {
    const capacity = { total: 24, used: 0, booked: 0, idle: 24, available: 24, waitingCount: 0, waitingCores: 0, asOf: '2026-10-08T00:00:00Z' }
    const detail = { id: segment, ownerEntityId: alpha, segmentCode: 'SEG-1', cableName: 'Imported label', datasetVersion: 'v1', version: 1, installedCoreCount: 24, capacityValidated: true, status: 'ACTIVE', cableType: null, installationMethod: null, roadSide: null, completeness: { status: 'INCOMPLETE', missingFields: ['cableType'] }, capacity }
    vi.spyOn(atlasApi.network, 'segments').mockImplementation(async () => ({ data: [detail] }) as never)
    vi.spyOn(atlasApi.network, 'segment').mockImplementation(async () => ({ data: detail }) as never)
    vi.mocked(atlasApi.capacity.presalesUsers).mockResolvedValue({ data: [{ id: 'alice', name: 'Alice' }, { id: 'charlie', name: 'Charlie' }] })
    const book = vi.spyOn(atlasApi.capacity, 'book').mockImplementation(async () => { capacity.booked=2;capacity.available=22;return { data: { id: 'new-booking' } } as never })
    mount(<ReservationWorkspace />, ['bookings.create','network.read'])
    await userEvent.selectOptions(await screen.findByLabelText('1. Pilih segmen jaringan'), segment)
    expect(await screen.findByText('24 core tersedia')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('PIC Presales'), 'charlie')
    for (const label of ['Nama customer','PIC customer','Kontak PIC customer','Kebutuhan / alasan']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'Synthetic test' } })
    fireEvent.change(screen.getByLabelText('Kebutuhan core'), { target: { value: '2' } })
    await userEvent.click(screen.getByRole('button', { name: 'Booking core' }))
    expect(await screen.findByText('22 core tersedia')).toBeTruthy()
    expect(book.mock.calls[0][0]).toMatchObject({ presalesUserId: 'charlie', coreCount: 2 })
    expect(screen.getByRole('img', { name: 'Total 24, Used 0, Booked 2, Available 22' })).toBeTruthy()
  })
  it('records verified existing usage directly and refreshes Used/Available without creating a booking', async () => {
    const capacity={total:null,used:0,booked:0,idle:null,available:null,waitingCount:0,waitingCores:0,asOf:'2026-10-08T00:00:00Z'}
    const initial={id:segment,ownerEntityId:alpha,segmentCode:'SEG-1',cableName:'Imported label',datasetVersion:'v1',version:1,installedCoreCount:null,capacityValidated:false,status:'ACTIVE',cableType:null,installationMethod:null,roadSide:null,completeness:{status:'INCOMPLETE',missingFields:['cableType']},capacity}
    let current=initial
    vi.spyOn(atlasApi.network,'segment').mockImplementation(async()=>({data:current}) as never)
    const book=vi.spyOn(atlasApi.capacity,'book')
    const record=vi.spyOn(atlasApi.capacity,'recordExisting').mockImplementation(async()=>{
      current={...initial,version:2,installedCoreCount:24,capacityValidated:true,capacity:{...capacity,total:24,used:6,idle:18,available:18}} as never
      vi.mocked(atlasApi.capacity.allocations).mockResolvedValue({data:[{id:'existing-id',segmentId:segment,sourceBookingId:null,coreCount:6,operationalReference:'Inventory verified',activatedAt:'2026-10-08T00:00:00Z'}],meta:{page:1,pageSize:25,total:1}})
      return {data:{id:segment,version:2,allocationId:'existing-id'}}
    })
    mount(<SegmentDetail id={segment} />,['network.read','network.write','allocations.write'])
    await screen.findByText('Catat kapasitas dan Used existing yang belum tercatat')
    await userEvent.click(screen.getByText('Catat kapasitas dan Used existing yang belum tercatat'))
    for(const [label,value] of [['Total core fisik terverifikasi','24'],['Used existing belum tercatat','6'],['Referensi verifikasi pemakaian existing','Inventory verified'],['Alasan pencatatan existing','Initial inventory']]) fireEvent.change(screen.getByLabelText(label),{target:{value}})
    expect((screen.getByRole('button',{name:'Simpan kapasitas dan Used existing'}) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByLabelText('Total fisik dan Used existing telah diverifikasi; pemakaian ini belum tercatat di sistem.'))
    await userEvent.click(screen.getByRole('button',{name:'Simpan kapasitas dan Used existing'}))
    expect(await screen.findByText('18 core tersedia')).toBeTruthy()
    expect(record).toHaveBeenCalledWith(segment,1,{installedCoreCount:24,existingCoreCount:6,operationalReference:'Inventory verified',reason:'Initial inventory',verified:true},expect.any(String))
    expect(await screen.findByText('Used existing')).toBeTruthy()
    expect(book).not.toHaveBeenCalled()
  })
  it('accepts Excel alongside KML/KMZ and downloads the scoped template without submitting a job', async () => {
    const template = vi.spyOn(atlasApi.analysis, 'template').mockResolvedValue(undefined)
    const upload = vi.spyOn(atlasApi.analysis, 'upload').mockResolvedValue({ data: { id: 'excel-preview', preview: [{ rowNumber: 2, referenceId: 'EXCEL-REF', error: null }] } })
    const submit = vi.spyOn(atlasApi.analysis, 'submit')
    mount(<AnalysisPage />, ['analysis.bulk'])
    const input = screen.getByLabelText(/File .xlsx/) as HTMLInputElement
    expect(input.accept).toBe('.xlsx,.kml,.kmz')
    await userEvent.click(screen.getByRole('button', { name: 'Unduh template Excel' }))
    await waitFor(() => expect(template).toHaveBeenCalledWith(alpha))
    const file = new File(['synthetic workbook'], 'input.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await userEvent.upload(input, file)
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    expect(await screen.findByText('EXCEL-REF')).toBeTruthy()
    expect(upload).toHaveBeenCalledWith(alpha, file)
    expect(submit).not.toHaveBeenCalled()
  })
  it('does not turn empty individual coordinates into a location at zero', async () => {
    const run = vi.spyOn(atlasApi.analysis, 'run')
    mount(<AnalysisPage />, ['analysis.create'])
    expect((screen.getByLabelText('Lintang') as HTMLInputElement).required).toBe(true)
    expect((screen.getByLabelText('Bujur') as HTMLInputElement).required).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan analisis' }))
    expect(run).not.toHaveBeenCalled()
  })
  it('allows Excel above 20 MB up to 50 MB while preserving the KML limit', async () => {
    mount(<AnalysisPage />, ['analysis.bulk'])
    const input=screen.getByLabelText(/File .xlsx/) as HTMLInputElement
    const file=(name:string,size:number) => {
      const value=new File(['synthetic'],name)
      Object.defineProperty(value,'size',{value:size})
      return value
    }
    await userEvent.upload(input,file('large.xlsx',50*1024*1024))
    expect((screen.getByRole('button',{name:'Upload dan preview'}) as HTMLButtonElement).disabled).toBe(false)
    await userEvent.upload(input,file('too-large.xlsx',50*1024*1024+1))
    expect((screen.getByRole('button',{name:'Upload dan preview'}) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('50 MB')
    await userEvent.upload(input,file('large.kml',21*1024*1024))
    expect((screen.getByRole('button',{name:'Upload dan preview'}) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('20 MB')
  })
  it('shows valid imported KML assets as automatically published', async () => {
    vi.spyOn(atlasApi.imports, 'preview').mockResolvedValue({ data: { id: 'preview-real', rows: [{ rowNumber: 1, kind: 'SEGMENT', code: 'REF' }], areas: [], referenceFeatures: [], errors: [], status: 'PUBLISHED', datasetId: 'dataset-real' } })
    const publish = vi.spyOn(atlasApi.imports, 'publish')
    mount(<AssetsPage />, ['imports.write'])
    await userEvent.type(screen.getByLabelText('Identitas source system'), 'fixture')
    await userEvent.upload(screen.getByLabelText(/File KML/), new File(['<kml/>'], 'fixture.kml', { type: 'application/vnd.google-earth.kml+xml' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('preview-real')
    expect(await screen.findByText('1 aset valid sudah diterbitkan otomatis ke jaringan aktif.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /terbitkan/i })).toBeNull()
    expect(publish).not.toHaveBeenCalled()
  })
  it('loads saved import preview only after clicking its history button in a modal', async () => {
    const row = { id: 'saved-preview', sourceName: 'saved.kml', sourceSystem: 'fixture-source', status: 'PUBLISHED', datasetId: 'dataset-saved', areasPublishedAt: null, publishedAt: '2026-10-03T00:00:00Z', createdAt: '2026-10-03T00:00:00Z', validRows: 1, referenceAreas: 0, referenceFeatures: 0, errors: 0 }
    const originalRootOverflow = document.documentElement.style.overflow
    const originalBodyOverflow = document.body.style.overflow
    vi.spyOn(atlasApi.imports, 'list').mockResolvedValue({ data: [row], meta: { page: 1, pageSize: 25, total: 1 } })
    const get = vi.spyOn(atlasApi.imports, 'get').mockResolvedValue({ data: { id: row.id, rows: [{ rowNumber: 1, kind: 'ODP', code: 'ODP-1' }], areas: [], referenceFeatures: [], errors: [], status: row.status, datasetId: row.datasetId } })
    mount(<AssetsPage />, ['imports.write'])
    const openPreview = await screen.findByRole('button', { name: 'Lihat preview' })
    expect(get).not.toHaveBeenCalled()
    await userEvent.click(openPreview)
    expect(get).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('dialog', { name: 'Preview impor tersimpan' })).toBeTruthy()
    expect(get).toHaveBeenCalledWith(row.id, expect.any(AbortSignal))
    expect(await screen.findByText('1 aset valid sudah diterbitkan otomatis ke jaringan aktif.')).toBeTruthy()
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'Tutup preview' }))
    expect(screen.queryByRole('dialog', { name: 'Preview impor tersimpan' })).toBeNull()
    expect(document.documentElement.style.overflow).toBe(originalRootOverflow)
    expect(document.body.style.overflow).toBe(originalBodyOverflow)
  })
  it('address-only import auto-publishes after explicit coordinate confirmation', async () => {
    const initial = { id: 'address-preview', status: 'PREVIEW', datasetId: null, rows: [], areas: [], referenceFeatures: [], errors: [{ rowNumber: 2, code: 'ADDRESS_NEEDS_GEOCODING', message: 'Coordinates required', sourceRow: { kind: 'ODP', code: 'TEST-ODP', address: 'Synthetic address' } }] }
    const lookedUp = { ...initial, errors: [{ ...initial.errors[0], lookupId: 'lookup-real', candidates: [{ latitude: -6.2, longitude: 106.8, label: 'Synthetic candidate', precision: 'street' }] }] }
    vi.spyOn(atlasApi.imports, 'preview').mockResolvedValue({ data: lookedUp })
    const geocode = vi.spyOn(atlasApi.imports, 'geocodeRow')
    const confirm = vi.spyOn(atlasApi.imports, 'confirmCoordinates').mockRejectedValueOnce(new ApiError('Candidates changed', 409)).mockResolvedValue({ data: { ...initial, errors: [], status: 'PUBLISHED', datasetId: 'dataset-real', rows: [{ rowNumber: 2, kind: 'ODP', code: 'TEST-ODP', geometry: { type: 'Point', coordinates: [106.8, -6.2] } }] } })
    const publish = vi.spyOn(atlasApi.imports, 'publish')
    mount(<AssetsPage />, ['imports.write'])
    await userEvent.type(screen.getByLabelText('Identitas source system'), 'fixture')
    await userEvent.upload(screen.getByLabelText(/File KML/), new File(['<kml/>'], 'fixture.kml', { type: 'application/vnd.google-earth.kml+xml' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Upload dan preview' }).closest('form')!)
    await screen.findByText('Coordinates required', { exact: false })
    expect(screen.queryByRole('button', { name: /Terapkan data tervalidasi/ })).toBeNull()
    expect(geocode).not.toHaveBeenCalled()
    await screen.findByText(/Synthetic candidate/)
    expect(geocode).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi kandidat 1 baris 2' }))
    expect(await screen.findByText('Candidates changed')).toBeTruthy()
    expect(screen.queryByText(/Data lolos validasi/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi kandidat 1 baris 2' }))
    expect(await screen.findByText('1 aset valid sudah diterbitkan otomatis ke jaringan aktif.')).toBeTruthy()
    expect(confirm).toHaveBeenCalledWith('address-preview', 2, 'lookup-real', 0)
    expect(publish).not.toHaveBeenCalled()
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
  it('offers connected point choices only when multiple points are available', async () => {
    const coordinates = { latitude: -6.2, longitude: 106.8 }
    const run = vi.spyOn(atlasApi.analysis, 'run')
      .mockResolvedValueOnce({ data: { status: 'OK', coordinates, needsSurvey: true, connectionPointCandidates: [{ id: 'odp-id', code: 'ODP-01', type: 'ODP' }, { id: 'odc-id', code: 'ODC-01', type: 'ODC' }] } })
      .mockResolvedValue({ data: { status: 'OK', coordinates, needsSurvey: true, connectionPointCode: 'ODP-01', connectionPointType: 'ODP', estimatedCableLengthM: 900, routeStatus: 'ROAD_ROUTE_ESTIMATE', route: { distanceM: 800, shortestFeasibleDistanceM: 750, geometry: { type: 'LineString', coordinates: [[106.8, -6.2], [106.81, -6.2]] } } } as never })
    mount(<AnalysisPage />, ['analysis.create'])
    await userEvent.type(screen.getByLabelText('Lintang'), '-6.2')
    await userEvent.type(screen.getByLabelText('Bujur'), '106.8')
    expect(screen.queryByLabelText('Jenis titik sambung (opsional)')).toBeNull()
    expect(screen.queryByLabelText('ID ODP')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan analisis' }))
    await screen.findByText('Status: OK')
    expect(run).toHaveBeenCalledWith({ entityId: alpha, latitude: -6.2, longitude: 106.8 })
    expect(await screen.findByText('Ada beberapa titik jaringan yang terhubung.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Pilih ODP-01 (ODP)' }))
    expect(await screen.findByText('Titik jaringan yang digunakan')).toBeTruthy()
    expect(await screen.findByText('Status rute: Rute berhasil ditemukan')).toBeTruthy()
    expect(run).toHaveBeenLastCalledWith({ entityId: alpha, latitude: -6.2, longitude: 106.8, connectionPointId: 'odp-id', connectionPointType: 'ODP' })
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
  it('keeps job table mounted while progress refreshes rows in the background', async () => {
    const state = { id: 'stable-job', entityId: alpha, type: 'ANALYSIS', status: 'RUNNING', total: 150, completed: 1, succeeded: 1, failed: 0, error: null, cancelRequestedAt: null }
    vi.spyOn(atlasApi.jobs, 'get').mockResolvedValue({ data: state })
    let refreshing = false
    let finish: ((value: unknown) => void) | undefined
    const data = { data: [{ id: 'stable-row', rowNumber: 2, referenceId: 'STABLE-REF', error: null, result: null }], meta: { page: 1, pageSize: 25, total: 150 } }
    vi.spyOn(atlasApi.jobs, 'rows').mockImplementation(async () => refreshing ? await new Promise<unknown>((resolve) => { finish = resolve }) as never : data)
    const client = mount(<JobPanel id="stable-job" onChange={() => {}} />, ['analysis.bulk'])
    const cell = await screen.findByText('STABLE-REF')
    refreshing = true
    act(() => client.setQueryData(domainKey(alpha, 'alice', 'job', 'stable-job'), { data: { ...state, completed: 2, succeeded: 2 } }))
    await waitFor(() => expect(finish).toBeTruthy())
    expect(screen.getByText('STABLE-REF')).toBe(cell)
    expect(screen.queryByText('Memuat data…')).toBeNull()
    expect(screen.getByText('Memperbarui hasil di background…')).toBeTruthy()
    await act(async () => finish!({ ...data, data: [{ ...data.data[0], result: { status: 'OK' } }] }))
    expect(await screen.findByText('OK')).toBeTruthy()
    expect(screen.getByText('STABLE-REF')).toBe(cell)
  })
  it('job table sends page size and resets the page on size change', async () => {
    vi.spyOn(atlasApi.jobs, 'get').mockResolvedValue({ data: { id: 'paged-job', entityId: alpha, type: 'ANALYSIS', status: 'COMPLETED', total: 150, completed: 150, succeeded: 150, failed: 0, error: null, cancelRequestedAt: null } })
    const rows = vi.spyOn(atlasApi.jobs, 'rows').mockImplementation(async (_id, page, _signal, pageSize=25) => ({ data: [{ id: `row-${page}`, rowNumber: page, referenceId: `PAGE-${page}`, error: null, result: { status: 'OK' } }], meta: { page, pageSize, total: 150 } }))
    mount(<JobPanel id="paged-job" onChange={() => {}} />, ['analysis.bulk'])
    await screen.findByText('PAGE-1')
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 2 hasil job' }))
    await screen.findByText('PAGE-2')
    await userEvent.selectOptions(screen.getByLabelText('Baris per halaman hasil job'), '50')
    await waitFor(() => expect(rows).toHaveBeenLastCalledWith('paged-job', 1, expect.any(AbortSignal), 50))
    expect(await screen.findByText('Halaman 1 dari 3 · 1–50 dari 150 data')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Halaman 3 hasil job' }))
    await screen.findByText('PAGE-3')
  })
  it('uses left-aligned page size selector and compact arrow-only navigation', async () => {
    vi.spyOn(atlasApi.network,'types').mockResolvedValue({data:[],meta:{page:1,pageSize:25,total:220}})
    mount(<CableTypesPanel />,['network.read'])
    const nav=await screen.findByRole('navigation',{name:'Pagination master tipe kabel'})
    const controls=nav.querySelector('.btn-group')!
    const pageSizeSelect = screen.getByLabelText('Baris per halaman master tipe kabel')
    expect(pageSizeSelect.closest('label')?.parentElement?.querySelector('span')?.textContent).toContain('Halaman 1 dari 9')
    expect(screen.getByRole('button',{name:'Halaman sebelumnya master tipe kabel'}).querySelector('i')?.className).toContain('bi-chevron-left')
    expect(screen.getByRole('button',{name:'Halaman berikutnya master tipe kabel'}).querySelector('i')?.className).toContain('bi-chevron-right')
    expect(controls.textContent).not.toMatch(/Pertama|Terakhir|Sebelumnya|Berikutnya/)
    expect(nav.querySelectorAll('button')).toHaveLength(7)
  })
  it('loads every map feature across API pages', async () => {
    const map = vi.spyOn(atlasApi.network, 'map').mockImplementation(async (_entity, _bbox, _layers, page) => ({ data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: `segments:${page}`, properties: { id: String(page), name: 'Synthetic fixture', layer: 'segments' }, geometry: { type: 'LineString', coordinates: [[106, -7], [107, -6]] } }] }, meta: { page, pageSize: 1000, total: 1001 } }))
    mount(<NetworkMapPage />, ['network.read'])
    expect(map).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Report viewport' }))
    expect(await screen.findByText('2 dari 1001 fitur dimuat')).toBeTruthy()
    expect(map).toHaveBeenCalledTimes(2)
    expect(map.mock.calls[0].slice(0, 4)).toEqual([alpha, '106,-7,107,-6', 'segments,poles,odc,odp,pops,areas,references', 1])
    expect(screen.getByText('Map: 2 features')).toBeTruthy()
  })
  it('shows localized cable and capacity detail with a 7/9 meter pole filter on map only', async () => {
    vi.spyOn(atlasApi.network, 'segment').mockResolvedValue({ data: {
      id: segment, ownerEntityId: alpha, segmentCode: 'SEG-1', cableName: 'Kabel uji', datasetVersion: 'v1', version: 1,
      installedCoreCount: 24, capacityValidated: false, installationMethod: 'AERIAL', roadSide: 'LEFT', status: 'ACTIVE',
      cableType: { id: 'type-id', code: 'FO', name: 'Fiber Optic' }, geometry: { type: 'LineString', coordinates: [[106, -7], [107, -6]] },
      capacity: { total: null, used: 3, booked: 4, idle: null, available: null, waitingCount: 2, waitingCores: 5, asOf: '2026-10-06T00:00:00Z', expiryPendingCount: 0 },
      completeness: { status: 'INCOMPLETE', missingFields: ['validatedCapacity'] },
      assets: { poles: [{ id: 'pole-7', code: 'P7', heightM: 7 }, { id: 'pole-9', code: 'P9', heightM: 9 }], odcs: [{ id: 'odc', code: 'ODC-1' }], odps: [{ id: 'odp', code: 'ODP-1' }] },
    } } as never)
    mount(<SegmentDetail id={segment} mapContext />, ['network.read'])
    expect(await screen.findByText('Detail aset jaringan pada peta')).toBeTruthy()
    expect(await screen.findByText('Jumlah core terpasang')).toBeTruthy()
    expect(screen.getByText('24')).toBeTruthy()
    expect(screen.getByText('Core dipesan (Booked)')).toBeTruthy()
    expect(screen.getByText('Waiting List · permintaan')).toBeTruthy()
    expect(screen.getByText('Tiang (2): P7 (7 meter), P9 (9 meter)')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Filter tinggi tiang'), '7')
    expect(screen.getByText('Tiang (1): P7 (7 meter)')).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Filter tinggi tiang'), '9')
    expect(screen.getByText('Tiang (1): P9 (9 meter)')).toBeTruthy()
    expect(screen.queryByText('P7 (7 meter)')).toBeNull()
  })
  it('omits network search while retaining map style and layer filters', () => {
    const search = vi.spyOn(atlasApi.network, 'search')
    mount(<NetworkMapPage />, ['network.read'])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByLabelText('Tampilan peta')).toBeTruthy()
    expect(screen.getByLabelText('Segmen jaringan')).toBeTruthy()
    expect(screen.getByText('Legenda warna & ikon')).toBeTruthy()
    expect(search).not.toHaveBeenCalled()
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
