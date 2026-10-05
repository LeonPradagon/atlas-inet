import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import type { ApiResponse, Booking, CustomerInput, WaitingEntry } from '../shared/domain-types'
import { ContentCard } from './ContentCard'
import { dateLabel, Field, MutationStatus, Pagination, QueryState, useDomainMutation } from './DomainUi'
import { SegmentDetail, SegmentPicker } from './SegmentTools'

export function ReservationWorkspace({ waiting = false }: { waiting?: boolean }) {
  const { entity, user, can } = useEntityScope()
  const [segmentId, setSegmentId] = useState('')
  const [presales, setPresales] = useState(user?.id ?? '')
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [receipt, setReceipt] = useState('')
  const identity = useRef<{ payload: string; key: string } | null>(null)
  const resource = waiting ? 'waiting-list' : 'bookings'
  const presalesUsers = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'presales-users'), queryFn: ({ signal }) => atlasApi.capacity.presalesUsers(entity!.id, signal), enabled: Boolean(entity) && can('bookings.create') })
  useEffect(() => { setPresales(user?.id ?? '') }, [entity?.id, user?.id])
  const create = useDomainMutation(async (input: CustomerInput) => {
    const payload = JSON.stringify(input)
    if (identity.current?.payload !== payload) identity.current = { payload, key: crypto.randomUUID() }
    const response = waiting ? await atlasApi.capacity.wait(input, identity.current.key) : await atlasApi.capacity.book(input, identity.current.key)
    identity.current = null
    return response
  })
  const list = useQuery<ApiResponse<(Booking | WaitingEntry)[]>>({ queryKey: domainKey(entity?.id, user?.id, resource, page, status), enabled: Boolean(entity) && can(`${resource}.read`), queryFn: ({ signal }) => waiting ? atlasApi.capacity.waiting(entity!.id, page, status, signal) : atlasApi.capacity.bookings(entity!.id, page, status, signal) })
  const allocateKeys = useRef(new Map<string, string>())
  const allocate = useDomainMutation((id: string) => {
    if (!allocateKeys.current.has(id)) allocateKeys.current.set(id, crypto.randomUUID())
    return atlasApi.capacity.allocate(id, allocateKeys.current.get(id)!)
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const text = (key: string) => String(fields.get(key) ?? '').trim()
    const input: CustomerInput = { segmentId, presalesUserId: user?.id ?? '', coreCount: Number(fields.get('coreCount')), customerName: text('customerName'), customerPicName: text('customerPicName'), customerPicContact: text('customerPicContact'), reason: text('reason'), ...(text('customerReference') ? { customerReference: text('customerReference') } : {}) }
    create.mutate(input, { onSuccess: (response) => { setReceipt(response.data.id); form.reset() } })
  }
  return <>
    {can(`${resource}.create`) && <div className="row"><div className="col-xl-7"><ContentCard title={waiting ? 'Ajukan waiting list' : 'Booking core baru'}>
      <div className="alert alert-info py-2"><i className="bi bi-info-circle me-2" aria-hidden="true" />{waiting ? 'Permintaan masuk antrean FIFO. Core belum dialokasikan sampai tersedia dan disetujui.' : 'Booking menahan kapasitas selama masa berlaku policy; default 1 bulan kalender (Asia/Jakarta).'} Alokasi dan release berlaku untuk seluruh kebutuhan.</div>
     <form onSubmit={submit}><fieldset disabled={create.isPending}><SegmentPicker value={segmentId} onChange={setSegmentId} />
        <h5 className="mt-4">2. Data customer</h5><div className="row"><div className="col-md-6"><Field name="customerName" label="Nama customer" /><Field name="customerReference" label="Referensi customer (opsional)" required={false} /></div><div className="col-md-6"><Field name="customerPicName" label="PIC customer" /><Field name="customerPicContact" label="Kontak PIC customer" /></div></div>
       <h5 className="mt-3">3. PIC dan kebutuhan</h5><div className="row"><div className="col-md-6"><label className="form-label" htmlFor="presales-user-name">PIC Presales</label><select id="presales-user-name" className="form-select" value={presales} required onChange={(event) => setPresales(event.target.value)} disabled={presalesUsers.isPending || presalesUsers.isError || !presalesUsers.data?.data.length}><option value="">Pilih PIC Presales…</option>{presalesUsers.data?.data.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.id === user?.id ? ' (Anda)' : ''}</option>)}</select><input type="hidden" name="presalesUserId" value={presales} />{presalesUsers.isError ? <p className="form-text text-danger" role="alert">Daftar PIC gagal dimuat. Coba muat ulang halaman.</p> : <p className="form-text">Pilih berdasarkan nama; ID akun dikirim otomatis.{presalesUsers.data && !presalesUsers.data.data.length ? ' Belum ada anggota yang berhak membuat booking di entitas ini.' : ''}</p>}</div><div className="col-md-6"><Field name="coreCount" label="Kebutuhan core" type="number" min={1} max={1_000_000} step="1" /></div></div><Field name="reason" label="Kebutuhan / alasan" />
      <button className="btn btn-primary" aria-label={waiting ? 'Simpan permintaan antrean' : 'Booking core'}><i className={`bi ${waiting ? 'bi-hourglass-split' : 'bi-bookmark-check'} me-1`} aria-hidden="true" />{waiting ? 'Ajukan ke waiting list' : 'Konfirmasi booking core'}</button></fieldset><MutationStatus mutation={create} />{receipt && <div className="alert alert-success mt-3 mb-0" role="status">Permintaan berhasil disimpan. ID: <code>{receipt}</code></div>}</form>
    </ContentCard></div><div className="col-xl-5"><SegmentDetail id={segmentId} /></div></div>}
    {can(`${resource}.read`) && <ContentCard title={waiting ? 'Waiting list · urutan antrean' : 'Status dan riwayat booking'} tools={<label className="small mb-0">Filter status <select className="form-select form-select-sm mt-1" aria-label="Filter status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }}><option value="">Semua status</option>{(waiting ? ['WAITING', 'ALLOCATED', 'CANCELLED'] : ['BOOKED', 'USED', 'RELEASED', 'EXPIRED']).map((value) => <option key={value}>{value}</option>)}</select></label>}>
      <QueryState query={list} empty={list.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped align-middle"><thead><tr><th>Customer dan PIC</th><th>Segmen dan core</th><th>Status / waktu</th><th>Aksi</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}><td><strong>{row.customerName}</strong><br /><small>PIC: {row.customerPicName} · {row.customerPicContact}<br />Presales user: {row.presalesUserId}</small></td><td><button className="btn btn-link p-0 text-break" onClick={() => setSegmentId(row.segmentId)} aria-label={`Lihat segmen ${row.segmentId}`}>{row.segmentId}</button><br /><strong>{row.coreCount} core</strong></td><td><span className={`badge ${row.status === 'BOOKED' || row.status === 'WAITING' ? 'text-bg-primary' : row.status === 'USED' || row.status === 'ALLOCATED' ? 'text-bg-success' : 'text-bg-secondary'}`}>{row.status}</span><br /><small>{dateLabel(row.createdAt)}</small>{'expiresAt' in row && <div className="small">Berlaku sampai: {dateLabel(String(row.expiresAt))}</div>}</td><td>
        {waiting && row.status === 'WAITING' && <>
          {can('waiting-list.allocate') && <button className="btn btn-primary btn-sm mb-2" disabled={allocate.isPending} onClick={() => allocate.mutate(row.id)}>Alokasikan seluruh kebutuhan</button>}
          {can('waiting-list.cancel') && <ReasonAction title="Batalkan antrean" label="Alasan pembatalan" action={(reason) => atlasApi.capacity.cancelWaiting(row.id, reason)} />}
        </>}
        {!waiting && row.status === 'BOOKED' && <>
          {can('bookings.release') && <ReasonAction title="Release seluruh booking" label="Alasan release" action={(reason) => atlasApi.capacity.release(row.id, reason)} />}
          {can('allocations.write') && <ReasonAction title="Konversi seluruh booking ke Used" label="Referensi operasional" action={(value) => atlasApi.capacity.activate(row.id, value)} showId />}
        </>}
        <small className="d-block text-break">ID: {row.id}</small>
      </td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={list.data?.meta} setPage={setPage} /><MutationStatus mutation={allocate} />
    </ContentCard>}
    {!can(`${resource}.create`) && segmentId && <SegmentDetail id={segmentId} />}
    {!waiting && can('allocations.write') && <DeallocateForm />}
  </>
}
function ReasonAction({ title, label, action, showId = false }: { title: string; label: string; action: (value: string) => Promise<unknown>; showId?: boolean }) {
  const fieldId = useId()
  const [value, setValue] = useState('')
  const mutation = useDomainMutation(action)
  return <details className="mb-2"><summary>{title}</summary><form onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate(value) }}><Field label={label} name={fieldId} value={value} onChange={setValue} /><button className="btn btn-outline-primary btn-sm" disabled={mutation.isPending}>Konfirmasi {title.toLowerCase()}</button><MutationStatus mutation={mutation} />{showId && mutation.isSuccess && <p className="small text-break">ID allocation: {String((mutation.data as { data?: { id?: string } })?.data?.id ?? '')}</p>}</form></details>
}
function DeallocateForm() {
  const [id, setId] = useState(''), [reason, setReason] = useState('')
  const mutation = useDomainMutation(() => atlasApi.capacity.deallocate(id, reason))
  return <ContentCard title="Tutup alokasi Used"><p className="small">Gunakan ID allocation dari hasil aktivasi. Ini bukan release booking.</p><form onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}><Field name="deallocation-id" label="ID allocation" value={id} onChange={setId} /><Field name="deallocation-reason" label="Alasan penutupan" value={reason} onChange={setReason} /><button className="btn btn-outline-primary" disabled={mutation.isPending}>Deallocate seluruh alokasi</button><MutationStatus mutation={mutation} /></form></ContentCard>
}
