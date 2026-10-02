import { useState, type ChangeEvent, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'

type InputMode = 'address' | 'coordinates'

function isValidLatitude(value: string) {
  if (!value.trim()) return false
  const number = Number(value)
  return Number.isFinite(number) && number >= -90 && number <= 90
}

function isValidLongitude(value: string) {
  if (!value.trim()) return false
  const number = Number(value)
  return Number.isFinite(number) && number >= -180 && number <= 180
}

export function AnalysisPage() {
  const [mode, setMode] = useState<InputMode>('address')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [message, setMessage] = useState('')
  const [uploadMessage, setUploadMessage] = useState('')
  const [fileName, setFileName] = useState('')

  function handleIndividualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'address' && !address.trim()) {
      setMessage('Masukkan alamat terlebih dahulu.')
      return
    }
    if (mode === 'coordinates' && (!isValidLatitude(latitude) || !isValidLongitude(longitude))) {
      setMessage('Masukkan latitude (-90 hingga 90) dan longitude (-180 hingga 180) yang valid.')
      return
    }
    setMessage('Input valid. Analisis belum dapat dijalankan karena API geocoding dan routing belum tersambung.')
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      setFileName('')
      setUploadMessage('')
      return
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setFileName('')
      setUploadMessage('Format file belum didukung. Pilih file Excel .xlsx.')
      event.target.value = ''
      return
    }
    setFileName(`${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`)
    setUploadMessage('File baru dipilih di browser; belum diunggah karena API bulk belum tersedia.')
  }

  function handleBulkSubmit() {
    if (!fileName) {
      setUploadMessage('Pilih file Excel .xlsx terlebih dahulu.')
      return
    }
    setUploadMessage('File siap diproses. Upload belum dilakukan karena API bulk belum tersedia.')
  }

  return (
    <>
      <div className="row mb-3 align-items-center">
        <div className="col-12">
          <h4>Temukan jaringan terdekat</h4>
          <p className="text-secondary mb-0">Masukkan alamat atau koordinat untuk memulai analisis cakupan.</p>
        </div>
      </div>

      <div className="row">
        <div className="col-12 col-xl-7">
          <ContentCard title="Lokasi pelanggan" tools={<span className="badge text-bg-primary">01 · Individual</span>} className="mb-3">
              <div className="nav nav-pills mb-3" role="tablist" aria-label="Pilih jenis input">
                <button className={`nav-link ${mode === 'address' ? 'active' : ''}`} type="button" role="tab" aria-selected={mode === 'address'} onClick={() => { setMode('address'); setMessage('') }}>
                  <i className="bi bi-geo-alt me-2" aria-hidden="true" />Alamat
                </button>
                <button className={`nav-link ${mode === 'coordinates' ? 'active' : ''}`} type="button" role="tab" aria-selected={mode === 'coordinates'} onClick={() => { setMode('coordinates'); setMessage('') }}>
                  <i className="bi bi-crosshair me-2" aria-hidden="true" />Koordinat
                </button>
              </div>

              <form onSubmit={handleIndividualSubmit} noValidate>
                {mode === 'address' ? (
                  <div className="mb-3">
                    <label className="form-label" htmlFor="address">Alamat lengkap</label>
                    <textarea id="address" className="form-control" rows={3} placeholder="Nama jalan, kelurahan, kota, provinsi" value={address} onChange={(event) => setAddress(event.target.value)} />
                    <div className="form-text">Hasil geocoding bergantung pada kualitas dan kelengkapan alamat.</div>
                  </div>
                ) : (
                  <div className="row mb-3">
                    <div className="col-sm-6 mb-3 mb-sm-0">
                      <label className="form-label" htmlFor="latitude">Latitude</label>
                      <input id="latitude" className="form-control" inputMode="decimal" placeholder="-6.200000" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
                      <div className="form-text">Rentang -90 sampai 90</div>
                    </div>
                    <div className="col-sm-6">
                      <label className="form-label" htmlFor="longitude">Longitude</label>
                      <input id="longitude" className="form-control" inputMode="decimal" placeholder="106.816666" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
                      <div className="form-text">Rentang -180 sampai 180</div>
                    </div>
                  </div>
                )}
                <hr />
                <div className="callout callout-info mb-3">
                  <h4><i className="bi bi-signpost-2 me-1" aria-hidden="true" />Estimasi mengikuti jaringan jalan</h4>
                  <p className="mb-0">Preferensi jalan utama dan batas detour mengikuti kebijakan yang masih menunggu validasi bisnis.</p>
                </div>
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                  <span className="small text-secondary"><i className="bi bi-shield-lock me-1" aria-hidden="true" />Lokasi belum dikirim ke layanan eksternal.</span>
                  <button type="submit" className="btn btn-primary">
                    Validasi input <i className="bi bi-check2 ms-1" aria-hidden="true" />
                  </button>
                </div>
                {message && <div className="alert alert-info mt-3 mb-0" role="status">{message}</div>}
                <div className="form-text mt-2">Validasi format berjalan di browser; analisis jaringan memerlukan API geocoding dan routing.</div>
              </form>
          </ContentCard>

          <ContentCard title="Upload Excel" tools={<span className="badge text-bg-secondary">02 · Bulk</span>} className="mb-3">
              <label className="form-label" htmlFor="bulk-file">File Excel (.xlsx)</label>
              <div className="input-group">
                <label className="btn btn-outline-secondary mb-0" htmlFor="bulk-file">Pilih file</label>
                <span className="form-control text-secondary text-truncate" aria-live="polite">{fileName || 'Belum ada file dipilih'}</span>
                <input id="bulk-file" className="visually-hidden-focusable" type="file" aria-label="Pilih file Excel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileChange} />
              </div>
              <div className="form-text">Berisi alamat atau pasangan latitude-longitude.</div>
              {uploadMessage && <div className="alert alert-info mt-3 mb-0" role="status">{uploadMessage}</div>}
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
                <p className="small text-secondary mb-0">Format template dan hasil unduhan mengikuti kontrak API bulk.</p>
                <button className="btn btn-primary" type="button" onClick={handleBulkSubmit}>Upload &amp; analisis</button>
              </div>
          </ContentCard>
        </div>

        <div className="col-12 col-xl-5">
          <ContentCard title="Ringkasan lokasi" tools={<span className="badge text-bg-secondary">Belum dianalisis</span>}>
              <div className="border rounded bg-body-secondary text-center p-5 mb-3">
                <i className="bi bi-map display-6 text-secondary" aria-hidden="true" />
                <p className="small text-secondary mt-2 mb-0">Peta dan rute tampil setelah analisis tersedia</p>
              </div>
              <ul className="list-group list-group-flush">
                <ResultRow icon="bi-diagram-2" label="Jaringan terdekat" value="—" />
                <ResultRow icon="bi-signpost" label="Titik sambung tervalidasi" value="—" />
                <ResultRow icon="bi-rulers" label="Rute jalan terpilih" value="—" />
                <ResultRow icon="bi-signpost" label="Rute terpendek pembanding" value="—" />
                <ResultRow icon="bi-arrow-left-right" label="Detour terhadap rute pendek" value="—" />
                <ResultRow icon="bi-signpost-2" label="Alasan pemilihan rute" value="Menunggu kebijakan" />
              </ul>
              <div className="alert alert-warning mt-3 mb-0"><i className="bi bi-info-circle me-2" aria-hidden="true" />Estimasi rute bukan jaminan kondisi lapangan. Verifikasi survei mungkin diperlukan.</div>
          </ContentCard>
        </div>
      </div>
    </>
  )
}

function ResultRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <li className="list-group-item d-flex align-items-center gap-2 px-0">
      <i className={`bi ${icon} text-secondary`} aria-hidden="true" />
      <span>{label}</span>
      <strong className="ms-auto text-secondary small">{value}</strong>
    </li>
  )
}
