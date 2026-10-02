import { useState } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'

export function NotificationsPage() {
  const [filter, setFilter] = useState('ALL')

  return (
    <ContentCard
      title="Notifikasi booking"
      tools={<select className="form-select form-select-sm" aria-label="Filter notifikasi" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Semua</option><option value="UNREAD">Belum dibaca</option></select>}
    >
      <EmptyState icon="bi-bell" title="Belum ada notifikasi" detail={filter === 'ALL' ? 'Notifikasi release dan expiry booking akan tampil di sini.' : 'Tidak ada notifikasi belum dibaca.'} />
    </ContentCard>
  )
}
