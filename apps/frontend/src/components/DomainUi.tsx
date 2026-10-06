import type { ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import type { PageMeta } from '../shared/domain-types'

export function QueryState({ query, empty, emptyMessage = 'Belum ada data pada lingkup ini.', children }: { query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty?: boolean; emptyMessage?: string; children: ReactNode }) {
  if (query.isPending) return <p role="status"><span className="spinner-border spinner-border-sm me-2" />Memuat data…</p>
  if (query.isError) return <div className="alert alert-danger" role="alert">{errorMessage(query.error)} <button className="btn btn-sm btn-outline-danger" onClick={() => void query.refetch()}>Coba lagi</button></div>
  if (empty) return <p className="text-secondary" role="status">{emptyMessage}</p>
  return children
}
export function PermissionNotice() { return <div className="alert alert-warning" role="status">Akun belum memiliki akses ke entitas atau izin fitur ini. Hubungi administrator.</div> }
export function Pagination({ page, meta, setPage }: { page: number; meta?: PageMeta; setPage: (page: number) => void }) {
  if (!meta) return null
  return <div className="d-flex align-items-center justify-content-between mt-3 gap-2"><span className="small">Halaman {page} · {meta.total} data</span><div className="btn-group"><button className="btn btn-outline-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button><button className="btn btn-outline-secondary btn-sm" disabled={page * meta.pageSize >= meta.total} onClick={() => setPage(page + 1)}>Berikutnya</button></div></div>
}
export function useDomainMutation<T, R>(fn: (input: T) => Promise<R>) {
  const { entity, user } = useEntityScope()
  const client = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: domainKey(entity?.id, user?.id) }) })
}
export function MutationStatus({ mutation }: { mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown } }) {
  if (mutation.isPending) return <p role="status">Memproses permintaan…</p>
  if (mutation.isError) return <div className="alert alert-danger mt-3" role="alert">{errorMessage(mutation.error)}</div>
  if (mutation.isSuccess) return <div className="alert alert-success mt-3" role="status">Permintaan berhasil diproses oleh server.</div>
  return null
}
export function Field({ label, name, type = 'text', value, onChange, required = true, min, max, step }: { label: string; name: string; type?: string; value?: string; onChange?: (value: string) => void; required?: boolean; min?: number; max?: number; step?: string }) {
  return <div className="mb-3"><label className="form-label" htmlFor={name}>{label}</label><input id={name} name={name} className="form-control" type={type} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} required={required} min={min} max={max} step={step} /></div>
}
export const numberLabel = (value: number | null | undefined) => value == null ? 'Belum diketahui' : value.toLocaleString('id-ID')
export const dateLabel = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
