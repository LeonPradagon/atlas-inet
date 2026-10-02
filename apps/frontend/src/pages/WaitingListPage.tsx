import { useState, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'
import { FormStatus } from '../components/FormStatus'

export function WaitingListPage() {
  const [filter, setFilter] = useState('ALL')
  const [message, setMessage] = useState('')

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const required = ['segment', 'customer', 'pic', 'cores'].every((key) => String(data.get(key) ?? '').trim())
    const cores = Number(data.get('cores'))
    if (!required || !Number.isInteger(cores) || cores < 1) {
      setMessage('Lengkapi semua field wajib dan masukkan jumlah core positif.')
      return
    }
    setMessage('Form valid. Permintaan belum disimpan karena layanan API belum tersedia.')
  }

  return (
    <>
      <ContentCard title="Permintaan waiting list">
          <form className="row align-items-end" onSubmit={submitRequest} noValidate>
            <div className="col-md-3 mb-3"><label className="form-label" htmlFor="wait-segment">Segmen</label><input className="form-control" id="wait-segment" name="segment" required /></div>
            <div className="col-md-3 mb-3"><label className="form-label" htmlFor="wait-customer">Customer</label><input className="form-control" id="wait-customer" name="customer" required /></div>
            <div className="col-md-3 mb-3"><label className="form-label" htmlFor="wait-pic">PIC / kontak</label><input className="form-control" id="wait-pic" name="pic" required /></div>
            <div className="col-md-2 mb-3"><label className="form-label" htmlFor="wait-cores">Core</label><input className="form-control" id="wait-cores" name="cores" type="number" min="1" step="1" required /></div>
            <div className="col-md-1 mb-3"><button className="btn btn-primary w-100" type="submit" aria-label="Validasi permintaan waiting list"><i className="bi bi-plus-lg" aria-hidden="true" /></button></div>
          </form>
          <FormStatus message={message} tone={message.startsWith('Form valid') ? 'info' : 'warning'} />
      </ContentCard>
      <ContentCard title="Antrean per segmen" tools={<select className="form-select form-select-sm" aria-label="Filter status antrean" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Semua status</option><option value="WAITING">Waiting</option><option value="ALLOCATED">Allocated</option><option value="CANCELLED">Cancelled</option></select>}>
        <EmptyState icon="bi-list-ol" title="Belum ada permintaan" detail={`Tidak ada antrean${filter === 'ALL' ? '' : ` dengan status ${filter}`} pada data yang tersedia.`} />
      </ContentCard>
    </>
  )
}
