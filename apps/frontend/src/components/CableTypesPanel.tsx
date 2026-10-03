import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from './ContentCard'
import { Field, MutationStatus, Pagination, QueryState, useDomainMutation } from './DomainUi'

export function CableTypesPanel() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1), [code, setCode] = useState(''), [name, setName] = useState('')
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'cable-types', page), queryFn: ({ signal }) => atlasApi.network.types(entity!.id, page, signal), enabled: Boolean(entity) && can('network.read') })
  const create = useDomainMutation(() => atlasApi.network.createType(entity!.id, code.trim(), name.trim()))
  return <ContentCard title="Master tipe kabel"><p className="small">Katalog global, immutable. Isi kode/nama perusahaan yang telah disetujui; import tidak membuat tipe otomatis.</p>
    {can('network.read') && <><QueryState query={query} empty={query.data?.data.length === 0}><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Kode</th><th>Nama</th><th>ID</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td><code>{row.id}</code></td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} /></>}
    {can('network.master-write') && <form onSubmit={(event) => { event.preventDefault(); if (!create.isPending) create.mutate() }}><Field name="cable-type-code" label="Kode tipe kabel" value={code} onChange={setCode} /><Field name="cable-type-name" label="Nama tipe kabel" value={name} onChange={setName} /><button className="btn btn-primary" disabled={create.isPending}>Simpan master tipe kabel</button><MutationStatus mutation={create} />{create.data && <p>ID tipe: <code>{create.data.data.id}</code></p>}</form>}
  </ContentCard>
}
