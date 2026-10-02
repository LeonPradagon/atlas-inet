import { useState, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { EmptyState } from '../components/EmptyState'

type AdminView = 'users' | 'audit'

export function UsersAuditPage() {
  const [view, setView] = useState<AdminView>('users')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')

  function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const email = String(data.get('email') ?? '').trim()
    const role = String(data.get('role') ?? '')
    const entity = String(data.get('entity') ?? '').trim()
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role || !entity) {
      setMessage('Masukkan nama, email valid, role, dan scope entitas.')
      return
    }
    setMessage('Form valid. Pengguna belum dibuat karena API manajemen akses belum tersedia.')
  }

  return (
    <>
      <div className="nav nav-tabs mb-3" role="tablist" aria-label="Manajemen akses">
        <button className={`nav-link ${view === 'users' ? 'active' : ''}`} type="button" role="tab" aria-selected={view === 'users'} onClick={() => { setView('users'); setMessage('') }}>Pengguna</button>
        <button className={`nav-link ${view === 'audit' ? 'active' : ''}`} type="button" role="tab" aria-selected={view === 'audit'} onClick={() => { setView('audit'); setMessage('') }}>Audit log</button>
      </div>
      {view === 'users' ? (
        <>
          <ContentCard title="Tambah pengguna">
              <form className="row align-items-end" onSubmit={addUser} noValidate>
                <div className="col-md-3 mb-3"><label className="form-label" htmlFor="user-name">Nama</label><input className="form-control" id="user-name" name="name" autoComplete="name" required /></div>
                <div className="col-md-3 mb-3"><label className="form-label" htmlFor="user-email">Email</label><input className="form-control" id="user-email" name="email" type="email" autoComplete="email" required /></div>
                <div className="col-md-3 mb-3"><label className="form-label" htmlFor="user-role">Role</label><select className="form-select" id="user-role" name="role" defaultValue=""><option value="" disabled>Pilih role</option><option value="ADMIN">Admin Sistem</option><option value="ASSET_ADMIN">Admin Aset</option><option value="PRESALES">Presales</option><option value="SALES">Sales</option><option value="VIEWER">Viewer</option></select></div>
                <div className="col-md-3 mb-3"><label className="form-label" htmlFor="user-entity">Scope entitas</label><input className="form-control" id="user-entity" name="entity" placeholder="Nama / ID entitas" required /></div>
                <div className="col-12 mb-3"><button className="btn btn-primary" type="submit"><i className="bi bi-person-plus me-1" aria-hidden="true" />Validasi pengguna</button></div>
              </form>
              {message && <div className={`alert ${message.startsWith('Form valid') ? 'alert-info' : 'alert-warning'} mb-0`} role="status">{message}</div>}
          </ContentCard>
          <ContentCard title="Daftar pengguna">
              <label className="form-label" htmlFor="user-search">Cari nama atau email</label>
              <input className="form-control" id="user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pengguna" />
              <EmptyState icon="bi-inbox" title="Daftar pengguna belum tersedia" detail={query ? `Pencarian “${query}” akan diterapkan saat API tersedia.` : 'Pengguna dan role akan dimuat dari backend.'} spacingClassName="py-4" iconSizeClassName="display-6" />
          </ContentCard>
        </>
      ) : (
        <ContentCard title="Audit log">
            <label className="form-label" htmlFor="audit-search">Filter aktor, aksi, atau resource</label>
            <input className="form-control" id="audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari audit log" />
            <EmptyState icon="bi-inbox" title="Audit log belum tersedia" detail="Riwayat perubahan akan dimuat sesuai izin pengguna setelah API tersedia." spacingClassName="py-4" iconSizeClassName="display-6" />
        </ContentCard>
      )}
    </>
  )
}
