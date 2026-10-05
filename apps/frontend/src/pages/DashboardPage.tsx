import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { numberLabel, PermissionNotice, QueryState } from '../components/DomainUi'
import { ContentCard } from '../components/ContentCard'
export function DashboardPage() {
  const { entity, user, can } = useEntityScope()
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'utilization', 1), queryFn: ({ signal }) => atlasApi.reports.utilization(entity!.id, 1, signal), enabled: Boolean(entity) && can('reports.read') })
  const summary = query.data?.meta?.summary
  const metrics = [
    { key: 'segmentCount', label: 'Total Segmen', icon: 'bi-diagram-3', color: 'text-bg-primary' },
    { key: 'total', label: 'Total Core', icon: 'bi-layers', color: 'text-bg-info' },
    { key: 'used', label: 'Used Core', icon: 'bi-check2-circle', color: 'text-bg-success' },
    { key: 'booked', label: 'Booked Core', icon: 'bi-bookmark-check', color: 'text-bg-warning' },
    { key: 'available', label: 'Available Core', icon: 'bi-circle-half', color: 'text-bg-secondary' },
  ] as const
  if (!entity) return <PermissionNotice />
  return <>
    <div className="callout callout-info"><h4>Asset Tracking &amp; Network Intelligence</h4><p>{entity.name} · data dibatasi grant entitas backend.</p></div>
    {can('reports.read') ? <QueryState query={query}><p className="small text-secondary">As-of: {query.data?.meta?.asOf}. Agregasi seluruh segmen published, bukan jumlah halaman tabel.</p>
      <div className="row">{metrics.map(({ key, label, icon, color }) => <div className="col-sm-6 col-xl" key={key}><div className="info-box"><span className={`info-box-icon ${color}`}><i className={`bi ${icon}`} aria-hidden="true" /></span><div className="info-box-content"><span className="info-box-text">{label}</span><strong className="info-box-number">{numberLabel(summary?.[key])}</strong></div></div></div>)}</div>
      {summary?.unknownCapacityCount ? <div className="alert alert-warning">{summary.unknownCapacityCount} segmen belum memiliki kapasitas tervalidasi. Total/Available tidak diasumsikan nol.</div> : null}
      {summary?.segmentCount === 0 && <p role="status">Belum ada dataset jaringan published pada entitas ini.</p>}
    </QueryState> : <p className="text-secondary">Ringkasan memerlukan permission reports.read pada entitas ini.</p>}
    <ContentCard title="Akses cepat"><div className="d-flex flex-wrap gap-2">{can('network.read') && <Link to="/network" className="btn btn-outline-primary">Peta jaringan</Link>}{(can('analysis.create') || can('analysis.bulk')) && <Link to="/analysis" className="btn btn-outline-primary">Analisis</Link>}{(can('bookings.create') || can('bookings.read')) && <Link to="/bookings" className="btn btn-outline-primary">Booking</Link>}{can('reports.read') && <Link to="/reports" className="btn btn-outline-primary">Monitoring</Link>}</div></ContentCard>
  </>
}
