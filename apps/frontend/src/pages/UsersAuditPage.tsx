import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Pagination, QueryState } from '../components/DomainUi'

type AuditFilters = { search: string; action: string; from: string; to: string }
const emptyFilters: AuditFilters = { search: '', action: '', from: '', to: '' }

export function UsersAuditPage() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters)
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters)
  const query = useQuery({
    queryKey: domainKey(entity?.id, user?.id, 'audit', page, pageSize, filters),
    queryFn: ({ signal }) => atlasApi.audit(entity!.id, page, {
      search: filters.search || undefined,
      action: filters.action || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }, signal, pageSize),
    enabled: Boolean(entity) && can('audit.read'),
  })

  function updateDraft(field: keyof AuditFilters, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draft })
  }

  function clearFilters() {
    setDraft(emptyFilters)
    setFilters(emptyFilters)
    setPage(1)
  }

  return <ContentCard title="Audit log entitas" tools={<button className="btn btn-outline-secondary btn-sm" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>
    <i className={`bi ${query.isFetching ? 'bi-arrow-repeat' : 'bi-arrow-clockwise'} me-1`} aria-hidden="true" />Muat ulang
  </button>}>
    <p className="text-secondary small">Riwayat perubahan berhasil pada entitas ini. Detail dibatasi agar tidak menampilkan data customer atau kontak.</p>
    <form className="row g-2 align-items-end mb-3" onSubmit={applyFilters}>
      <div className="col-12 col-lg-4"><label className="form-label" htmlFor="audit-search">Cari aktor, aksi, resource, detail</label><input id="audit-search" className="form-control" value={draft.search} maxLength={200} onChange={(event) => updateDraft('search', event.target.value)} /></div>
      <div className="col-12 col-sm-6 col-lg-2"><label className="form-label" htmlFor="audit-action">Filter aksi</label><input id="audit-action" className="form-control" value={draft.action} maxLength={100} placeholder="Contoh: BOOKING" onChange={(event) => updateDraft('action', event.target.value)} /></div>
      <div className="col-6 col-lg-2"><label className="form-label" htmlFor="audit-from">Dari tanggal</label><input id="audit-from" className="form-control" type="date" value={draft.from} onChange={(event) => updateDraft('from', event.target.value)} /></div>
      <div className="col-6 col-lg-2"><label className="form-label" htmlFor="audit-to">Sampai tanggal</label><input id="audit-to" className="form-control" type="date" value={draft.to} onChange={(event) => updateDraft('to', event.target.value)} /></div>
      <div className="col-12 col-lg-2 d-flex gap-2"><button className="btn btn-primary" type="submit">Terapkan</button><button className="btn btn-outline-secondary" type="button" onClick={clearFilters}>Reset</button></div>
    </form>
    <QueryState query={query} empty={query.data?.data.length === 0} emptyMessage="Tidak ada log yang cocok dengan filter ini.">
      <div className="table-responsive"><table className="table table-striped align-middle">
        <thead><tr><th>Waktu</th><th>Aktor / sumber</th><th>Aksi</th><th>Resource</th><th>Detail</th></tr></thead>
        <tbody>{query.data?.data.map((row) => <tr key={row.id}>
          <td className="text-nowrap">{dateLabel(row.created_at)}</td>
          <td className="text-break">{row.actor || '—'}</td>
          <td className="text-nowrap"><code>{row.action}</code></td>
          <td className="text-break">{row.resource || '—'}</td>
          <td className="text-break"><details><summary>Lihat detail</summary><pre className="small mt-2 mb-0">{JSON.stringify(row.details, null, 2)}</pre></details></td>
        </tr>)}</tbody>
      </table></div>
    </QueryState>
    <Pagination page={page} meta={query.data?.meta} setPage={setPage} setPageSize={setPageSize} label="audit log" />
  </ContentCard>
}
