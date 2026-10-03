import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_ENDPOINTS, atlasApi, downloadFile } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { Field, MutationStatus, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { SegmentDetail } from '../components/SegmentTools'
import { CableTypesPanel } from '../components/CableTypesPanel'
import type { ImportPreview } from '../shared/domain-types'
export function AssetsPage() {
  const { entity, user, can } = useEntityScope()
  const [file, setFile] = useState<File | null>(null), [source, setSource] = useState(''), [mappings, setMappings] = useState('')
  const [page, setPage] = useState(1), [selected, setSelected] = useState('')
  const upload = useDomainMutation(() => atlasApi.imports.preview(entity!.id, source, file!, mappings))
  const template = useDomainMutation(() => downloadFile(`${API_ENDPOINTS.imports}/template`, 'atlas-assets.xlsx'))
  const list = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'segments', page), queryFn: ({ signal }) => atlasApi.network.segments(entity!.id, page, signal), enabled: can('network.read') && Boolean(entity) })
  function resetPreview() { upload.reset() }
  return <>
    {can('imports.write') && <ContentCard title="Import jaringan / aset"><p>Staging → preview → publish atomik. Import merge, tidak menghapus aset/booking. Pola nama resmi wajib approved sebelum publish.</p>
      <p className="small">Excel aset titik (NODE/POLE/ODC/ODP) dapat berisi alamat saja atau latitude–longitude. Alamat dicari melalui geocoder internal dan kandidat wajib dikonfirmasi. Segmen kabel tetap membutuhkan geometri garis aktual. Untuk daftar alamat customer, gunakan Analisis bulk dengan sheet Input.</p>
      <button className="btn btn-outline-secondary mb-3" disabled={template.isPending} onClick={() => template.mutate()}>Unduh template Assets</button>
      <form onSubmit={(event) => { event.preventDefault(); if (!upload.isPending) upload.mutate() }}><fieldset disabled={upload.isPending}>
        <Field name="import-source" label="Identitas source system" value={source} onChange={(value) => { setSource(value); resetPreview() }} />
        <label className="form-label" htmlFor="asset-file">File KML / XLSX · maksimal 20 MB</label><input id="asset-file" className="form-control mb-3" type="file" accept=".kml,.xlsx" required onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetPreview() }} />
        <label className="form-label" htmlFor="import-mappings">Mapping KML (JSON opsional; keyed nomor Placemark)</label><textarea id="import-mappings" className="form-control mb-3" rows={3} value={mappings} onChange={(event) => { setMappings(event.target.value); resetPreview() }} />
        <button className="btn btn-primary" disabled={!file || file.size > 20 * 1024 * 1024}>Upload dan preview</button>
      </fieldset></form><MutationStatus mutation={upload} /><MutationStatus mutation={template} />
      {upload.data && <ImportStagingReview key={upload.data.data.id} initial={upload.data.data} uploading={upload.isPending} />}
    </ContentCard>}
    {can('network.read') && <ContentCard title="Segmen jaringan published"><QueryState query={list} empty={list.data?.data.length === 0}><div className="table-responsive"><table className="table table-striped"><thead><tr><th>Segmen / kabel</th><th>Status</th><th>Kelengkapan</th><th>Version</th></tr></thead><tbody>{list.data?.data.map((row) => <tr key={row.id}><td><button className="btn btn-link p-0 text-start" onClick={() => setSelected(row.id)}>{row.segmentCode} · {row.cableName}</button></td><td>{row.status}</td><td>{row.completeness.status}</td><td>{row.version}</td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={list.data?.meta} setPage={setPage} /></ContentCard>}
    {selected && <SegmentDetail id={selected} editable />}
    {(can('network.read') || can('network.master-write')) && <CableTypesPanel />}
  </>
}
function ImportStagingReview({ initial, uploading }: { initial: ImportPreview; uploading: boolean }) {
  const [preview, setPreview] = useState(initial), [version, setVersion] = useState('')
  const [errorPage, setErrorPage] = useState(1)
  const geocode = useDomainMutation((rowNumber: number) => atlasApi.imports.geocodeRow(preview.id, rowNumber))
  const confirm = useDomainMutation((input: { rowNumber: number; lookupId: string; index: number }) => atlasApi.imports.confirmCoordinates(preview.id, input.rowNumber, input.lookupId, input.index))
  const publish = useDomainMutation(() => atlasApi.imports.publish(preview.id, version))
  const disabled = uploading || geocode.isPending || confirm.isPending || publish.isPending || publish.isSuccess || preview.status !== 'PREVIEW'
  const errors = preview.errors.slice((errorPage - 1) * 25, errorPage * 25)
  return <><hr /><p>ID preview: <code>{preview.id}</code> · {preview.rows.length} baris structurally valid / {preview.errors.length} error. Domain/naming/kapasitas divalidasi kembali saat publish.</p>
    {preview.errors.length > 0 && <div className="alert alert-warning"><ul>{errors.map((row) => <li key={row.rowNumber} className="mb-3">Baris {row.rowNumber}: {row.message}
      {row.sourceRow && <><p className="small mb-1">{row.sourceRow.kind} · {row.sourceRow.code} · {row.sourceRow.address}</p><button className="btn btn-outline-primary btn-sm" disabled={disabled} onClick={() => geocode.mutate(row.rowNumber, { onSuccess: (response) => setPreview(response.data) })}>Cari koordinat baris {row.rowNumber}</button>
        {row.candidates?.map((candidate, index) => <div key={index} className="mt-2"><span>{candidate.label} · {candidate.latitude}, {candidate.longitude} · {candidate.precision ?? 'Perlu verifikasi'}</span> <button className="btn btn-outline-primary btn-sm" disabled={disabled || !row.lookupId} onClick={() => confirm.mutate({ rowNumber: row.rowNumber, lookupId: row.lookupId!, index }, { onSuccess: (response) => { setPreview(response.data); setErrorPage(1) } })}>Konfirmasi kandidat {index + 1} baris {row.rowNumber}</button></div>)}</>}
    </li>)}</ul><Pagination page={errorPage} meta={{ page: errorPage, pageSize: 25, total: preview.errors.length }} setPage={setErrorPage} /></div>}
    {geocode.isPending && <p role="status">Mencari koordinat melalui geocoder internal…</p>}
    {geocode.isError && <MutationStatus mutation={geocode} />}{confirm.isError && <MutationStatus mutation={confirm} />}
    <p className="form-text">Konfirmasi kandidat menyimpan koordinat hanya di staging; belum publish dan tetap perlu verifikasi lokasi aset. Geocoding Photon menggunakan © OpenStreetMap contributors · ODbL 1.0.</p>
    <details><summary>Preview 100 baris pertama</summary><table className="table table-sm"><thead><tr><th>Baris</th><th>Kind</th><th>Code</th><th>Koordinat / sumber</th></tr></thead><tbody>{preview.rows.slice(0, 100).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.kind}</td><td>{row.code}</td><td>{row.geometry && JSON.stringify(row.geometry)}<br />{row.geocoding?.provider} {row.geocoding?.datasetVersion}</td></tr>)}</tbody></table></details>
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled) publish.mutate() }}><fieldset disabled={disabled}><Field name="dataset-version" label="Version dataset baru yang disetujui" value={version} onChange={setVersion} /><button className="btn btn-primary" disabled={preview.errors.length > 0 || preview.rows.length === 0}>Konfirmasi publish dataset</button></fieldset><MutationStatus mutation={publish} /></form>
  </>
}
