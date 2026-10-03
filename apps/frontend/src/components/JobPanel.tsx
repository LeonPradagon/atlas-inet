import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS, ApiError, atlasApi, downloadFile } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from './ContentCard'
import { Field, MutationStatus, Pagination, QueryState, useDomainMutation } from './DomainUi'

export function JobPanel({ id, onChange }: { id: string; onChange: (id: string) => void }) {
  const { entity, user } = useEntityScope()
  const [page, setPage] = useState(1)
  const [entered, setEntered] = useState(id)
  const job = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'job', id), queryFn: async ({ signal }) => {
    const response = await atlasApi.jobs.get(id, signal)
    if (response.data.entityId !== entity!.id) throw new ApiError('Job berada di entitas lain. Pilih entitas pemilik.', 403)
    return response
  }, enabled: Boolean(id && entity && user), refetchInterval: (query) => query.state.status === 'error' ? false : !query.state.data || ['QUEUED', 'RUNNING'].includes(query.state.data.data.status) ? 2000 : false })
  const rows = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'job-rows', id, page, job.data?.data.completed), queryFn: ({ signal }) => atlasApi.jobs.rows(id, page, signal), enabled: Boolean(id && entity && user) && job.data?.data.type === 'ANALYSIS' })
  const cancel = useDomainMutation(() => atlasApi.jobs.cancel(id))
  const retry = useDomainMutation(() => atlasApi.jobs.retry(id))
  const download = useDomainMutation(() => downloadFile(`${API_ENDPOINTS.jobs}/${encodeURIComponent(id)}/result`, `atlas-${id}.xlsx`))
  const state = job.data?.data
  return <ContentCard title="Status job / hasil Excel"><form className="d-flex align-items-end gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); onChange(entered) }}><div className="flex-grow-1"><Field label="ID job tersimpan" name="lookup-job-id" value={entered} onChange={setEntered} /></div><button className="btn btn-outline-primary mb-3">Buka job</button></form>
    {id && <QueryState query={job}>{state && <>
      <p className="text-break"><code>{id}</code> · <strong>{state.status}</strong></p><p>{state.completed}/{state.total} selesai · {state.succeeded} sukses · {state.failed} gagal.</p>
      {state.error && <div className="alert alert-danger">{state.error}</div>}
      {['QUEUED', 'RUNNING'].includes(state.status) && <><p className="small text-secondary">Worker backend harus berjalan pada proses terpisah. Polling tidak menjalankan job.</p><button className="btn btn-outline-danger" disabled={cancel.isPending || Boolean(state.cancelRequestedAt)} onClick={() => cancel.mutate()}>{state.cancelRequestedAt ? 'Pembatalan menunggu checkpoint' : 'Batalkan job'}</button></>}
      {['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(state.status) && <button className="btn btn-primary me-2" disabled={download.isPending} onClick={() => download.mutate()}>Unduh hasil XLSX</button>}
      {state.type === 'ANALYSIS' && ['FAILED', 'COMPLETED_WITH_ERRORS'].includes(state.status) && <button className="btn btn-outline-primary" disabled={retry.isPending} onClick={() => retry.mutate(undefined, { onSuccess: (response) => { setEntered(response.data.id); setPage(1); onChange(response.data.id) } })}>Retry kegagalan sementara saja</button>}
    </>}</QueryState>}
    {state?.type === 'ANALYSIS' && <><QueryState query={rows} empty={rows.data?.data.length === 0}><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Baris</th><th>Reference</th><th>Status / error</th></tr></thead><tbody>{rows.data?.data.map((row) => <tr key={row.id}><td>{row.rowNumber}</td><td>{row.referenceId}</td><td>{row.error ?? row.result?.status ?? 'Menunggu'}</td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={rows.data?.meta} setPage={setPage} /></>}
    <MutationStatus mutation={cancel} /><MutationStatus mutation={retry} /><MutationStatus mutation={download} />
  </ContentCard>
}
