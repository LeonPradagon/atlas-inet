import { useId, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import type { AnalysisPolicy, BookingPolicy, NamingPolicy, PolicyChangeRequest } from '../shared/domain-types'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Field, MutationStatus, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
export function SettingsPage() {
  return <>
    <div className="alert alert-info">Perubahan kebijakan memerlukan pemeriksa berbeda dari pengaju. Booking/naming diperiksa penanggung jawab operasional; formula/radius oleh engineering. Nama role dapat diganti tanpa mengubah aturan permission. Admin tidak dapat menyetujui pengajuannya sendiri.</div>
    <PolicyRequestsPanel />
    <PolicyCard<BookingPolicy> policyKey="booking-policy" title="Masa berlaku booking" fields={(value, set) => <>
      <Field label="Lama berlaku" name="policy-duration" type="number" min={1} max={1200} step="1" value={String(value.duration)} onChange={(duration) => set({ ...value, duration: Number(duration) })} />
      <label className="form-label" htmlFor="policy-unit">Satuan</label><select id="policy-unit" className="form-select mb-3" value={value.unit} onChange={(event) => set({ ...value, unit: event.target.value as BookingPolicy['unit'] })}><option value="MONTH">Bulan kalender</option><option value="DAY">Hari</option></select><p className="small">Asia/Jakarta; policy baru tidak mengubah expiry booking existing.</p>
    </>} />
    <PolicyCard<NamingPolicy> policyKey="naming-policy" title="Standar nama kabel resmi" fields={(value, set) => <>
      <Field name="policy-pattern" label="Pola regex RE2 perusahaan (full match)" value={value.pattern ?? ''} onChange={(pattern) => set({ ...value, pattern: pattern || null })} required={value.approved} />
      <label className="form-check"><input className="form-check-input" type="checkbox" checked={value.approved} onChange={(event) => set({ ...value, approved: event.target.checked })} />Usulkan aktivasi standar nama setelah approval</label><p className="form-text">Ini bukan persetujuan pengaju. Unik per entitas; tidak menyediakan pola resmi rekaan dan tidak otomatis mengganti nama lama.</p>
    </>} />
    <PolicyCard<AnalysisPolicy> policyKey="analysis-policy" title="Radius dan formula estimasi" fields={(value, set) => <>
      <Field name="policy-radius" label="Radius analisis (m)" type="number" min={1} max={100_000} step="1" value={String(value.radiusM)} onChange={(radius) => set({ ...value, radiusM: Number(radius) })} />
      {([['slackPercent', 'Slack (%)', 100], ['extraLengthM', 'Extra kabel (m)', 10_000], ['maxDetourPercent', 'Batas detour (%)', 1000]] as const).map(([key, label, max]) => <Field key={key} name={`policy-${key}`} label={label} type="number" min={0} max={max} step="any" required={value.formulaApproved} value={value[key]?.toString() ?? ''} onChange={(input) => set({ ...value, [key]: input === '' ? null : Number(input) })} />)}
      <label className="form-check"><input className="form-check-input" type="checkbox" checked={value.formulaApproved} onChange={(event) => set({ ...value, formulaApproved: event.target.checked })} />Usulkan aktivasi formula setelah approval engineering</label><p className="form-text">Kelas jalan dan kelayakan dikelola provider internal; semua hasil tetap membutuhkan survei.</p>
    </>} />
  </>
}
function PolicyCard<T>({ policyKey, title, fields }: { policyKey: string; title: string; fields: (value: T, set: (value: T) => void) => ReactNode }) {
  const { entity, user, can } = useEntityScope()
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'settings', policyKey), queryFn: ({ signal }) => atlasApi.settings.get<T>(entity!.id, policyKey, signal), enabled: Boolean(entity) && can('settings.read') })
  return <ContentCard title={title}><QueryState query={query}>{query.data && <PolicyEditor key={query.data.data.version} policyKey={policyKey} initial={query.data.data.value} version={query.data.data.version} fields={fields} />}</QueryState></ContentCard>
}
function PolicyEditor<T>({ policyKey, initial, version, fields }: { policyKey: string; initial: T; version: number; fields: (value: T, set: (value: T) => void) => ReactNode }) {
  const { entity, can } = useEntityScope()
  const [value, setValue] = useState(initial)
  const [reason, setReason] = useState('')
  const submission = useRef<{ payload: string; key: string } | null>(null)
  const mutation = useDomainMutation(() => {
    const payload = JSON.stringify({ version, value, reason: reason.trim() })
    if (submission.current?.payload !== payload) submission.current = { payload, key: crypto.randomUUID() }
    return atlasApi.settings.propose(entity!.id, policyKey, version, value, reason.trim(), submission.current.key)
  })
  return <form onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate() }}>
    <p className="small">Kebijakan aktif: versi {version}. Form berikut merupakan usulan; submit tidak mengaktifkan perubahan.</p>
    <details className="mb-3"><summary>Lihat nilai aktif</summary><pre className="small">{JSON.stringify(initial, null, 2)}</pre></details>
    <fieldset disabled={!can('settings.write') || mutation.isPending}>{fields(value, (next) => { setValue(next); mutation.reset() })}
      {can('settings.write') && <><Field name={`request-reason-${policyKey}`} label="Alasan perubahan kebijakan" value={reason} onChange={(next) => { setReason(next); mutation.reset() }} /><button className="btn btn-primary mt-3" disabled={mutation.isSuccess}>Ajukan perubahan untuk approval</button></>}
    </fieldset>
    {!mutation.isSuccess && <MutationStatus mutation={mutation} />}
    {mutation.data && <div className="alert alert-info mt-3" role="status">Pengajuan {mutation.data.data.id}: {mutation.data.data.status}. {mutation.data.data.status === 'PENDING' ? 'Kebijakan aktif belum berubah; menunggu pemeriksa yang berbeda.' : 'Lihat histori keputusan dan kebijakan aktif dari server.'}</div>}
  </form>
}

const policyLabels: Record<string, string> = { 'booking-policy': 'Masa berlaku booking', 'naming-policy': 'Standar nama kabel', 'analysis-policy': 'Radius / formula engineering' }
function PolicyRequestsPanel() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1), [status, setStatus] = useState('PENDING')
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'policy-requests', page, status), queryFn: ({ signal }) => atlasApi.settings.requests(entity!.id, page, status, signal), enabled: Boolean(entity) && can('settings.read') })
  return <ContentCard title="Pengajuan dan histori approval" tools={<select className="form-select form-select-sm" aria-label="Filter status approval" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}><option value="">Semua status</option>{['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((value) => <option key={value}>{value}</option>)}</select>}>
    <QueryState query={query} empty={query.data?.data.length === 0}><div className="table-responsive"><table className="table align-middle"><thead><tr><th>Kebijakan / pengajuan</th><th>Perubahan</th><th>Status / aksi</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.id}>
      <td>{policyLabels[row.key] ?? row.key}<br /><small>Base versi {row.baseVersion} · {dateLabel(row.createdAt)}</small><p className="small text-break mb-0">Pengaju: {row.requestedBy}<br />{row.reason}<br /><code>{row.id}</code></p></td>
      <td><details><summary>Bandingkan nilai sebelum / usulan</summary><div className="row"><div className="col-md-6"><strong>Sebelum · v{row.baseVersion}</strong><pre className="small">{row.baseValue ? JSON.stringify(row.baseValue, null, 2) : 'Tidak tersedia'}</pre></div><div className="col-md-6"><strong>Usulan</strong><pre className="small">{JSON.stringify(row.proposedValue, null, 2)}</pre></div></div></details></td>
      <td><strong>{row.status}</strong>{row.approvedVersion !== null && <span> · diterapkan v{row.approvedVersion}</span>}
        {row.status === 'PENDING' && (row.requestedBy === user?.id ? <><p className="small">Tidak dapat menyetujui pengajuan sendiri.</p>{can('settings.write') && <PolicyDecision row={row} action="cancel" />}</> : can(row.key === 'analysis-policy' ? 'settings.approve-engineering' : 'settings.approve-operational') ? <><PolicyDecision row={row} action="approve" /><PolicyDecision row={row} action="reject" /></> : <p className="small">Menunggu pemeriksa berizin sesuai jenis kebijakan.</p>)}
        {row.decidedBy && <p className="small text-break mb-0">Keputusan oleh {row.decidedBy}<br />{row.decisionReason}<br />{row.decidedAt && dateLabel(row.decidedAt)}</p>}
      </td>
    </tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} />
    <p className="form-text mt-3">Pengajuan stale tidak dapat disetujui. Batalkan/tolak lalu ajukan ulang berdasarkan versi aktif. Alasan keputusan wajib dan histori tidak ditimpa.</p>
  </ContentCard>
}
function PolicyDecision({ row, action }: { row: PolicyChangeRequest; action: 'approve' | 'reject' | 'cancel' }) {
  const id = useId(), [reason, setReason] = useState('')
  const label = { approve: 'Setujui dan aktifkan', reject: 'Tolak pengajuan', cancel: 'Batalkan pengajuan' }[action]
  const mutation = useDomainMutation(() => atlasApi.settings.decide(row.id, action, reason.trim()))
  return <details className="mt-2"><summary>{label}</summary><form onSubmit={(event) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate() }}><fieldset disabled={mutation.isPending}><Field name={id} label={`Alasan: ${label}`} value={reason} onChange={setReason} /><button className={`btn btn-sm ${action === 'approve' ? 'btn-primary' : 'btn-outline-danger'}`}>Konfirmasi {label.toLowerCase()}</button></fieldset><MutationStatus mutation={mutation} /></form></details>
}
