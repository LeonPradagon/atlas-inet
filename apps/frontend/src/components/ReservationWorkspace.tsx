import { useId, useRef, useState, type FormEvent } from 'react'
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
    const input: CustomerInput = { segmentId, presalesUserId: presales, coreCount: Number(fields.get('coreCount')), customerName: text('customerName'), customerPicName: text('customerPicName'), customerPicContact: text('customerPicContact'), reason: text('reason'), ...(text('customerReference') ? { customerReference: text('customerReference') } : {}) }
    create.mutate(input, { onSuccess: (response) => { setReceipt(response.data.id); form.reset() } })
  }
  return <>
    {can(`${resource}.create`) && <div className="row"><div className="col-xl-7"><ContentCard title={waiting ? 'Ajukan waiting list' : 'Ajukan booking core'}>
      <p className="small">FIFO ketat. Alokasi/release seluruh kebutuhan. Masa berlaku mengikuti policy server; default 1 bulan kalender Asia/Jakarta.</p>
      <form onSubmit={submit}><fieldset disabled={create.isPending}><SegmentPicker value={segmentId} onChange={setSegmentId} /><div className="row"><div className="col-md-6"><Field name="customerName" label="Nama customer" /><Field name="customerReference" label="Referensi customer (opsional)" required={false} /><Field name="customerPicName" label="PIC customer" /><Field name="customerPicContact" label="Kontak PIC customer" /></div><div className="col-md-6"><Field name="presalesUserId" label="PIC Presales · user ID" value={presales} onChange={setPresales} /><Field name="coreCount" label="Kebutuhan core" type="number" min={1} max={1_000_000} step="1" /><Field name="reason" label="Kebutuhan / alasan" /></div></div>
      <button className="btn btn-primary">{waiting ? 'Simpan permintaan antrean' : 'Booking core'}</button></fieldset><MutationStatus mutation={create} />{receipt && <p className="small">ID hasil: <code>{receipt}</code></p>}</form>
    </ContentCard></div><div className="col-xl-5"><SegmentDetail id={segmentId} /></div></div>}
    {can(`${resource}.read`) && <ContentCard title={waiting ? 'Antrean per segmen' : 'Daftar booking'} tools={<select className="form-select form-select-sm" aria-label="Filter status" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value) }}><option value="">Semua status</option>{(waiting ? ['WAITING', 'ALLOCATED', 'CANCELLED'] : ['BOOKED', 'USED', 'RELEASED', 'EXPIRED']).map((value) => <option key={value}>{value}</option>)}</select>}>
      <QueryState query={list} empty={list.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Customer / PIC</th><th>Segmen / Core</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}><td>{row.customerName}<br /><small>{row.customerPicName} · {row.customerPicContact}<br />Presales: {row.presalesUserId}</small></td><td><button className="btn btn-link p-0 text-break" onClick={() => setSegmentId(row.segmentId)}>{row.segmentId}</button><br />{row.coreCount} core</td><td>{row.status}<br /><small>{dateLabel(row.createdAt)}</small>{'expiresAt' in row && <div className="small">Expiry: {dateLabel(String(row.expiresAt))}</div>}</td><td>
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
