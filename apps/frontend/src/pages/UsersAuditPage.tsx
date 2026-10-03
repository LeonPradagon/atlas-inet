import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Pagination, QueryState } from '../components/DomainUi'
export function UsersAuditPage() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'audit', page), queryFn: ({ signal }) => atlasApi.audit(entity!.id, page, signal), enabled: Boolean(entity) && can('audit.read') })
  return <><div className="alert alert-info">Administrasi akun/role masih melalui CLI backend berwenang. Tidak ada create user atau grant otomatis dari halaman ini.</div><ContentCard title="Audit entitas"><QueryState query={query} empty={query.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Resource / detail</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.id}><td>{dateLabel(row.created_at)}</td><td>{row.actor}</td><td>{row.action}</td><td className="text-break">{row.resource}<details><summary>Detail audit</summary><pre className="small">{JSON.stringify(row.details, null, 2)}</pre></details></td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} /></ContentCard></>
}
