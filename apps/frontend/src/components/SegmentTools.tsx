import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { dateLabel, Field, MutationStatus, numberLabel, Pagination, QueryState, useDomainMutation } from './DomainUi'
import { ContentCard } from './ContentCard'
import type { ExistingUsageInput, Segment } from '../shared/domain-types'

export function SegmentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segments', page, pageSize), queryFn: ({ signal }) => atlasApi.network.segments(entity!.id, page, signal, pageSize), enabled: Boolean(entity) && can('network.read') })
  if (!can('network.read')) return <div className="mb-3"><Field label="ID segmen jaringan" name="segment-id" value={value} onChange={onChange} /><p className="form-text">Minta ID segmen dari tim jaringan jika daftar segmen tidak tersedia.</p></div>
  return <div className="mb-3">
    <label className="form-label" htmlFor="segment-picker">1. Pilih segmen jaringan</label>
    {query.data?.data.length === 0 ? <div className="alert alert-warning py-2 mb-2" role="status">Belum ada segmen jaringan di entitas ini. Impor KML/KMZ berisi LineString melalui Aset &amp; Impor Jaringan sebelum membuat booking.</div> : <QueryState query={query}>
      <select id="segment-picker" className="form-select" value={value} required onChange={(event) => onChange(event.target.value)}>
        <option value="">Pilih kode kabel / segmen…</option>
        {query.data?.data.map((segment) => <option key={segment.id} value={segment.id}>
          {segment.segmentCode} · {segment.cableName} · Tersedia: {segment.capacity.available == null ? 'belum diketahui' : `${segment.capacity.available} core`}
        </option>)}
      </select>
    </QueryState>}
    {query.data?.data.length ? <>
      <p className="form-text mb-1">Menampilkan {query.data.data.length} segmen. Kapasitas diambil dari data tervalidasi.</p>
       <Pagination page={page} meta={query.data.meta} setPage={setPage} setPageSize={setPageSize} label="segmen untuk booking" />
    </> : null}
  </div>
}
export function SegmentDetail({ id, editable = false, mapContext = false, cardClassName = '' }: { id: string; editable?: boolean; mapContext?: boolean; cardClassName?: string }) {
  const { entity, user, can } = useEntityScope()
  const [poleHeightFilter, setPoleHeightFilter] = useState('all')
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segment', id), queryFn: async ({ signal }) => {
    const response = await atlasApi.network.segment(id, signal)
    if (response.data.ownerEntityId !== entity!.id) throw new ApiError('Segmen berada di entitas lain. Pilih entitas pemilik.', 403)
    return response
   }, enabled: validId && can('network.read'), refetchInterval: 15_000 })
  if (!validId || !can('network.read')) return <p className="text-secondary">Pilih ID segmen dengan izin baca untuk melihat detail kapasitas.</p>
   return <ContentCard title={mapContext ? 'Detail aset jaringan pada peta' : 'Detail segmen'} className={cardClassName}><QueryState query={query}>{query.data && <>
    <h4>{query.data.data.cableName}</h4><p className="small text-secondary">{query.data.data.segmentCode} · Dataset {query.data.data.datasetVersion} · {query.data.data.status}</p>
    <CapacityIndicator capacity={query.data.data.capacity} />
    {mapContext ? <dl className="row">
      <dt className="col-sm-5">Tipe kabel</dt><dd className="col-sm-7">{query.data.data.cableType?.name ?? 'Belum diketahui'}</dd>
      <dt className="col-sm-5">Metode instalasi</dt><dd className="col-sm-7">{query.data.data.installationMethod === 'AERIAL' ? 'Aerial' : query.data.data.installationMethod === 'BURIAL' ? 'Burial' : 'Belum diketahui'}</dd>
      <dt className="col-sm-5">Sisi pemasangan</dt><dd className="col-sm-7">{query.data.data.roadSide === 'LEFT' ? 'Kiri jalan' : query.data.data.roadSide === 'RIGHT' ? 'Kanan jalan' : 'Belum diketahui'}</dd>
    </dl> : <dl className="row"><dt className="col-sm-4">Tipe / instalasi / sisi</dt><dd className="col-sm-8">{query.data.data.cableType?.name ?? 'Belum diketahui'} / {query.data.data.installationMethod ?? '—'} / {query.data.data.roadSide ?? '—'}</dd></dl>}
    {mapContext ? <div className="table-responsive"><table className="table table-sm"><tbody>
      <tr><th>Jumlah core terpasang</th><td>{numberLabel(query.data.data.installedCoreCount)}</td></tr>
      <tr><th>Status validasi kapasitas</th><td>{query.data.data.capacityValidated ? 'Tervalidasi' : 'Belum tervalidasi'}</td></tr>
      <tr><th>Core terpakai (Used)</th><td>{numberLabel(query.data.data.capacity.used)}</td></tr>
      <tr><th>Core dipesan (Booked)</th><td>{numberLabel(query.data.data.capacity.booked)}</td></tr>
      <tr><th>Core idle</th><td>{numberLabel(query.data.data.capacity.idle)}</td></tr>
      <tr><th>Core tersedia (Available)</th><td>{numberLabel(query.data.data.capacity.available)}</td></tr>
      <tr><th>Waiting List · permintaan</th><td>{numberLabel(query.data.data.capacity.waitingCount)}</td></tr>
      <tr><th>Core dalam Waiting List</th><td>{numberLabel(query.data.data.capacity.waitingCores)}</td></tr>
    </tbody></table></div> : <div className="table-responsive"><table className="table table-sm"><tbody>{(['total', 'used', 'booked', 'idle', 'available', 'waitingCount', 'waitingCores'] as const).map((key) => <tr key={key}><th>{key}</th><td>{numberLabel(query.data!.data.capacity[key])}</td></tr>)}</tbody></table></div>}
    <p className="small">Snapshot (Asia/Jakarta): {dateLabel(query.data.data.capacity.asOf)}. {mapContext ? 'Core idle mencakup Booked; Waiting List tidak mengurangi Available.' : 'Idle mencakup Booked; antrean tidak mengurangi Available.'}</p>
    {Boolean(query.data.data.capacity.expiryPendingCount) && <div className="alert alert-info">{query.data.data.capacity.expiryPendingCount} booking sudah kedaluwarsa efektif dan tidak mengurangi Available; worker belum memperbarui status persisted.</div>}
    {query.data.data.completeness.status !== 'COMPLETE' && <div className="alert alert-warning">Metadata belum lengkap: {query.data.data.completeness.missingFields.join(', ')}</div>}
    {mapContext ? <section aria-label="Aset tiang">
      <label className="form-label" htmlFor={`map-pole-height-${id}`}>Filter tinggi tiang</label>
      <select id={`map-pole-height-${id}`} className="form-select form-select-sm mb-2" value={poleHeightFilter} onChange={(event) => setPoleHeightFilter(event.target.value)}>
        <option value="all">Semua tinggi</option><option value="7">7 meter</option><option value="9">9 meter</option>
      </select>
      <p>Tiang ({query.data.data.assets?.poles.filter((pole) => poleHeightFilter === 'all' || String(pole.heightM) === poleHeightFilter).length ?? 0}): {query.data.data.assets?.poles.filter((pole) => poleHeightFilter === 'all' || String(pole.heightM) === poleHeightFilter).map((pole) => `${pole.code} (${pole.heightM} meter)`).join(', ') || 'Tidak tercatat untuk filter ini'}</p>
      <p>ODC: {query.data.data.assets?.odcs.map((p) => p.code).join(', ') || 'Tidak tercatat'}</p>
      <p>ODP: {query.data.data.assets?.odps.map((p) => p.code).join(', ') || 'Tidak tercatat'}</p>
    </section> : <>
      <p>Tiang: {query.data.data.assets?.poles.map((p) => `${p.code} (${p.heightM} m)`).join(', ') || 'Tidak tercatat'}</p>
      <p>ODC: {query.data.data.assets?.odcs.map((p) => p.code).join(', ') || 'Tidak tercatat'}</p>
      <p>ODP: {query.data.data.assets?.odps.map((p) => p.code).join(', ') || 'Tidak tercatat'}</p>
    </>}
    {editable && can('network.write') && <MetadataEditor key={`${id}:${query.data.data.version}`} segment={query.data.data} />}
    {!editable && can('network.write') && <CapacityEditor key={`${id}:${query.data.data.version}`} segment={query.data.data} />}
    <ExistingUsagePanel key={`existing:${id}`} segment={query.data.data} />
    {editable && <NameHistoryPanel id={id} />}
  </>}</QueryState></ContentCard>
}
function CapacityIndicator({ capacity }: { capacity: Segment['capacity'] }) {
  if (capacity.total == null) return <div className="alert alert-warning" role="status">Booking belum dapat dilakukan: total core harus diisi dan kapasitas divalidasi tim jaringan. Metadata lain boleh dilengkapi kemudian; kapasitas tidak ditebak dari booking.</div>
  return <section aria-label="Status kapasitas core" className="mb-3">
    <p className="mb-2"><strong>{capacity.available} core tersedia</strong> dari {capacity.total} · {capacity.booked} Booked · {capacity.used} Used</p>
    <div className="progress" role="img" aria-label={`Total ${capacity.total}, Used ${capacity.used}, Booked ${capacity.booked}, Available ${capacity.available}`}>
      <div className="progress-bar bg-danger" style={{ width: `${capacity.used / capacity.total * 100}%` }} />
      <div className="progress-bar bg-warning" style={{ width: `${capacity.booked / capacity.total * 100}%` }} />
      <div className="progress-bar bg-success" style={{ width: `${(capacity.available ?? 0) / capacity.total * 100}%` }} />
    </div>
    <p className="form-text">Merah: Used · Kuning: Booked · Hijau: Available. Diperbarui setelah transaksi dan setiap 15 detik. Booking tidak mengubah total core atau metadata fisik.</p>
  </section>
}
function CapacityEditor({ segment }: { segment: Segment }) {
  const [core, setCore] = useState(segment.installedCoreCount?.toString() ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const update = useDomainMutation(() => atlasApi.network.update(segment.id, segment.version, { installedCoreCount: Number(core), capacityValidated: true }))
  return <details className="mb-3" open={!segment.capacityValidated}>
    <summary>Isi / validasi kapasitas untuk booking</summary>
    <form onSubmit={(event) => { event.preventDefault(); if (confirmed && !update.isPending) update.mutate() }}>
      <p className="form-text">Isi total core berdasarkan data fisik yang diverifikasi, bukan jumlah core yang ingin dipesan. Pemakaian existing harus tercatat pada ledger Used sebelum menerima booking; Available berasal dari pencatatan sistem.</p>
      <Field name={`capacity-core-${segment.id}`} label="Total core untuk booking" value={core} onChange={setCore} type="number" min={Math.max(1, segment.capacity.used + segment.capacity.booked)} max={1_000_000} step="1" />
      <label className="form-check mb-3"><input className="form-check-input" type="checkbox" checked={confirmed} required onChange={(event) => setConfirmed(event.target.checked)} />Saya sudah memverifikasi total core dan pencatatan pemakaian existing.</label>
      <button className="btn btn-outline-primary" disabled={!confirmed || !core || update.isPending}>Simpan kapasitas tervalidasi</button>
      <MutationStatus mutation={update} />
    </form>
  </details>
}
function ExistingUsagePanel({ segment }: { segment: Segment }) {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const list = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'allocations', segment.id, page, pageSize), queryFn: ({ signal }) => atlasApi.capacity.allocations(segment.id, page, signal, pageSize), refetchInterval: 15_000 })
  const [closing, setClosing] = useState(''), [closeReason, setCloseReason] = useState('')
  const close = useDomainMutation(() => atlasApi.capacity.deallocate(closing, closeReason))
  return <section aria-label="Pencatatan Used existing" className="mt-3">
    <h5>Pemakaian core tercatat (Used)</h5>
    <p className="form-text">Used berasal dari alokasi aktif, termasuk pemakaian sebelum aplikasi. Jangan catat ulang pemakaian yang sudah ada pada ledger ini.</p>
    <QueryState query={list} empty={list.data?.data.length === 0} emptyMessage="Belum ada Used tercatat. Ini bukan bukti pemakaian fisik nol.">
      <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Sumber</th><th>Core</th><th>Referensi</th><th>Aksi</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}>
        <td>{row.sourceBookingId ? 'Aktivasi booking' : 'Used existing'}</td><td>{row.coreCount}</td><td>{row.operationalReference}<br /><small>{row.id}</small></td>
        <td>{can('allocations.write') && <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => { setClosing(row.id);setCloseReason('');close.reset() }}>Tutup alokasi {row.coreCount} core</button>}</td>
      </tr>)}</tbody></table></div>
    </QueryState>
    <Pagination page={page} meta={list.data?.meta} setPage={setPage} setPageSize={setPageSize} label="alokasi core" />
    {closing && <form onSubmit={(event) => { event.preventDefault();if (!close.isPending) close.mutate(undefined, { onSuccess: () => { setClosing('');setCloseReason('') } }) }}>
      <p className="small">Penutupan {closing} mengembalikan kapasitas Available. Pastikan pemakaian benar-benar berakhir atau catatan akan dikoreksi.</p>
      <Field name={`existing-close-${segment.id}`} label="Alasan penutupan alokasi" value={closeReason} onChange={setCloseReason} />
      <button className="btn btn-outline-danger" disabled={close.isPending}>Konfirmasi tutup alokasi</button>
      <button type="button" className="btn btn-link" disabled={close.isPending} onClick={() => setClosing('')}>Batal</button>
    </form>}
    <MutationStatus mutation={close} />
    {can('network.write') && can('allocations.write') && <ExistingUsageEditor segment={segment} />}
  </section>
}
function ExistingUsageEditor({ segment }: { segment: Segment }) {
  const [total, setTotal] = useState(segment.installedCoreCount?.toString() ?? '')
  const [used, setUsed] = useState(''), [reference, setReference] = useState(''), [reason, setReason] = useState(''), [verified, setVerified] = useState(false)
  const identity = useRef<{ payload: string; version: number; key: string } | null>(null)
  const mutation = useDomainMutation(async (input: ExistingUsageInput) => {
    const payload = JSON.stringify(input)
    if (identity.current?.payload !== payload) identity.current = { payload, version: segment.version, key: crypto.randomUUID() }
    const response = await atlasApi.capacity.recordExisting(segment.id, identity.current.version, input, identity.current.key)
    identity.current = null
    return response
  })
  const extraUsed = used === '' ? 0 : Number(used)
  const available = total ? Number(total) - segment.capacity.used - segment.capacity.booked - extraUsed : null
  return <details className="mt-3"><summary>Catat kapasitas dan Used existing yang belum tercatat</summary>
    <form onSubmit={(event) => { event.preventDefault();if (verified && !mutation.isPending) mutation.mutate({ installedCoreCount: Number(total), existingCoreCount: Number(used), operationalReference: reference, reason, verified: true }, { onSuccess: () => { setUsed('');setReference('');setReason('');setVerified(false) } }) }}>
      <fieldset disabled={mutation.isPending}>
        <p className="form-text">Isi Used existing yang belum tercatat, bukan total Used keseluruhan. Sistem menambahkannya ke Used tercatat, tanpa membuat booking. Satu catatan existing aktif per segmen; untuk koreksi, tutup catatan lama dahulu dengan alasan.</p>
        <Field name={`existing-total-${segment.id}`} label="Total core fisik terverifikasi" value={total} onChange={setTotal} type="number" min={1} max={1_000_000} step="1" />
        <Field name={`existing-used-${segment.id}`} label="Used existing belum tercatat" value={used} onChange={setUsed} type="number" min={0} max={1_000_000} step="1" />
        <p className="small">Used tercatat: {segment.capacity.used} · Booked: {segment.capacity.booked} · Perkiraan Available setelah pencatatan: {available ?? '—'}. Server memvalidasi ulang saat disimpan.</p>
        <Field name={`existing-reference-${segment.id}`} label="Referensi verifikasi pemakaian existing" value={reference} onChange={setReference} />
        <Field name={`existing-reason-${segment.id}`} label="Alasan pencatatan existing" value={reason} onChange={setReason} />
        <label className="form-check mb-3"><input className="form-check-input" type="checkbox" checked={verified} required onChange={(event) => setVerified(event.target.checked)} />Total fisik dan Used existing telah diverifikasi; pemakaian ini belum tercatat di sistem.</label>
        <button className="btn btn-primary" disabled={!verified || !total || used === '' || available === null || available < 0}>Simpan kapasitas dan Used existing</button>
      </fieldset>
      <MutationStatus mutation={mutation} />
    </form>
  </details>
}
function MetadataEditor({ segment }: { segment: Segment }) {
  const [name, setName] = useState(segment.cableName)
  const [core, setCore] = useState(segment.installedCoreCount?.toString() ?? '')
  const [validated, setValidated] = useState(segment.capacityValidated)
  const [type, setType] = useState(segment.cableType?.id ?? '')
  const [method, setMethod] = useState(segment.installationMethod ?? '')
  const [side, setSide] = useState(segment.roadSide ?? '')
  const [status, setStatus] = useState(segment.status)
  const update = useDomainMutation((fields: object) => atlasApi.network.update(segment.id, segment.version, fields))
  return <form onSubmit={(event) => { event.preventDefault(); if (!update.isPending) update.mutate({ cableName: name, ...(core ? { installedCoreCount: Number(core) } : {}), capacityValidated: validated, cableTypeId: type || null, installationMethod: method || null, roadSide: side || null, status }) }}>
    <h5>Edit metadata · versi {segment.version}</h5><Field label="Nama kabel" name="edit-cable-name" value={name} onChange={setName} /><Field label="Total core terpasang" name="edit-core" type="number" value={core} onChange={setCore} min={1} step="1" required={false} />
    <label className="form-check mb-3"><input className="form-check-input" type="checkbox" checked={validated} onChange={(event) => setValidated(event.target.checked)} />Kapasitas sudah tervalidasi</label>
    <Field label="ID master tipe kabel (kosong = hapus referensi)" name="edit-cable-type" value={type} onChange={setType} required={false} />
    <label className="form-label" htmlFor="edit-method">Metode instalasi</label><select id="edit-method" className="form-select mb-3" value={method} onChange={(event) => setMethod(event.target.value)}><option value="">Belum diketahui</option><option value="AERIAL">Aerial</option><option value="BURIAL">Burial</option></select>
    <label className="form-label" htmlFor="edit-side">Sisi jalan</label><select id="edit-side" className="form-select mb-3" value={side} onChange={(event) => setSide(event.target.value)}><option value="">Belum diketahui</option><option value="LEFT">Kiri</option><option value="RIGHT">Kanan</option></select>
    <label className="form-label" htmlFor="edit-status">Status segmen</label><select id="edit-status" className="form-select mb-3" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option></select>
    <button className="btn btn-primary" disabled={update.isPending}>Simpan metadata</button><MutationStatus mutation={update} />
  </form>
}
function NameHistoryPanel({ id }: { id: string }) {
  const { entity, user } = useEntityScope()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'name-history', id, page, pageSize), queryFn: ({ signal }) => atlasApi.network.nameHistory(id, page, signal, pageSize) })
  return <details className="mt-3"><summary>Histori perubahan nama</summary><QueryState query={query} empty={query.data?.data.length === 0}><ul>{query.data?.data.map((row) => <li key={row.id}>{row.oldName} → {row.newName} · policy {row.policyVersion} · {dateLabel(row.createdAt)} · {row.actorId}</li>)}</ul></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} setPageSize={setPageSize} label="histori nama" /></details>
}
