import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { MutationStatus, numberLabel, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { JobPanel } from '../components/JobPanel'
import { SegmentDetail } from '../components/SegmentTools'
export function ReportsPage() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1), [jobId, setJobId] = useState(''), [segmentId, setSegmentId] = useState('')
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'utilization', page), queryFn: ({ signal }) => atlasApi.reports.utilization(entity!.id, page, signal), enabled: Boolean(entity) && can('reports.read') })
  const exportJob = useDomainMutation(() => atlasApi.reports.export(entity!.id))
  return <>
    <ContentCard title="Monitoring utilisasi saat ini" tools={can('reports.export') && <button className="btn btn-primary btn-sm" disabled={exportJob.isPending} onClick={() => exportJob.mutate(undefined, { onSuccess: (response) => setJobId(response.data.id) })}>Buat snapshot export</button>}>
      <p className="small text-secondary">Snapshot: {query.data?.meta?.asOf ?? 'Belum dimuat'} · {entity?.name}. Filter historis periode belum tersedia. Export maksimal 10.000 segmen.</p>
      {can('reports.read') && <><QueryState query={query} empty={query.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Segmen</th><th>Total</th><th>Used</th><th>Booked</th><th>Idle</th><th>Available</th><th>Waiting</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.segmentId}><td><button className="btn btn-link p-0" onClick={() => setSegmentId(row.segmentId)}>{row.segmentCode} · {row.cableName}</button></td>{(['total', 'used', 'booked', 'idle', 'available'] as const).map((field) => <td key={field}>{numberLabel(row[field])}</td>)}<td>{row.waitingCount} permintaan / {row.waitingCores} core</td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} /></>}
      <MutationStatus mutation={exportJob} />
    </ContentCard>
    {segmentId && can('network.read') && <SegmentDetail id={segmentId} />}
    {can('reports.export') && <JobPanel key={jobId || 'lookup'} id={jobId} onChange={setJobId} />}
  </>
}
