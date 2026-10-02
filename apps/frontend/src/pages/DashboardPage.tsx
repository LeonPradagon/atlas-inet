import { Link } from '@tanstack/react-router'
import { ContentCard } from '../components/ContentCard'

const metrics = [
  { label: 'Total Segmen', icon: 'bi-bezier2', color: 'text-bg-primary' },
  { label: 'Total Core', icon: 'bi-diagram-3', color: 'text-bg-info' },
  { label: 'Used Core', icon: 'bi-hdd-stack', color: 'text-bg-warning' },
  { label: 'Available Core', icon: 'bi-check2-circle', color: 'text-bg-success' },
]

export function DashboardPage() {
  return (
    <>
      <div className="callout callout-info">
        <h4>Asset Tracking &amp; Network Intelligence</h4>
        <p>Analisis cakupan jaringan dan siapkan kebutuhan presales menggunakan data yang tervalidasi.</p>
        <Link to="/analysis" className="btn btn-primary btn-sm text-white">
          <i className="bi bi-geo-alt me-1" aria-hidden="true" />Mulai analisis alamat
        </Link>
      </div>

      <div className="alert alert-secondary" role="status">
        <i className="bi bi-info-circle me-2" aria-hidden="true" />
        <strong>Data operasional belum tersedia.</strong> Ringkasan akan muncul setelah dataset jaringan tervalidasi dan API siap.
      </div>

      <div className="row">
        {metrics.map((metric) => (
          <div className="col-12 col-sm-6 col-xl-3" key={metric.label}>
            <div className="info-box">
              <span className={`info-box-icon ${metric.color} shadow-sm`}><i className={`bi ${metric.icon}`} aria-hidden="true" /></span>
              <div className="info-box-content">
                <span className="info-box-text">{metric.label}</span>
                <span className="info-box-number">—</span>
                <span className="progress-description">Menunggu koneksi data</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row">
        <div className="col-lg-7">
          <ContentCard as="div" title="Network Map" tools={<Link to="/network" className="btn btn-tool" aria-label="Buka Network Map"><i className="bi bi-box-arrow-up-right" aria-hidden="true" /></Link>} bodyClassName="text-center py-5">
              <i className="bi bi-map display-6 text-secondary" aria-hidden="true" />
               <h4 className="mt-3">Dataset jaringan belum tersedia</h4>
              <p className="text-secondary mb-0">Peta tampil setelah data jaringan dan basemap disetujui.</p>
          </ContentCard>
        </div>
        <div className="col-lg-5">
          <ContentCard as="div" title="Akses cepat" bodyClassName="p-0">
              <ul className="list-group list-group-flush">
                <li className="list-group-item">
                  <Link to="/analysis" className="d-flex align-items-center gap-3 text-decoration-none text-body">
                    <i className="bi bi-geo-alt fs-5" aria-hidden="true" />
                    <span><strong>Analisis alamat</strong><br /><small className="text-secondary">Nearest network dan estimasi rute jalan</small></span>
                    <i className="bi bi-arrow-right ms-auto" aria-hidden="true" />
                  </Link>
                </li>
                <li className="list-group-item">
                  <Link to="/bookings" className="d-flex align-items-center gap-3 text-decoration-none text-body">
                    <i className="bi bi-bookmark-check fs-5" aria-hidden="true" />
                    <span><strong>Booking core</strong><br /><small className="text-secondary">Kapasitas per segmen</small></span>
                    <i className="bi bi-arrow-right ms-auto" aria-hidden="true" />
                  </Link>
                </li>
                <li className="list-group-item">
                  <Link to="/reports" className="d-flex align-items-center gap-3 text-decoration-none text-body">
                    <i className="bi bi-bar-chart fs-5" aria-hidden="true" />
                    <span><strong>Monitoring</strong><br /><small className="text-secondary">Utilisasi dan laporan jaringan</small></span>
                    <i className="bi bi-arrow-right ms-auto" aria-hidden="true" />
                  </Link>
                </li>
              </ul>
          </ContentCard>
        </div>
      </div>
    </>
  )
}
