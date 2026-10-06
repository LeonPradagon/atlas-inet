import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi, errorMessage } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Field, MutationStatus, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { SegmentDetail } from '../components/SegmentTools'
import { CableTypesPanel } from '../components/CableTypesPanel'
import type { ImportPreview, ImportPreviewSummary } from '../shared/domain-types'
export function AssetsPage() {
  const { entity, user, can } = useEntityScope()
  const [file, setFile] = useState<File | null>(null), [source, setSource] = useState(''), [mappings, setMappings] = useState('')
  const [page, setPage] = useState(1), [selected, setSelected] = useState('')
  const [importPage, setImportPage] = useState(1), [activePreview, setActivePreview] = useState<ImportPreviewSummary | null>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const upload = useDomainMutation(() => atlasApi.imports.preview(entity!.id, source, file!, mappings))
  const history = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'import-previews', importPage), queryFn: ({ signal }) => atlasApi.imports.list(entity!.id, importPage, signal), enabled: Boolean(entity) && can('imports.write') })
  const savedPreview = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'import-preview', activePreview?.id), queryFn: ({ signal }) => atlasApi.imports.get(activePreview!.id, signal), enabled: Boolean(activePreview && entity) && can('imports.write'), refetchOnMount: 'always' })
  useEffect(() => {
    const dialog = previewDialog.current
    if (!activePreview || !dialog) return
    const root = document.documentElement
    const body = document.body
    const scrollX = window.scrollX, scrollY = window.scrollY
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const scrollbarGap = Math.max(0, window.innerWidth - root.clientWidth)
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    if (scrollbarGap) body.style.paddingRight = `${scrollbarGap}px`
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY)
    }
  }, [activePreview])
  const list = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segments', page), queryFn: ({ signal }) => atlasApi.network.segments(entity!.id, page, signal), enabled: can('network.read') && Boolean(entity) })
  function resetPreview() {
    upload.reset()
  }
  return <>
    {can('imports.write') && <>
      <ContentCard title="Import jaringan / aset"><p>Preview → validasi domain → penerapan otomatis untuk data valid. Import merge, tidak menghapus aset/booking.</p>
      <p className="small">Semua geometri KML/KMZ tampil di peta: Point/LineString yang belum terpetakan sebagai Fitur Referensi, Polygon sebagai Area Referensi. Nama kabel KML diambil persis dari Placemark atau ExtendedData; policy global tidak diubah. Referensi bukan aset/kabel operasional dan tidak memengaruhi kapasitas. Kapasitas, tipe, dan topologi tidak ditebak. Baris aset yang lolos validasi diterapkan otomatis; isi mapping per nomor Placemark jika metadata belum lengkap.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!upload.isPending) upload.mutate() }}><fieldset disabled={upload.isPending}>
        <Field name="import-source" label="Identitas source system" value={source} onChange={(value) => { setSource(value); resetPreview() }} />
        <label className="form-label" htmlFor="asset-file">File KML / KMZ · maksimal 20 MB</label><input id="asset-file" className="form-control mb-3" type="file" accept=".kml,.kmz" required onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetPreview() }} />
        <label className="form-label" htmlFor="import-mappings">Mapping KML (JSON opsional; keyed nomor Placemark)</label><textarea id="import-mappings" className="form-control mb-3" rows={3} value={mappings} onChange={(event) => { setMappings(event.target.value); resetPreview() }} />
        <button className="btn btn-primary" disabled={!file || file.size > 20 * 1024 * 1024}>Upload dan preview</button>
      </fieldset></form><MutationStatus mutation={upload} />
      {upload.data && <ImportStagingReview key={upload.data.data.id} initial={upload.data.data} uploading={upload.isPending} />}
      <hr />
      <div className="d-flex justify-content-between align-items-center gap-2"><h5 className="mb-0">Riwayat preview tersimpan</h5><button className="btn btn-outline-secondary btn-sm" type="button" disabled={history.isFetching} onClick={() => void history.refetch()}>Muat ulang</button></div>
      <p className="form-text">Preview disimpan di server dan hanya terlihat oleh akun pembuatnya. Buka kembali untuk melihat seluruh staging.</p>
      <QueryState query={history} empty={history.data?.data.length === 0} emptyMessage="Belum ada preview impor tersimpan.">
        <div className="table-responsive"><table className="table table-sm table-striped align-middle"><thead><tr><th>File / source</th><th>Dibuat</th><th>Data valid</th><th>Referensi</th><th>Error</th><th>Status</th><th /></tr></thead><tbody>
           {history.data?.data.map((row) => <tr key={row.id}><td>{row.sourceName}<br /><small className="text-secondary">{row.sourceSystem}</small></td><td className="text-nowrap">{dateLabel(row.createdAt)}</td><td>{row.validRows}</td><td>{row.referenceAreas + row.referenceFeatures}</td><td>{row.errors}</td><td>{row.status}</td><td><button className="btn btn-outline-primary btn-sm" type="button" onClick={() => { upload.reset(); setActivePreview(row) }}>Lihat preview</button></td></tr>)}
        </tbody></table></div>
      </QueryState>
      <Pagination page={importPage} meta={history.data?.meta} setPage={setImportPage} />
      </ContentCard>
      {activePreview && <dialog ref={previewDialog} className="import-preview-dialog" aria-labelledby="saved-import-preview-title" onClose={() => setActivePreview(null)}>
        <div className="import-preview-dialog-header"><div><h2 id="saved-import-preview-title" className="h5 mb-1">Preview impor tersimpan</h2><p className="small text-secondary mb-0">{activePreview.sourceName} · {activePreview.sourceSystem}</p></div><button className="btn-close" type="button" aria-label="Tutup preview" onClick={() => { const dialog = previewDialog.current; if (dialog && typeof dialog.close === 'function') dialog.close(); setActivePreview(null) }} /></div>
        <div className="import-preview-dialog-body"><QueryState query={savedPreview}>{savedPreview.data && <ImportStagingReview key={savedPreview.data.data.id} initial={savedPreview.data.data} uploading={false} autoRetry />}</QueryState></div>
      </dialog>}
    </>}
    {can('network.read') && <ContentCard title="Segmen jaringan published"><QueryState query={list} empty={list.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Segmen / kabel</th><th>Status</th><th>Kelengkapan</th><th>Version</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}><td><button className="btn btn-link p-0 text-start" onClick={() => setSelected(row.id)}>{row.segmentCode} · {row.cableName}</button></td><td>{row.status}</td><td>{row.completeness.status}</td><td>{row.version}</td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={list.data?.meta} setPage={setPage} /></ContentCard>}
    {selected && <SegmentDetail id={selected} editable />}
    {(can('network.read') || can('network.master-write')) && <CableTypesPanel />}
  </>
}
function ImportStagingReview({ initial, uploading, autoRetry = false }: { initial: ImportPreview; uploading: boolean; autoRetry?: boolean }) {
  const [preview, setPreview] = useState(initial)
  const [errorPage, setErrorPage] = useState(1), [rowPage, setRowPage] = useState(1)
  const autoRetryAttempted = useRef(false)
  const geocode = useDomainMutation((rowNumber: number) => atlasApi.imports.geocodeRow(preview.id, rowNumber))
  const confirm = useDomainMutation((input: { rowNumber: number; lookupId: string; index: number }) => atlasApi.imports.confirmCoordinates(preview.id, input.rowNumber, input.lookupId, input.index))
  const publish = useDomainMutation(() => atlasApi.imports.publish(preview.id))
  const disabled = uploading || geocode.isPending || confirm.isPending || publish.isPending || preview.status !== 'PREVIEW'
  const unmappedFeatures = preview.referenceFeatures.filter((feature) => !feature.assetRowValid).length
  useEffect(() => {
    if (!autoRetry || autoRetryAttempted.current || preview.status !== 'PREVIEW' || preview.errors.length || !preview.rows.length) return
    autoRetryAttempted.current = true
    publish.mutate(undefined, {
      onSuccess: (response) => setPreview((current) => ({ ...current, status: response.data.status, datasetId: response.data.datasetId, autoPublishError: null })),
      onError: (error) => setPreview((current) => ({ ...current, autoPublishError: errorMessage(error) })),
    })
  }, [autoRetry, preview.id])
  const errors = preview.errors.slice((errorPage - 1) * 25, errorPage * 25)
  return <><hr /><p>ID preview: <code>{preview.id}</code> · {preview.rows.length} aset jaringan valid · {preview.areas.length} Area Referensi · {preview.referenceFeatures.length} geometri titik/garis di peta ({unmappedFeatures} belum terpetakan) · {preview.errors.length} error. Referensi tidak dihitung sebagai aset/kabel operasional.</p>
    {preview.errors.length > 0 && <div className="alert alert-warning"><ul>{errors.map((row) => <li key={row.rowNumber} className="mb-3">Baris {row.rowNumber}: {row.message}
      {row.sourceRow && <><p className="small mb-1">{row.sourceRow.kind} · {row.sourceRow.code} · {row.sourceRow.address}</p><button className="btn btn-outline-primary btn-sm" disabled={disabled} onClick={() => geocode.mutate(row.rowNumber, { onSuccess: (response) => setPreview(response.data) })}>Cari koordinat baris {row.rowNumber}</button>
        {row.candidates?.map((candidate, index) => <div key={index} className="mt-2"><span>{candidate.label} · {candidate.latitude}, {candidate.longitude} · {candidate.precision ?? 'Perlu verifikasi'}</span> <button className="btn btn-outline-primary btn-sm" disabled={disabled || !row.lookupId} onClick={() => confirm.mutate({ rowNumber: row.rowNumber, lookupId: row.lookupId!, index }, { onSuccess: (response) => { setPreview(response.data); setErrorPage(1) } })}>Konfirmasi kandidat {index + 1} baris {row.rowNumber}</button></div>)}</>}
    </li>)}</ul><Pagination page={errorPage} meta={{ page: errorPage, pageSize: 25, total: preview.errors.length }} setPage={setErrorPage} /></div>}
    {geocode.isPending && <p role="status">Mencari koordinat melalui geocoder internal…</p>}
     {(preview.areasPublishedAt || preview.referenceFeatures.length > 0) && <p className="small text-secondary">Layer referensi diterapkan otomatis. Fitur tanpa mapping tetap referensi; tidak dihitung sebagai aset/kabel operasional.</p>}
     {preview.status === 'PUBLISHED' && <div className="alert alert-success" role="status">Data lolos validasi dan diterapkan otomatis ke jaringan aktif.</div>}
     {preview.autoPublishError && <div className="alert alert-warning" role="status">Penerapan aset otomatis tertahan: {preview.autoPublishError}. Perbaiki validasi yang disebutkan lalu buka kembali preview untuk mencoba otomatis lagi.</div>}
     {preview.status === 'PREVIEW' && !preview.autoPublishError && !preview.errors.length && !preview.rows.length && <div className="alert alert-info" role="status">Tidak ada baris aset operasional; fitur referensi yang valid sudah diterapkan otomatis.</div>}
     {preview.status === 'PREVIEW' && !preview.autoPublishError && preview.errors.length > 0 && <div className="alert alert-info" role="status">Baris yang valid tetap di preview sampai semua error impor diperbaiki. Layer referensi sudah diterapkan otomatis.</div>}
    {geocode.isError && <MutationStatus mutation={geocode} />}{confirm.isError && <MutationStatus mutation={confirm} />}
    <p className="form-text">Konfirmasi kandidat menyimpan koordinat hanya di staging; belum publish dan tetap perlu verifikasi lokasi aset. Geocoding Photon menggunakan © OpenStreetMap contributors · ODbL 1.0.</p>
      {preview.rows.length > 0 ? <details><summary>Preview baris {(rowPage - 1) * 100 + 1}–{Math.min(rowPage * 100, preview.rows.length)} dari {preview.rows.length}</summary><table className="table table-sm"><thead><tr><th>Baris</th><th>Kind</th><th>Code</th><th>Nama kabel dari KML</th><th>Koordinat / sumber</th></tr></thead><tbody>{preview.rows.slice((rowPage - 1) * 100, rowPage * 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.kind}</td><td>{row.code}</td><td>{row.cableName ?? '—'}</td><td>{row.geometry && JSON.stringify(row.geometry)}<br />{row.geocoding?.provider} {row.geocoding?.datasetVersion}</td></tr>)}</tbody></table><Pagination page={rowPage} meta={{ page: rowPage, pageSize: 100, total: preview.rows.length }} setPage={setRowPage} /></details> : <p className="text-secondary small">Tidak ada baris aset operasional valid di preview ini.</p>}
   </>
}
