import { useState, type ChangeEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'
import { FormStatus } from '../components/FormStatus'

export function AssetsPage() {
  const [query, setQuery] = useState('')
  const [fileName, setFileName] = useState('')
  const [message, setMessage] = useState('')

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const valid = /\.(kml|xlsx)$/i.test(file.name)
    if (!valid) {
      setFileName('')
      setMessage('Pilih file KML atau Excel (.xlsx) sesuai template import.')
      event.target.value = ''
      return
    }
    setFileName(file.name)
    setMessage('File dipilih di browser dan belum diunggah; API import belum tersedia.')
  }

  function validateImportSelection() {
    if (!fileName) {
      setMessage('Pilih file KML atau Excel terlebih dahulu.')
      return
    }
    setMessage(`Ekstensi .${fileName.split('.').pop()?.toLowerCase()} dikenali. Isi file belum divalidasi dan belum dipreview; API serta template import belum tersedia.`)
  }

  return (
    <>
      <ContentCard title="Import jaringan dan aset">
          <div className="row g-3 align-items-end">
            <div className="col-md">
              <label className="form-label" htmlFor="asset-file">File KML / Excel</label>
              <input id="asset-file" className="form-control" type="file" accept=".kml,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} />
            </div>
            <div className="col-md-auto d-grid">
              <button className="btn btn-primary" type="button" onClick={validateImportSelection}>
                <i className="bi bi-file-earmark-check me-1" aria-hidden="true" />Periksa ekstensi
              </button>
            </div>
          </div>
          <div className="form-text mt-2">Setelah API tersedia, import mengikuti staging, validasi isi, preview, lalu publish.</div>
          {fileName && <p className="small mb-2"><i className="bi bi-file-earmark-check me-1" aria-hidden="true" />{fileName}</p>}
          <FormStatus message={message} tone={message.startsWith('File dipilih') ? 'info' : 'warning'} />
      </ContentCard>
      <ContentCard title="Segmen jaringan">
          <label className="form-label" htmlFor="asset-search">Cari kabel, segmen, atau lokasi</label>
          <input id="asset-search" className="form-control mb-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ketik untuk mencari" />
          <EmptyState icon="bi-diagram-3" title="Data aset belum tersedia" detail={query ? `Pencarian “${query}” akan diterapkan saat dataset tersedia.` : 'Import dataset tervalidasi untuk mengelola detail aset jaringan.'} />
      </ContentCard>
    </>
  )
}
