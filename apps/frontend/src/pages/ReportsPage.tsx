import { useState, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'
import { FormStatus } from '../components/FormStatus'

export function ReportsPage() {
  const [message, setMessage] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (startDate && endDate && startDate > endDate) {
      setMessage('Tanggal mulai harus sama dengan atau sebelum tanggal akhir.')
      return
    }
    setMessage('Filter valid. Data laporan belum tersedia dari API.')
  }

  return (
    <>
      <ContentCard title="Filter monitoring">
          <form className="row align-items-end" onSubmit={applyFilters}>
            <div className="col-md-4 mb-3"><label className="form-label" htmlFor="report-start">Dari tanggal</label><input className="form-control" id="report-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
            <div className="col-md-4 mb-3"><label className="form-label" htmlFor="report-end">Sampai tanggal</label><input className="form-control" id="report-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
            <div className="col-md-4 mb-3"><button className="btn btn-primary" type="submit"><i className="bi bi-funnel me-1" aria-hidden="true" />Terapkan filter</button></div>
          </form>
          <FormStatus message={message} tone={message.startsWith('Filter valid') ? 'info' : 'warning'} />
      </ContentCard>
      <ContentCard title="Utilisasi core" tools={<button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setExportMessage('Export belum tersedia karena data laporan dan API belum tersedia.')}><i className="bi bi-download me-1" aria-hidden="true" />Export</button>}>
        <EmptyState icon="bi-bar-chart" title="Belum ada data monitoring" detail="Ringkasan Used, Booked, Available, Idle, dan Waiting List akan muncul dari dataset API." />{exportMessage && <FormStatus message={exportMessage} />}
      </ContentCard>
    </>
  )
}
