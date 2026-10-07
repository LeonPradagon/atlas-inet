import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { dateLabel, Field, MutationStatus, numberLabel, Pagination, QueryState, useDomainMutation } from './DomainUi'
import { ContentCard } from './ContentCard'
import type { Segment } from '../shared/domain-types'

export function SegmentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segments', page), queryFn: ({ signal }) => atlasApi.network.segments(entity!.id, page, signal), enabled: Boolean(entity) && can('network.read') })
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
      <Pagination page={page} meta={query.data.meta} setPage={setPage} />
    </> : null}
  </div>
}
export function SegmentDetail({ id, editable = false, mapContext = false }: { id: string; editable?: boolean; mapContext?: boolean }) {
  const { entity, user, can } = useEntityScope()
  const [poleHeightFilter, setPoleHeightFilter] = useState('all')
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segment', id), queryFn: async ({ signal }) => {
    const response = await atlasApi.network.segment(id, signal)
    if (response.data.ownerEntityId !== entity!.id) throw new ApiError('Segmen berada di entitas lain. Pilih entitas pemilik.', 403)
    return response
  }, enabled: validId && can('network.read') })
  if (!validId || !can('network.read')) return <p className="text-secondary">Pilih ID segmen dengan izin baca untuk melihat detail kapasitas.</p>
  return <ContentCard title={mapContext ? 'Detail aset jaringan pada peta' : 'Detail segmen'}><QueryState query={query}>{query.data && <>
    <h4>{query.data.data.cableName}</h4><p className="small text-secondary">{query.data.data.segmentCode} · Dataset {query.data.data.datasetVersion} · {query.data.data.status}</p>
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
    {editable && <NameHistoryPanel id={id} />}
  </>}</QueryState></ContentCard>
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
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'name-history', id, page), queryFn: ({ signal }) => atlasApi.network.nameHistory(id, page, signal) })
  return <details className="mt-3"><summary>Histori perubahan nama</summary><QueryState query={query} empty={query.data?.data.length === 0}><ul>{query.data?.data.map((row) => <li key={row.id}>{row.oldName} → {row.newName} · policy {row.policyVersion} · {dateLabel(row.createdAt)} · {row.actorId}</li>)}</ul></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} /></details>
}
