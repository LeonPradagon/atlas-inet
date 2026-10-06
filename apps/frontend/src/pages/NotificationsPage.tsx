import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, MutationStatus, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { SegmentDetail } from '../components/SegmentTools'
import { Link } from '@tanstack/react-router'
export function NotificationsPage() {
  const { entity, user, can } = useEntityScope()
  const [page, setPage] = useState(1), [unread, setUnread] = useState(false), [segment, setSegment] = useState('')
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'notifications', page), queryFn: ({ signal }) => atlasApi.notifications.list(entity!.id, page, signal), enabled: Boolean(entity) && can('notifications.read'), refetchInterval: 30_000 })
  const mark = useDomainMutation((id: string) => atlasApi.notifications.read(id))
  const rows = query.data?.data.filter((row) => !unread || !row.readAt)
  return <><ContentCard title="Notifikasi milik Anda" tools={<label><input type="checkbox" checked={unread} onChange={(event) => setUnread(event.target.checked)} /> Belum dibaca di halaman ini</label>}>
    <p className="text-secondary small">Notifikasi diperbarui realtime saat terhubung; polling 30 detik menjadi fallback jika koneksi terputus.</p>
    <QueryState query={query} empty={rows?.length === 0}><ul className="list-group">{rows?.map((row) => <li className="list-group-item" key={row.id}><strong>{row.type}</strong> · {row.readAt ? 'Sudah dibaca' : 'Belum dibaca'}<p className="small mb-2">{dateLabel(row.createdAt)} · {row.type.startsWith('POLICY_CHANGE_') ? `${row.payload.key ?? ''} · ${row.payload.status ?? ''}` : `Core: ${row.payload.coreCount ?? '—'}`} · {row.payload.reason ?? ''}</p>{row.payload.segmentId && can('network.read') && <button className="btn btn-outline-primary btn-sm me-2" onClick={() => setSegment(row.payload.segmentId!)}>Buka segmen</button>}{row.type.startsWith('POLICY_CHANGE_') && can('settings.read') && <Link to="/settings" className="btn btn-outline-primary btn-sm me-2">Buka approval kebijakan</Link>}{!row.readAt && <button className="btn btn-primary btn-sm" disabled={mark.isPending} onClick={() => mark.mutate(row.id)}>Tandai dibaca</button>}</li>)}</ul></QueryState>
    <Pagination page={page} meta={query.data?.meta} setPage={setPage} /><MutationStatus mutation={mark} />
  </ContentCard>{segment && <SegmentDetail id={segment} />}</>
}
