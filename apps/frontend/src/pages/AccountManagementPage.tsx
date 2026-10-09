import { useRef, useState, type FormEvent } from 'react'
import { ContentCard } from '../components/ContentCard'
import { atlasApi, errorMessage } from '../shared/api'
import { useEntityScope } from '../shared/EntityScope'
import { beginProcess, finishProcess } from '../shared/feedback'

export function AccountManagementPage() {
  const { entities } = useEntityScope()
  const manageableEntities = entities.filter((entity) => entity.permissions.includes('accounts.manage'))
  const [entityId, setEntityId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const selectedEntityId = manageableEntities.some((entity) => entity.id === entityId)
    ? entityId
    : manageableEntities[0]?.id ?? ''

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    const passwordConfirmation = String(data.get('password-confirmation') ?? '')
    if (password !== passwordConfirmation) {
      setError('Konfirmasi password tidak sama.')
      setSuccess('')
      return
    }

    setSubmitting(true)
    setError('')
    setSuccess('')
    beginProcess()
    try {
      const result = await atlasApi.accounts.create(String(data.get('entityId') ?? ''), {
        name: String(data.get('name') ?? '').trim(),
        email: String(data.get('email') ?? '').trim(),
        password,
        profile: String(data.get('profile') ?? '') as 'booking-user' | 'booking-manager',
      })
      finishProcess()
      setSuccess(`Akun ${result.data.name} (${result.data.email}) berhasil dibuat dengan akses ${result.data.profile}.`)
      form.current?.reset()
      setEntityId(selectedEntityId)
    } catch (cause) {
      finishProcess({ error: cause })
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return <ContentCard title="Buat akun">
    <p className="text-secondary">Buat akun login dan berikan akses Booking Core pada satu entitas aktif. Akun langsung aktif. Password awal tidak dikirim lewat email; bagikan melalui kanal terpisah.</p>
    {success && <div className="alert alert-success" role="status">{success}</div>}
    {error && <div className="alert alert-danger" role="alert">{error}</div>}
    {manageableEntities.length === 0
      ? <div className="alert alert-warning" role="status">Tidak ada entitas aktif dengan izin accounts.manage.</div>
      : <form ref={form} onSubmit={submit}>
          <fieldset disabled={submitting}>
            <label className="form-label" htmlFor="account-entity">Entitas</label>
            <select id="account-entity" name="entityId" className="form-select mb-3" value={selectedEntityId} onChange={(event) => setEntityId(event.target.value)} required>
              {manageableEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.code} · {entity.name}</option>)}
            </select>

            <label className="form-label" htmlFor="account-name">Nama lengkap</label>
            <input id="account-name" name="name" className="form-control mb-3" autoComplete="off" maxLength={200} required />

            <label className="form-label" htmlFor="account-email">Email kerja</label>
            <input id="account-email" name="email" type="email" className="form-control mb-3" autoComplete="off" maxLength={254} required />

            <label className="form-label" htmlFor="account-profile">Akses Booking</label>
            <select id="account-profile" name="profile" className="form-select mb-2" defaultValue="booking-user" required>
              <option value="booking-user">Booking User — lihat jaringan, buat dan lihat booking</option>
              <option value="booking-manager">Booking Manager — termasuk release booking dan konversi ke Used</option>
            </select>
            <p className="form-text mb-3">Booking Manager juga mendapat izin pengelolaan alokasi yang dipakai sistem untuk konversi ke Used.</p>

            <label className="form-label" htmlFor="account-password">Password awal</label>
            <input id="account-password" name="password" type="password" className="form-control mb-3" autoComplete="new-password" minLength={8} maxLength={128} required />

            <label className="form-label" htmlFor="account-password-confirmation">Konfirmasi password awal</label>
            <input id="account-password-confirmation" name="password-confirmation" type="password" className="form-control mb-3" autoComplete="new-password" minLength={8} maxLength={128} required />

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Membuat akun…' : 'Buat akun'}
            </button>
          </fieldset>
        </form>}
  </ContentCard>
}
