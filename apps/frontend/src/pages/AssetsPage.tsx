import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Field, MutationStatus, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { SegmentDetail } from '../components/SegmentTools'
import { CableTypesPanel } from '../components/CableTypesPanel'
import type { ImportPreview, ImportPreviewSummary } from '../shared/domain-types'
import { classifyKmlCandidate, type KmlCandidateKind } from '../shared/kml-classification'

function sourcePoleHeight(properties?: Record<string, string>) {
  for (const [key, value] of Object.entries(properties ?? {})) {
    if (!['height', 'heightm', 'poleheight', 'tinggi', 'tinggitiang'].includes(key.toLowerCase().replace(/[^a-z]/g, ''))) continue
    const match = /^(7|9)(?:\s*m)?$/i.exec(value.trim())
    if (match) return match[1]
  }
  return ''
}

export function AssetsPage() {
  const { entity, user, can } = useEntityScope()
  const [file, setFile] = useState<File | null>(null), [source, setSource] = useState(''), [mappings, setMappings] = useState('')
  const [page, setPage] = useState(1), [selected, setSelected] = useState('')
  const [importPage, setImportPage] = useState(1), [activePreview, setActivePreview] = useState<ImportPreviewSummary | null>(null)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const upload = useDomainMutation((mappingText: string) => atlasApi.imports.preview(entity!.id, source, file!, mappingText))
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
      <ContentCard title="Import jaringan / aset"><p>Upload KML/KMZ → tipe yang dikenali dan lolos validasi otomatis diterbitkan. Import merge, tidak menghapus aset/booking.</p>
      <p className="small">Sistem mengenali tipe eksplisit serta pola tegas pada nama/folder dan geometri, lalu menerbitkan aset valid otomatis. Placemark tanpa koordinat dicari otomatis bila memuat alamat di field <code>address</code>/<code>alamat</code> (maksimal 50 per upload); kandidat harus dikonfirmasi sebelum digunakan. Tanpa alamat yang dapat dicari, koordinat tidak bisa ditentukan dari KML. Fitur ambigu, tidak didukung, atau kurang data wajib tetap sebagai referensi. Kapasitas, tinggi tiang yang tidak tercantum, dan topologi tidak ditebak.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!upload.isPending) upload.mutate(mappings) }}><fieldset disabled={upload.isPending}>
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
        <div className="table-responsive"><table className="table table-sm table-striped align-middle"><thead><tr><th>File / source</th><th>Dibuat</th><th>Data valid</th><th>Referensi</th><th>Catatan</th><th>Status</th><th /></tr></thead><tbody>
           {history.data?.data.map((row) => <tr key={row.id}><td>{row.sourceName}<br /><small className="text-secondary">{row.sourceSystem}</small></td><td className="text-nowrap">{dateLabel(row.createdAt)}</td><td>{row.validRows}</td><td>{row.referenceAreas + row.referenceFeatures}</td><td>{row.errors}</td><td>{row.status}</td><td><button className="btn btn-outline-primary btn-sm" type="button" onClick={() => { upload.reset(); setActivePreview(row) }}>Lihat preview</button></td></tr>)}
        </tbody></table></div>
      </QueryState>
      <Pagination page={importPage} meta={history.data?.meta} setPage={setImportPage} />
      </ContentCard>
      {activePreview && <dialog ref={previewDialog} className="import-preview-dialog" aria-labelledby="saved-import-preview-title" onClose={() => setActivePreview(null)}>
        <div className="import-preview-dialog-header"><div><h2 id="saved-import-preview-title" className="h5 mb-1">Preview impor tersimpan</h2><p className="small text-secondary mb-0">{activePreview.sourceName} · {activePreview.sourceSystem}</p></div><button className="btn-close" type="button" aria-label="Tutup preview" onClick={() => { const dialog = previewDialog.current; if (dialog && typeof dialog.close === 'function') dialog.close(); setActivePreview(null) }} /></div>
        <div className="import-preview-dialog-body"><QueryState query={savedPreview}>{savedPreview.data && <ImportStagingReview key={savedPreview.data.data.id} initial={savedPreview.data.data} uploading={false} />}</QueryState></div>
      </dialog>}
    </>}
    {can('network.read') && <ContentCard title="Segmen jaringan published"><QueryState query={list} empty={list.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Segmen / kabel</th><th>Status</th><th>Kelengkapan</th><th>Version</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}><td><button className="btn btn-link p-0 text-start" onClick={() => setSelected(row.id)}>{row.segmentCode} · {row.cableName}</button></td><td>{row.status}</td><td>{row.completeness.status}</td><td>{row.version}</td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={list.data?.meta} setPage={setPage} /></ContentCard>}
    {selected && <SegmentDetail id={selected} editable />}
    {(can('network.read') || can('network.master-write')) && <CableTypesPanel />}
  </>
}
function ImportStagingReview({ initial, uploading }: { initial: ImportPreview; uploading: boolean }) {
  const [preview, setPreview] = useState(initial)
  const [errorPage, setErrorPage] = useState(1), [rowPage, setRowPage] = useState(1), [classificationPage, setClassificationPage] = useState(1)
  const [assetCodes, setAssetCodes] = useState<Record<number, string>>({})
  const [selectedKinds, setSelectedKinds] = useState<Record<number, string>>({})
  const [poleHeights, setPoleHeights] = useState<Record<number, string>>({})
  const geocode = useDomainMutation((rowNumber: number) => atlasApi.imports.geocodeRow(preview.id, rowNumber))
  const confirm = useDomainMutation((input: { rowNumber: number; lookupId: string; index: number }) => atlasApi.imports.confirmCoordinates(preview.id, input.rowNumber, input.lookupId, input.index))
  const confirmClassification = useDomainMutation((input: { rowNumber: number; kind: 'SEGMENT' | 'NODE' | 'POLE' | 'ODC' | 'ODP' | 'POP'; code: string; cableName?: string; heightM?: 7 | 9 }) => atlasApi.imports.confirmClassification(preview.id, input.rowNumber, input))
  const publish = useDomainMutation(() => atlasApi.imports.publish(preview.id))
  const disabled = uploading || geocode.isPending || confirm.isPending || confirmClassification.isPending || publish.isPending || preview.status !== 'PREVIEW'
  const unmappedFeatures = preview.referenceFeatures.filter((feature) => !feature.assetRowValid).length
  const suggestions = useMemo(() => preview.referenceFeatures.flatMap((feature) => {
    if (feature.assetRowValid || feature.properties?.duplicateFeatureOfRow) return []
    const properties = feature.properties ?? {}
    const suggestion = classifyKmlCandidate({ name: feature.name, geometryType: feature.geometry.type, folderPath: properties.kmlFolderPath, attributes: properties })
    return suggestion ? [{ feature, suggestion }] : []
  }), [preview.referenceFeatures])
  const visibleSuggestions = suggestions.slice((classificationPage - 1) * 20, classificationPage * 20)
  const duplicateWarnings = preview.errors.filter((row) => row.code === 'DUPLICATE_ASSET_GEOMETRY_SKIPPED')
  const blockingErrors = preview.errors.filter((row) => row.code !== 'DUPLICATE_ASSET_GEOMETRY_SKIPPED')
  const errors = blockingErrors.slice((errorPage - 1) * 25, errorPage * 25)
  return <><hr /><p>ID preview: <code>{preview.id}</code> · {preview.rows.length} aset jaringan{preview.status === 'PUBLISHED' ? ' diterbitkan' : ' menunggu penerbitan'} · {preview.areas.length} Area Referensi · {preview.referenceFeatures.length} geometri titik/garis di peta ({unmappedFeatures} belum terpetakan) · {duplicateWarnings.length} fitur kembar dilewati · {blockingErrors.length} error.</p>
    {suggestions.length > 0 && <details className="mb-3"><summary>Saran yang belum diterbitkan otomatis ({suggestions.length})</summary>
      <p className="small text-secondary mt-2">Fitur ini belum lolos syarat publikasi otomatis. Periksa tipe dan data wajib sebelum memilih klasifikasi manual; jika tidak pasti, biarkan sebagai referensi.</p>
      <div className="table-responsive"><table className="table table-sm align-middle"><thead><tr><th>Placemark / saran</th><th>Tipe aset</th><th>Kode aset</th><th>Detail wajib</th><th /></tr></thead><tbody>
        {visibleSuggestions.map(({ feature, suggestion }) => {
          const isLine = feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'
          const suggestedKinds: Record<KmlCandidateKind, string> = { cable: 'SEGMENT', POP: 'POP', ODC: 'ODC', ODP: 'ODP', pole: 'POLE', FDT: '', FAT: '', OLT: '', ODF: '', slack: '' }
          const kind = selectedKinds[feature.rowNumber] ?? suggestedKinds[suggestion.kind]
          const code = assetCodes[feature.rowNumber] ?? (feature.properties?.code || feature.name).slice(0, 200)
          const height = poleHeights[feature.rowNumber] ?? sourcePoleHeight(feature.properties)
          return <tr key={feature.rowNumber}>
            <td><strong>{feature.name}</strong><br /><small>Saran: {suggestion.label} · {suggestion.evidence} · baris {feature.rowNumber}</small></td>
            <td><select className="form-select form-select-sm" aria-label={`Tipe aset baris ${feature.rowNumber}`} value={kind} disabled={disabled} onChange={(event) => setSelectedKinds((current) => ({ ...current, [feature.rowNumber]: event.target.value }))}>
              <option value="">Pilih tipe…</option>{isLine ? <option value="SEGMENT">Segmen kabel</option> : <><option value="NODE">Node jaringan</option><option value="POLE">Tiang</option><option value="ODC">ODC</option><option value="ODP">ODP</option><option value="POP">POP</option></>}
            </select></td>
            <td><input className="form-control form-control-sm" aria-label={`Kode aset baris ${feature.rowNumber}`} maxLength={200} value={code} disabled={disabled} onChange={(event) => setAssetCodes((current) => ({ ...current, [feature.rowNumber]: event.target.value }))} /></td>
            <td>{kind === 'POLE' ? <select className="form-select form-select-sm" aria-label={`Tinggi tiang baris ${feature.rowNumber}`} value={height} disabled={disabled} onChange={(event) => setPoleHeights((current) => ({ ...current, [feature.rowNumber]: event.target.value }))}><option value="">Pilih tinggi…</option><option value="7">7 m</option><option value="9">9 m</option></select> : kind === 'SEGMENT' ? <span className="small">Nama kabel: {feature.name}; kapasitas/topologi kosong sampai diisi.</span> : <span className="small">Lokasi dari KML; relasi segmen belum diisi.</span>}</td>
            <td><button className="btn btn-outline-primary btn-sm text-nowrap" type="button" disabled={disabled || !kind || !code.trim() || (kind === 'POLE' && !height)} onClick={() => confirmClassification.mutate({ rowNumber: feature.rowNumber, kind: kind as 'SEGMENT' | 'NODE' | 'POLE' | 'ODC' | 'ODP' | 'POP', code, ...(kind === 'SEGMENT' ? { cableName: feature.name } : {}), ...(kind === 'POLE' && height ? { heightM: Number(height) as 7 | 9 } : {}) }, { onSuccess: (response) => { setPreview(response.data); setClassificationPage(1) } })}>Konfirmasi tipe</button></td>
          </tr>
        })}
      </tbody></table></div>
      <Pagination page={classificationPage} meta={{ page: classificationPage, pageSize: 20, total: suggestions.length }} setPage={setClassificationPage} />
    </details>}
    {duplicateWarnings.length > 0 && <div className="alert alert-info" role="status">{duplicateWarnings.length} Placemark memiliki tipe, kode, dan koordinat yang sama. Satu diterbitkan sebagai aset; salinannya tetap sebagai referensi KML.</div>}
    {blockingErrors.length > 0 && <div className="alert alert-warning"><ul>{errors.map((row) => <li key={row.rowNumber} className="mb-3">Baris {row.rowNumber}: {row.message}
      {row.sourceRow && <><p className="small mb-1">{row.sourceRow.kind} · {row.sourceRow.code} · {row.sourceRow.address}</p><button className="btn btn-outline-primary btn-sm" disabled={disabled} onClick={() => geocode.mutate(row.rowNumber, { onSuccess: (response) => setPreview(response.data) })}>Cari koordinat baris {row.rowNumber}</button>
        {row.candidates?.map((candidate, index) => <div key={index} className="mt-2"><span>{candidate.label} · {candidate.latitude}, {candidate.longitude} · {candidate.precision ?? 'Perlu verifikasi'}</span> <button className="btn btn-outline-primary btn-sm" disabled={disabled || !row.lookupId} onClick={() => confirm.mutate({ rowNumber: row.rowNumber, lookupId: row.lookupId!, index }, { onSuccess: (response) => { setPreview(response.data); setErrorPage(1) } })}>Konfirmasi kandidat {index + 1} baris {row.rowNumber}</button></div>)}</>}
    </li>)}</ul><Pagination page={errorPage} meta={{ page: errorPage, pageSize: 25, total: blockingErrors.length }} setPage={setErrorPage} /></div>}
    {geocode.isPending && <p role="status">Mencari koordinat melalui geocoder internal…</p>}
      {(preview.areasPublishedAt || preview.referenceFeatures.length > 0) && <p className="small text-secondary">Geometri referensi tetap tersedia; hanya fitur yang lolos klasifikasi dan validasi menjadi aset operasional.</p>}
      {preview.status === 'PUBLISHED' && <div className="alert alert-success" role="status">{preview.rows.length} aset valid sudah diterbitkan otomatis ke jaringan aktif.</div>}
      {preview.status === 'PREVIEW' && preview.autoPublishError && <div className="alert alert-warning" role="status">Publikasi otomatis tertahan: {preview.autoPublishError}</div>}
      {preview.status === 'PREVIEW' && !blockingErrors.length && preview.rows.length > 0 && <div className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2" role="status"><span>{preview.rows.length} aset valid belum diterbitkan. Periksa kendala validasi di atas.</span><button className="btn btn-primary btn-sm" type="button" disabled={disabled} onClick={() => publish.mutate(undefined, { onSuccess: (response) => setPreview((current) => ({ ...current, status: response.data.status, datasetId: response.data.datasetId, referenceFeatures: current.referenceFeatures.filter((feature) => !feature.assetRowValid) })) })}>Coba terbitkan</button></div>}
      {preview.status === 'PREVIEW' && !blockingErrors.length && !preview.rows.length && <div className="alert alert-info" role="status">Tidak ada fitur yang memenuhi syarat publikasi otomatis. Geometri sumber tetap sebagai referensi.</div>}
      {preview.status === 'PREVIEW' && blockingErrors.length > 0 && <div className="alert alert-info" role="status">Selesaikan error impor sebelum menerbitkan aset. Geometri referensi tetap tersedia.</div>}
     {geocode.isError && <MutationStatus mutation={geocode} />}{confirm.isError && <MutationStatus mutation={confirm} />}{confirmClassification.isError && <MutationStatus mutation={confirmClassification} />}{publish.isError && <MutationStatus mutation={publish} />}
     <p className="form-text">Alamat sumber dikirim ke geocoder internal untuk pencarian koordinat; hasil geocoding tetap perlu konfirmasi. Kapasitas dan relasi jaringan tidak terisi otomatis. Data Photon: © OpenStreetMap contributors · ODbL 1.0.</p>
      {preview.rows.length > 0 ? <details><summary>Preview baris {(rowPage - 1) * 100 + 1}–{Math.min(rowPage * 100, preview.rows.length)} dari {preview.rows.length}</summary><table className="table table-sm"><thead><tr><th>Baris</th><th>Kind</th><th>Code</th><th>Nama kabel dari KML</th><th>Koordinat / sumber</th></tr></thead><tbody>{preview.rows.slice((rowPage - 1) * 100, rowPage * 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.kind}</td><td>{row.code}</td><td>{row.cableName ?? '—'}</td><td>{row.geometry && JSON.stringify(row.geometry)}<br />{row.geocoding?.provider} {row.geocoding?.datasetVersion}</td></tr>)}</tbody></table><Pagination page={rowPage} meta={{ page: rowPage, pageSize: 100, total: preview.rows.length }} setPage={setRowPage} /></details> : <p className="text-secondary small">Tidak ada baris aset operasional valid di preview ini.</p>}
   </>
}
