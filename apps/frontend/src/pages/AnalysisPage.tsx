import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { atlasApi } from "../shared/api";
import { domainKey, useEntityScope } from "../shared/EntityScope";
import { ContentCard } from "../components/ContentCard";
import { dateLabel, Field, MutationStatus, numberLabel, Pagination, QueryState, useDomainMutation } from "../components/DomainUi";
import { JobPanel } from "../components/JobPanel";
import { SegmentDetail } from "../components/SegmentTools";
import { NetworkMapCanvas, type NetworkMapFeature } from "../components/NetworkMapCanvas";

export function AnalysisPage() {
  const { entity, can } = useEntityScope();
  const [mode, setMode] = useState("coordinates");
  const [address, setAddress] = useState(""),
    [latitude, setLatitude] = useState(""),
    [longitude, setLongitude] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [jobId, setJobId] = useState("");
  const analysis = useDomainMutation((input: Parameters<typeof atlasApi.analysis.run>[0]) => atlasApi.analysis.run(input));
  const upload = useDomainMutation(() => atlasApi.analysis.upload(entity!.id, file!));
  const submit = useDomainMutation(() => atlasApi.analysis.submit(upload.data!.data.id));
  const result = analysis.data?.data;
  const features: NetworkMapFeature[] = [];
  if (result?.coordinates)
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [result.coordinates.longitude, result.coordinates.latitude] }, properties: { id: "analysis-input", name: "Lokasi input", layer: "analysis" } });
  if (result?.route?.geometry) features.push({ type: "Feature", geometry: result.route.geometry, properties: { id: "analysis-route", name: "Estimasi rute jalan", layer: "segments" } });
  const bulkFeatures: NetworkMapFeature[] = (upload.data?.data.preview ?? []).flatMap((row) => {
    const latitude = row.input?.latitude,
      longitude = row.input?.longitude;
    if (row.error || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{ type: "Feature", geometry: { type: "Point", coordinates: [longitude!, latitude!] }, properties: { id: `bulk-${row.rowNumber}`, name: row.referenceId, layer: "analysis" } }];
  });
  function run(overrides?: { latitude: number; longitude: number; connectionPointId?: string; connectionPointType?: 'ODC' | 'ODP' }) {
    analysis.mutate({
      entityId: entity!.id,
      ...(overrides ? { latitude: overrides.latitude, longitude: overrides.longitude } : mode === "coordinates" ? { latitude: Number(latitude), longitude: Number(longitude) } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(overrides?.connectionPointId && overrides.connectionPointType ? { connectionPointId: overrides.connectionPointId, connectionPointType: overrides.connectionPointType } : {}),
    });
  }
  return (
    <>
      {can("analysis.create") && (
        <div className="row">
          <div className="col-xl-6">
            <ContentCard title="1. Masukkan lokasi">
              <p className="text-secondary">Masukkan alamat atau koordinat untuk menemukan jaringan terdekat. Jika memakai alamat, periksa lokasi hasil pencarian sebelum menggunakannya.</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!analysis.isPending) run();
                }}
              >
                <fieldset disabled={analysis.isPending}>
                  <label className="form-label" htmlFor="input-mode">
                    Sumber lokasi
                  </label>
                  <select
                    id="input-mode"
                    className="form-select mb-3"
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value);
                      analysis.reset();
                    }}
                  >
                    <option value="coordinates">Koordinat GPS</option>
                    <option value="address">Alamat</option>
                  </select>
                  <Field name="analysis-address" label={mode === "address" ? "Alamat lengkap" : "Alamat (metadata opsional)"} value={address} onChange={setAddress} required={mode === "address"} />
                  {mode === "coordinates" && (
                    <>
                      <div className="row">
                        <div className="col-sm-6">
                          <Field name="latitude" label="Lintang" value={latitude} onChange={setLatitude} type="number" min={-90} max={90} step="any" />
                        </div>
                        <div className="col-sm-6">
                          <Field name="longitude" label="Bujur" value={longitude} onChange={setLongitude} type="number" min={-180} max={180} step="any" />
                        </div>
                      </div>
                      <p className="form-text">Contoh Jakarta: lintang -6.2, bujur 106.8.</p>
                    </>
                  )}
                  <button className="btn btn-primary" aria-label="Jalankan analisis">
                    <i className="bi bi-search me-1" aria-hidden="true" />
                    Cari jaringan terdekat
                  </button>
                </fieldset>
              </form>
              {analysis.isError && <MutationStatus mutation={analysis} />}
              <p className="form-text mt-3">
                Koordinat langsung digunakan. Untuk alamat, sistem mencari lokasinya terlebih dahulu. Jika satu titik jaringan terhubung ke kabel terdekat, sistem akan memakainya otomatis. Jika ada beberapa, Anda dapat memilihnya untuk menghitung rute. Analisis ini tidak membuat booking.
              </p>
              <p className="form-text">Alamat yang kurang lengkap bisa membuat titik hanya perkiraan, misalnya di jalan atau pusat kawasan. Periksa hasilnya; pilih lokasi yang benar atau masukkan koordinat yang sudah Anda pastikan.</p>
            </ContentCard>
          </div>
          <div className="col-xl-6">
            <ContentCard title="2. Hasil analisis">
              {analysis.isPending ? (
                <p role="status">Menganalisis…</p>
              ) : result ? (
                <>
                  <div className={`alert ${result.status === "OK" ? "alert-info" : "alert-warning"}`} role="status">
                    Status: {result.status}
                  </div>
                  {result.coordinates && (
                    <p>
                      Lintang: {result.coordinates.latitude} · Bujur: {result.coordinates.longitude}
                    </p>
                  )}
                  <dl className="row">
                    <dt className="col-sm-5">Jaringan terdekat</dt>
                    <dd className="col-sm-7">{result.nearest?.cableName ?? "Tidak ditemukan"}</dd>
                    <dt className="col-sm-5">Jarak ke jaringan</dt>
                    <dd className="col-sm-7">
                      {numberLabel(result.nearestNetworkDistanceM)} m <span className="text-secondary">(garis geometris)</span>
                    </dd>
                    {result.connectionPointCode && (
                      <>
                        <dt className="col-sm-5">Titik jaringan yang digunakan</dt>
                        <dd className="col-sm-7">{result.connectionPointCode}</dd>
                      </>
                    )}
                    <dt className="col-sm-5">Rute jalan</dt>
                    <dd className="col-sm-7">{numberLabel(result.route?.distanceM)} m</dd>
                    <dt className="col-sm-5">Estimasi panjang kabel</dt>
                    <dd className="col-sm-7">
                      <strong>Estimasi kabel: {numberLabel(result.estimatedCableLengthM)} m</strong>
                    </dd>
                  </dl>
                  {result.routeStatus && <p>Status rute: {routeStatusLabel(result.routeStatus)}</p>}
                  {result.estimatedCableLengthM == null && !result.connectionPointCandidates?.length && (
                    <div className="alert alert-warning" role="status">
                      <strong>Estimasi kabel belum tersedia.</strong> Data titik jaringan, jalur jalan, atau aturan perhitungan mungkin belum tersedia. Jarak yang ditampilkan hanya garis lurus, bukan panjang kabel.
                    </div>
                  )}
                  {result.connectionPointCandidates?.length && result.coordinates ? (
                    <div className="alert alert-info">
                      <strong>Ada beberapa titik jaringan yang terhubung.</strong>
                      <p className="mb-2">Pilih titik tujuan untuk menghitung rute dari lokasi Anda.</p>
                      {result.connectionPointCandidates.map((candidate) => (
                        <button
                          className="btn btn-outline-primary btn-sm mb-2 me-2"
                          key={`${candidate.type}:${candidate.id}`}
                          disabled={analysis.isPending}
                          onClick={() => run({ latitude: result.coordinates!.latitude, longitude: result.coordinates!.longitude, connectionPointId: candidate.id, connectionPointType: candidate.type })}
                        >
                          Pilih {candidate.code} ({candidate.type})
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {result.candidates?.length ? (
                    <div className="alert alert-info">
                      <strong>Pilih dan verifikasi lokasi yang benar</strong>
                      <p className="mb-2">Alamat menghasilkan beberapa kandidat. Analisis baru dijalankan setelah Anda memilih salah satunya.</p>
                      {result.candidates.map((candidate, index) => (
                        <button
                          className="btn btn-outline-primary btn-sm mb-2 me-2"
                          key={index}
                          onClick={() => {
                            setMode("coordinates");
                            setLatitude(String(candidate.latitude));
                            setLongitude(String(candidate.longitude));
                            run(candidate);
                          }}
                        >
                          {candidate.label} · {candidate.precision ?? "Perlu verifikasi"} · {candidate.latitude}, {candidate.longitude} · konfirmasi koordinat
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {(result.geocodingProvider || result.provider) && (
                    <p className="small">
                      Provider: {result.geocodingProvider ?? result.provider} · Dataset geocoding: {result.geocodingDatasetVersion ?? result.datasetVersion ?? "Versi tidak tersedia"}
                      {result.attribution ? <> · {result.attribution}</> : null}
                    </p>
                  )}
                  {features.length > 0 && <NetworkMapCanvas features={features} visibleLayers={{ segments: true, poles: true, odc: true, odp: true }} search="" style="liberty" />}
                  {result.estimatedCableLengthM != null && <div className="alert alert-warning mt-3">Hasil estimasi awal; tetap wajib diverifikasi melalui survei lapangan.</div>}
                </>
              ) : (
                <p className="text-secondary">Belum ada hasil analisis.</p>
              )}
            </ContentCard>
          </div>
        </div>
      )}
      {result?.nearest && can("network.read") && <SegmentDetail id={result.nearest.segmentId} />}
      {can("analysis.bulk") && (
        <>
          <ContentCard title="3. Analisis banyak lokasi · KML/KMZ">
            <ol>
              <li>Siapkan KML/KMZ berisi satu Point Placemark untuk tiap lokasi; koordinat KML memakai urutan longitude,latitude.</li>
              <li>Unggah untuk memvalidasi dan melihat marker pada peta.</li>
              <li>Setujui pemrosesan; pantau job lalu unduh hasil XLSX.</li>
            </ol>
            <p className="small">
              Baris non-Point ditandai error dan tidak dianalisis. KML aset FTTH (ODC/ODP/tiang/kabel) diimpor melalui Aset & Impor Jaringan, bukan sebagai lokasi customer. Untuk rute kabel, ExtendedData dapat memuat connection_point_id dan
              connection_point_type (ODC/ODP) bersama-sama.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!upload.isPending && !submit.isPending) upload.mutate();
              }}
            >
              <label htmlFor="bulk-file" className="form-label">
                File .kml / .kmz · maksimal 20 MB / 20.000 Placemark
              </label>
              <input
                id="bulk-file"
                className="form-control mb-3"
                type="file"
                accept=".kml,.kmz"
                required
                disabled={upload.isPending || submit.isPending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  upload.reset();
                  submit.reset();
                }}
              />
              <button className="btn btn-primary" disabled={!file || file.size > 20 * 1024 * 1024 || upload.isPending || submit.isPending}>
                Upload dan preview
              </button>
            </form>
            <MutationStatus mutation={upload} />
            {upload.data && (
              <>
                <p>Total {upload.data.meta?.total} Placemark. Preview maksimal 100; marker yang valid ditampilkan di peta.</p>
                {bulkFeatures.length > 0 && <NetworkMapCanvas features={bulkFeatures} visibleLayers={{ analysis: true }} search="" style="liberty" />}
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Baris</th>
                        <th>Reference</th>
                        <th>Validasi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upload.data.data.preview.map((row) => (
                        <tr key={row.rowNumber}>
                          <td>{row.rowNumber}</td>
                          <td>{row.referenceId}</td>
                          <td>{row.error ?? "Valid"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={upload.isPending || submit.isPending || submit.isSuccess || !can("analysis.create")}
                  onClick={() => submit.mutate(undefined, { onSuccess: (response) => setJobId(response.data.id) })}
                >
                  Setujui proses baris valid
                </button>
                <MutationStatus mutation={submit} />
              </>
            )}
          </ContentCard>
          <JobPanel key={jobId || "lookup"} id={jobId} onChange={setJobId} />
        </>
      )}
      {can("analysis.read") && <AnalysisHistoryPanel />}
    </>
  );
}
function routeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ROAD_ROUTE_ESTIMATE: "Rute berhasil ditemukan",
    ROUTING_NOT_AVAILABLE: "Data jalur jalan belum tersedia",
    ROUTE_POLICY_NOT_MET_OR_UNCONFIGURED: "Rute belum memenuhi aturan estimasi",
    CONNECTION_POINT_SELECTION_REQUIRED: "Pilih titik jaringan",
    CONNECTION_POINT_NOT_VALIDATED: "Titik tidak terhubung dengan kabel terdekat",
    NO_VALIDATED_CONNECTION_POINT: "Belum ada titik jaringan terverifikasi pada kabel terdekat",
  };
  return labels[status] ?? "Belum tersedia";
}
function AnalysisHistoryPanel() {
  const { entity, user } = useEntityScope();
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: domainKey(entity?.id, user?.id, "analysis-history", page), queryFn: ({ signal }) => atlasApi.analysis.history(entity!.id, page, signal) });
  return (
    <ContentCard title="Histori analisis Anda">
      <QueryState query={query} empty={query.data?.data.length === 0}>
        <div className="table-responsive">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Waktu / input</th>
                <th>Status / nearest</th>
                <th>Estimasi kabel</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((row) => (
                <tr key={row.id}>
                  <td>
                    {dateLabel(row.createdAt)}
                    <br />
                    <small>{row.input.address ?? `${row.input.latitude}, ${row.input.longitude}`}</small>
                  </td>
                  <td>
                    {row.result.status}
                    <br />
                    {row.result.nearest?.cableName ?? "Tidak tersedia"}
                  </td>
                  <td>
                    {numberLabel(row.result.estimatedCableLengthM)} m<br />
                    <small>Wajib survei</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
      <Pagination page={page} meta={query.data?.meta} setPage={setPage} />
    </ContentCard>
  );
}
