import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi, API_ENDPOINTS, downloadFile } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { ContentCard } from '../components/ContentCard'
import { dateLabel, Field, MutationStatus, numberLabel, Pagination, QueryState, useDomainMutation } from '../components/DomainUi'
import { JobPanel } from '../components/JobPanel'
import { SegmentDetail } from '../components/SegmentTools'
import { NetworkMapCanvas, type NetworkMapFeature } from '../components/NetworkMapCanvas'

export function AnalysisPage() {
  const { entity, can } = useEntityScope()
  const [mode, setMode] = useState('coordinates')
  const [address, setAddress] = useState(''), [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('')
  const [connection, setConnection] = useState(''), [file, setFile] = useState<File | null>(null), [jobId, setJobId] = useState('')
  const analysis = useDomainMutation((input: Parameters<typeof atlasApi.analysis.run>[0]) => atlasApi.analysis.run(input))
  const upload = useDomainMutation(() => atlasApi.analysis.upload(entity!.id, file!))
  const submit = useDomainMutation(() => atlasApi.analysis.submit(upload.data!.data.id))
  const template = useDomainMutation(() => downloadFile(`${API_ENDPOINTS.analysis}/template`, 'atlas-analysis.xlsx'))
  const result = analysis.data?.data
  const features: NetworkMapFeature[] = []
  if (result?.coordinates) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [result.coordinates.longitude, result.coordinates.latitude] }, properties: { id: 'analysis-input', name: 'Lokasi input', layer: 'odp' } })
  if (result?.route?.geometry) features.push({ type: 'Feature', geometry: result.route.geometry, properties: { id: 'analysis-route', name: 'Estimasi rute jalan', layer: 'segments' } })
  function run(overrides?: { latitude: number; longitude: number }) {
    analysis.mutate({ entityId: entity!.id, ...(overrides ? { latitude: overrides.latitude, longitude: overrides.longitude } : mode === 'coordinates' ? { latitude: Number(latitude), longitude: Number(longitude) } : {}), ...(address.trim() ? { address: address.trim() } : {}), ...(connection.trim() ? { connectionPointId: connection.trim() } : {}) })
  }
  return <>
    {can('analysis.create') && <div className="row"><div className="col-xl-6"><ContentCard title="Analisis alamat / koordinat"><form onSubmit={(event) => { event.preventDefault(); if (!analysis.isPending) run() }}><fieldset disabled={analysis.isPending}>
      <label className="form-label" htmlFor="input-mode">Sumber lokasi</label><select id="input-mode" className="form-select mb-3" value={mode} onChange={(event) => { setMode(event.target.value); analysis.reset() }}><option value="coordinates">Koordinat WGS84</option><option value="address">Alamat</option></select>
      <Field name="analysis-address" label={mode === 'address' ? 'Alamat lengkap' : 'Alamat (metadata opsional)'} value={address} onChange={setAddress} required={mode === 'address'} />
      {mode === 'coordinates' && <div className="row"><div className="col-sm-6"><Field name="latitude" label="Latitude" value={latitude} onChange={setLatitude} type="number" min={-90} max={90} step="any" /></div><div className="col-sm-6"><Field name="longitude" label="Longitude" value={longitude} onChange={setLongitude} type="number" min={-180} max={180} step="any" /></div></div>}
      <Field name="connection-point-id" label="ID titik sambung ODC/ODP (opsional)" value={connection} onChange={setConnection} required={false} />
      <button className="btn btn-primary">Jalankan analisis</button></fieldset></form>
      {analysis.isError && <MutationStatus mutation={analysis} />}
       <p className="form-text mt-3">Koordinat tidak membutuhkan geocoding. Provider internal, titik sambung dan policy diperlukan untuk estimasi rute/kabel. Tidak membuat booking otomatis.</p>
       <p className="form-text">Geocoding Photon internal memakai data © OpenStreetMap contributors · ODbL 1.0. Alamat kurang spesifik dapat menghasilkan titik jalan/kota; konfirmasi kandidat atau masukkan koordinat hasil verifikasi.</p>
    </ContentCard></div><div className="col-xl-6"><ContentCard title="Hasil analisis">
      {analysis.isPending ? <p role="status">Menganalisis…</p> : result ? <>
        <div className={`alert ${result.status === 'OK' ? 'alert-info' : 'alert-warning'}`} role="status">Status: {result.status}</div>
        {result.coordinates && <p>Latitude: {result.coordinates.latitude} · Longitude: {result.coordinates.longitude}</p>}
        <p>Nearest: {result.nearest?.cableName ?? 'Tidak tersedia'}</p><p>Jarak geometris: {numberLabel(result.nearestNetworkDistanceM)} m</p><p>Rute jalan: {numberLabel(result.route?.distanceM)} m</p><p>Estimasi kabel: {numberLabel(result.estimatedCableLengthM)} m</p><p>Metode: {result.estimationMethod ?? 'NOT_AVAILABLE'} · {result.routeStatus ?? 'Tanpa rute'}</p>
        {result.candidates?.map((candidate, index) => <button className="btn btn-outline-primary mb-2 me-2" key={index} onClick={() => { setMode('coordinates'); setLatitude(String(candidate.latitude)); setLongitude(String(candidate.longitude)); run(candidate) }}>{candidate.label} · {candidate.precision ?? 'Perlu verifikasi'} · {candidate.latitude}, {candidate.longitude} · konfirmasi koordinat</button>)}
        {(result.geocodingProvider || result.provider) && <p className="small">Provider: {result.geocodingProvider ?? result.provider} · Dataset geocoding: {result.geocodingDatasetVersion ?? result.datasetVersion ?? 'Versi tidak tersedia'}</p>}
        {features.length > 0 && <NetworkMapCanvas features={features} visibleLayers={{ segments: true, poles: true, odc: true, odp: true }} search="" style="liberty" />}
        <div className="alert alert-warning mt-3">Estimasi awal; wajib verifikasi survei. Jarak geometris bukan panjang rute kabel.</div>
      </> : <p className="text-secondary">Belum ada hasil analisis.</p>}
    </ContentCard></div></div>}
    {result?.nearest && can('network.read') && <SegmentDetail id={result.nearest.segmentId} />}
    {can('analysis.bulk') && <><ContentCard title="Analisis bulk Excel">
      <p className="small">Sheet Input boleh berisi alamat saja; worker internal mencari koordinat. Latitude–longitude yang sudah lengkap langsung digunakan tanpa geocoding. Kolom connection_point_id opsional untuk estimasi rute/kabel ke ODC/ODP tervalidasi; routing dan formula approved tetap diperlukan. Kandidat ambigu tersedia di hasil Excel untuk dikonfirmasi dan diunggah ulang sebagai koordinat.</p>
      <button className="btn btn-outline-secondary mb-3" disabled={template.isPending} onClick={() => template.mutate()}>Unduh template Input</button>
      <form onSubmit={(event) => { event.preventDefault(); if (!upload.isPending && !submit.isPending) upload.mutate() }}>
        <label htmlFor="bulk-file" className="form-label">File .xlsx · maksimal 20 MB / 10.000 baris</label>
        <input id="bulk-file" className="form-control mb-3" type="file" accept=".xlsx" required disabled={upload.isPending || submit.isPending} onChange={(event) => { setFile(event.target.files?.[0] ?? null); upload.reset(); submit.reset() }} />
        <button className="btn btn-primary" disabled={!file || file.size > 20 * 1024 * 1024 || upload.isPending || submit.isPending}>Upload dan preview</button>
      </form><MutationStatus mutation={upload} /><MutationStatus mutation={template} />
      {upload.data && <><p>Total {upload.data.meta?.total} baris. Preview maksimal 100 baris; periksa error sebelum menyetujui.</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Baris</th><th>Reference</th><th>Validasi</th></tr></thead><tbody>{upload.data.data.preview.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.referenceId}</td><td>{row.error ?? 'Valid'}</td></tr>)}</tbody></table></div><button className="btn btn-primary" disabled={upload.isPending || submit.isPending || submit.isSuccess || !can('analysis.create')} onClick={() => submit.mutate(undefined, { onSuccess: (response) => setJobId(response.data.id) })}>Setujui proses baris valid</button><MutationStatus mutation={submit} /></>}
    </ContentCard><JobPanel key={jobId || 'lookup'} id={jobId} onChange={setJobId} /></>}
    {can('analysis.read') && <AnalysisHistoryPanel />}
  </>
}
function AnalysisHistoryPanel() {
  const { entity, user } = useEntityScope()
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, 'analysis-history', page), queryFn: ({ signal }) => atlasApi.analysis.history(entity!.id, page, signal) })
  return <ContentCard title="Histori analisis Anda"><QueryState query={query} empty={query.data?.data.length === 0}><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Waktu / input</th><th>Status / nearest</th><th>Estimasi kabel</th></tr></thead><tbody>{query.data?.data.map((row) => <tr key={row.id}><td>{dateLabel(row.createdAt)}<br /><small>{row.input.address ?? `${row.input.latitude}, ${row.input.longitude}`}</small></td><td>{row.result.status}<br />{row.result.nearest?.cableName ?? 'Tidak tersedia'}</td><td>{numberLabel(row.result.estimatedCableLengthM)} m<br /><small>Wajib survei</small></td></tr>)}</tbody></table></div></QueryState><Pagination page={page} meta={query.data?.meta} setPage={setPage} /></ContentCard>
}
