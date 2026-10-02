import { useState, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'
import { FormStatus } from '../components/FormStatus'

export function BookingsPage() {
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'info' | 'warning'>('info')

  function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const segment = String(data.get('segment') ?? '').trim()
    const customer = String(data.get('customer') ?? '').trim()
    const customerPic = String(data.get('customerPic') ?? '').trim()
    const customerPicContact = String(data.get('customerPicContact') ?? '').trim()
    const presalesPic = String(data.get('presalesPic') ?? '').trim()
    const reason = String(data.get('reason') ?? '').trim()
    const cores = Number(data.get('cores'))
    if (!segment || !customer || !customerPic || !customerPicContact || !presalesPic || !reason || !Number.isInteger(cores) || cores < 1) {
      setTone('warning')
      setMessage('Lengkapi segmen, customer, PIC beserta kontaknya, PIC Presales, kebutuhan, dan jumlah core positif.')
      return
    }
    setTone('info')
    setMessage('Form valid. Booking belum disimpan karena layanan API belum tersedia.')
  }

  return (
    <div className="row">
      <div className="col-xl-8">
        <ContentCard title="Ajukan booking core">
            <p className="text-secondary">Booking berlaku default 1 bulan. Periode final mengikuti kebijakan CMS yang disetujui.</p>
            <form onSubmit={submitBooking} noValidate>
              <div className="row">
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-segment">Segmen jaringan</label><input className="form-control" id="booking-segment" name="segment" placeholder="ID atau nama segmen" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-customer">Nama customer</label><input className="form-control" id="booking-customer" name="customer" autoComplete="organization" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-customer-pic">PIC customer</label><input className="form-control" id="booking-customer-pic" name="customerPic" autoComplete="name" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-customer-contact">Kontak PIC customer</label><input className="form-control" id="booking-customer-contact" name="customerPicContact" type="text" autoComplete="tel" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-presales-pic">PIC Presales</label><input className="form-control" id="booking-presales-pic" name="presalesPic" autoComplete="name" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-cores">Jumlah core</label><input className="form-control" id="booking-cores" name="cores" type="number" min="1" step="1" required /></div>
                <div className="col-md-6 mb-3"><label className="form-label" htmlFor="booking-reason">Kebutuhan / alasan</label><input className="form-control" id="booking-reason" name="reason" required /></div>
              </div>
              <button className="btn btn-primary" type="submit"><i className="bi bi-bookmark-check me-1" aria-hidden="true" />Validasi pengajuan</button>
              <FormStatus message={message} tone={tone} />
            </form>
        </ContentCard>
      </div>
      <div className="col-xl-4">
        <ContentCard title="Kapasitas segmen">
          <EmptyState icon="bi-hdd-network" title="Pilih segmen" detail="Used, Available, Booked, dan Waiting List akan ditampilkan setelah data kapasitas tersedia." />
        </ContentCard>
      </div>
    </div>
  )
}
