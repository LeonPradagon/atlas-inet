import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, atlasApi, currentUserQueryKey } from '../shared/api'

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      setMessage('Masukkan email kerja dan password yang valid.')
      return
    }

    setSubmitting(true)
    setMessage('')
    try {
      await atlasApi.auth.signIn(email, password)
      queryClient.removeQueries({ queryKey: ['atlas'] })
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey })
      await navigate({ to: '/' })
    } catch (error) {
      setMessage(error instanceof ApiError && error.status
        ? 'Login gagal. Periksa email/password atau hubungi administrator.'
        : 'Layanan autentikasi belum dapat dihubungi. Coba lagi setelah API tersedia.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="container d-flex min-vh-100 align-items-center justify-content-center py-4">
      <section className="card w-100" style={{ maxWidth: 430 }}>
        <div className="card-header text-center">
          <h1 className="h4 mb-1"><i className="bi bi-broadcast-pin text-primary me-2" aria-hidden="true" />ATLAS</h1>
          <span className="text-secondary">Asset Tracking &amp; Network Intelligence</span>
        </div>
        <div className="card-body p-4">
          <h2 className="h5 mb-3">Masuk ke akun</h2>
          <p className="text-secondary small">Login diperlukan untuk mengakses dashboard dan fitur internal. Gunakan akun perusahaan yang telah diaktifkan administrator.</p>
          <form onSubmit={submitLogin}>
            <div className="mb-3"><label className="form-label" htmlFor="login-email">Email kerja</label><input className="form-control" id="login-email" name="email" type="email" autoComplete="username" required /></div>
            <div className="mb-3"><label className="form-label" htmlFor="login-password">Password</label>
              <div className="input-group">
                <input className="form-control" id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required />
                <button className="btn btn-outline-secondary" type="button" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}><i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" /></button>
              </div>
            </div>
            <button className="btn btn-primary w-100 text-white" type="submit" disabled={submitting}>{submitting ? 'Memproses…' : 'Masuk'}</button>
            {message && <div className="alert alert-warning mt-3 mb-0" role="alert">{message}</div>}
          </form>
        </div>
        <div className="card-footer text-center text-secondary small">Akses internal · Jika belum punya akun, hubungi administrator.</div>
      </section>
    </main>
  )
}
