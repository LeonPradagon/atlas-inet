import { useState, type FormEvent } from 'react'

export function SettingsPage() {
  const [message, setMessage] = useState('')

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const duration = Number(data.get('duration'))
    const radius = Number(data.get('radius'))
    const detour = String(data.get('detour') ?? '')
    if (!Number.isInteger(duration) || duration < 1 || !Number.isFinite(radius) || radius <= 0 || (detour && (Number(detour) < 0 || Number(detour) > 100))) {
      setMessage('Periksa masa berlaku, radius positif, dan toleransi detour antara 0–100%.')
      return
    }
    setMessage('Input valid, tetapi belum disimpan. API pengaturan belum tersedia dan kebijakan rute/nama masih perlu persetujuan bisnis.')
  }

  return (
    <section className="card">
      <div className="card-header"><h3 className="card-title">Kebijakan sistem</h3><div className="card-tools"><span className="badge text-bg-secondary">Usulan / validasi bisnis</span></div></div>
      <div className="card-body">
        <form onSubmit={saveSettings} noValidate>
          <h4>Masa berlaku booking</h4>
          <div className="row">
            <div className="col-md-4 mb-3"><label className="form-label" htmlFor="setting-duration">Lama berlaku</label><input className="form-control" id="setting-duration" name="duration" type="number" min="1" defaultValue="1" required /></div>
            <div className="col-md-4 mb-3"><label className="form-label" htmlFor="setting-duration-unit">Satuan</label><select className="form-select" id="setting-duration-unit" name="durationUnit" defaultValue="MONTH"><option value="DAY">Hari</option><option value="MONTH">Bulan</option></select></div>
            <div className="col-md-4 mb-3"><label className="form-label" htmlFor="setting-radius">Radius analisis (meter)</label><input className="form-control" id="setting-radius" name="radius" type="number" min="1" placeholder="Usulan: 5000" defaultValue="5000" required /><div className="form-text">Nilai radius masih usulan PRD.</div></div>
          </div>
          <hr />
          <h4>Kebijakan rute kabel</h4>
          <p className="text-secondary">Kelas jalan prioritas dan batas detour harus disetujui Presales/Network sebelum dipakai.</p>
          <div className="row">
            <div className="col-md-6 mb-3"><label className="form-label" htmlFor="setting-road-classes">Kelas jalan prioritas</label><input className="form-control" id="setting-road-classes" name="roadClasses" placeholder="Menunggu keputusan D-02" /><div className="form-text">Contoh nilai final mengikuti sumber data jalan yang disetujui.</div></div>
            <div className="col-md-6 mb-3"><label className="form-label" htmlFor="setting-detour">Batas tambahan jarak (%)</label><input className="form-control" id="setting-detour" name="detour" type="number" min="0" max="100" placeholder="Belum ditetapkan" /></div>
          </div>
          <hr />
          <h4>Standar nama kabel</h4>
          <div className="mb-3"><label className="form-label" htmlFor="setting-cable-pattern">Pola nama resmi</label><input className="form-control" id="setting-cable-pattern" name="cablePattern" placeholder="Menunggu standar perusahaan" /><div className="form-text">Pola resmi belum diberikan di BRD.</div></div>
          <button className="btn btn-primary" type="submit"><i className="bi bi-check2-circle me-1" aria-hidden="true" />Validasi pengaturan</button>
          {message && <div className={`alert ${message.startsWith('Input valid') ? 'alert-info' : 'alert-warning'} mt-3 mb-0`} role="status">{message}</div>}
        </form>
      </div>
    </section>
  )
}
