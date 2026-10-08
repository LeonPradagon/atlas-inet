import type { ReactNode } from 'react'
import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query'
import { errorMessage } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import type { PageMeta } from '../shared/domain-types'
import { beginProcess, finishProcess } from '../shared/feedback'

export function QueryState({ query, empty, emptyMessage = 'Belum ada data pada lingkup ini.', children }: { query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }; empty?: boolean; emptyMessage?: string; children: ReactNode }) {
  if (query.isPending) return <p role="status"><span className="spinner-border spinner-border-sm me-2" />Memuat data…</p>
  if (query.isError) return <div className="alert alert-danger" role="alert">{errorMessage(query.error)} <button className="btn btn-sm btn-outline-danger" onClick={() => void query.refetch()}>Coba lagi</button></div>
  if (empty) return <p className="text-secondary" role="status">{emptyMessage}</p>
  return children
}
export function PermissionNotice() { return <div className="alert alert-warning" role="status">Akun belum memiliki akses ke entitas atau izin fitur ini. Hubungi administrator.</div> }
export function Pagination({ page, meta, setPage, setPageSize, label = 'tabel', busy = false }: { page: number; meta?: PageMeta; setPage: (page: number) => void; setPageSize?: (size: number) => void; label?: string; busy?: boolean }) {
  if (!meta) return null
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize))
  const start = Math.max(1, Math.min(page - 2, pages - 4))
  return <nav aria-label={`Pagination ${label}`} className="d-flex flex-wrap align-items-center justify-content-between mt-3 gap-2">
    <div className="d-flex flex-column align-items-start gap-1">
      {setPageSize && <label className="small d-flex align-items-center gap-2 mb-0">Tampilkan <select className="form-select form-select-sm" aria-label={`Baris per halaman ${label}`} value={meta.pageSize} onChange={(event) => { setPage(1); setPageSize(Number(event.target.value)) }} disabled={busy}>{[10,25,50,100].map((size) => <option key={size} value={size}>{size}</option>)}</select> baris</label>}
      <span className="small">Halaman {page} dari {pages} · {meta.total ? (page - 1) * meta.pageSize + 1 : 0}–{Math.min(page * meta.pageSize, meta.total)} dari {meta.total} data</span>
    </div>
    <div className="btn-group ms-auto"><button type="button" className="btn btn-outline-secondary btn-sm" aria-label={`Halaman sebelumnya ${label}`} title="Sebelumnya" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}><i className="bi bi-chevron-left" aria-hidden="true" /></button>
      {Array.from({length: Math.min(5, pages)}, (_, index) => start + index).map((value) => <button type="button" key={value} className={`btn btn-sm ${value === page ? 'btn-primary' : 'btn-outline-secondary'}`} aria-label={`Halaman ${value} ${label}`} aria-current={value === page ? 'page' : undefined} disabled={busy} onClick={() => setPage(value)}>{value}</button>)}
      <button type="button" className="btn btn-outline-secondary btn-sm" aria-label={`Halaman berikutnya ${label}`} title="Berikutnya" disabled={busy || page >= pages} onClick={() => setPage(page + 1)}><i className="bi bi-chevron-right" aria-hidden="true" /></button></div>
  </nav>
}
export function useDomainMutation<T, R>(fn: (input: T) => Promise<R>) {
  const { entity, user } = useEntityScope()
  const client = useQueryClient()
  return useFeedbackMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: domainKey(entity?.id, user?.id) }) })
}
export function useFeedbackMutation<T, R, C = unknown>(options: UseMutationOptions<R, Error, T, C>) {
  return useMutation({
    ...options,
    onMutate: async (variables, context) => {
      beginProcess()
      try { return await options.onMutate?.(variables, context) as C }
      catch (error) { finishProcess({ error }); throw error }
    },
    onSuccess: async (data, variables, onMutateResult, context) => {
      finishProcess()
      await options.onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: async (error, variables, onMutateResult, context) => {
      finishProcess({ error })
      await options.onError?.(error, variables, onMutateResult, context)
    },
  })
}
export function MutationStatus({ mutation }: { mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown } }) {
  if (mutation.isPending) return <p role="status"><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Memproses permintaan…</p>
  if (mutation.isError) return <div className="alert alert-danger mt-3" role="alert">{errorMessage(mutation.error)}</div>
  return null
}
export function Field({ label, name, type = 'text', value, onChange, required = true, min, max, step }: { label: string; name: string; type?: string; value?: string; onChange?: (value: string) => void; required?: boolean; min?: number; max?: number; step?: string }) {
  return <div className="mb-3"><label className="form-label" htmlFor={name}>{label}</label><input id={name} name={name} className="form-control" type={type} value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined} required={required} min={min} max={max} step={step} /></div>
}
export const numberLabel = (value: number | null | undefined) => value == null ? 'Belum diketahui' : value.toLocaleString('id-ID')
export const dateLabel = (value: string) => new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
