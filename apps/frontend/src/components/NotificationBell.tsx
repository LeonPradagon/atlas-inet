import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { atlasApi } from '../shared/api'
import { domainKey, useEntityScope } from '../shared/EntityScope'
import { dateLabel, useFeedbackMutation } from './DomainUi'

export function NotificationBell() {
  const { entity, user, can } = useEntityScope()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLLIElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState({ top: 0, right: 12 })
  const [realtime, setRealtime] = useState(false)
  const hasPermission = can('notifications.read')
  useEffect(() => {
    if (typeof window.WebSocket !== 'function') {
      setRealtime(false)
      return
    }
    if (!entity || !user || !hasPermission) {
      setRealtime(false)
      return
    }

    let stopped = false
    let retry = 0
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let socket: WebSocket | undefined
    const connect = () => {
      if (stopped) return
      setRealtime(false)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = new URL(`${protocol}//${window.location.host}/api/v1/notifications/ws`)
      url.searchParams.set('entityId', entity.id)
      socket = new WebSocket(url)
      socket.onopen = () => {
        retry = 0
        setRealtime(true)
        void queryClient.invalidateQueries({ queryKey: domainKey(entity.id, user.id, 'notifications') })
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: unknown; entityId?: unknown }
          if (message.entityId === entity.id && ['notification.created', 'notification.read'].includes(String(message.type))) {
            void queryClient.invalidateQueries({ queryKey: domainKey(entity.id, user.id, 'notifications') })
          }
        } catch { /* Ignore invalid server frames; HTTP queries remain the source of truth. */ }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (stopped) return
        setRealtime(false)
        const delay = Math.min(30_000, 1000 * 2 ** retry)
        retry = Math.min(retry + 1, 5)
        retryTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      setRealtime(false)
      socket?.close(1000, 'Notification scope changed')
    }
  }, [entity?.id, user?.id, hasPermission, queryClient])

  const unreadQuery = useQuery({
    queryKey: domainKey(entity?.id, user?.id, 'notifications', 'unread-count'),
    queryFn: ({ signal }) => atlasApi.notifications.unreadCount(entity!.id, signal),
    enabled: Boolean(entity) && hasPermission,
    staleTime: 15_000,
    refetchInterval: realtime ? false : 30_000,
  })
  const listQuery = useQuery({
    queryKey: domainKey(entity?.id, user?.id, 'notifications', 'preview'),
    queryFn: ({ signal }) => atlasApi.notifications.list(entity!.id, 1, signal),
    enabled: Boolean(entity) && hasPermission && open,
    staleTime: 15_000,
    refetchInterval: open && !realtime ? 30_000 : false,
  })
  const markRead = useFeedbackMutation({
    mutationFn: (id: string) => atlasApi.notifications.read(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: domainKey(entity?.id, user?.id, 'notifications') }),
  })

  useEffect(() => {
    if (!open) return
    const positionPanel = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) setPanelPosition({ top: rect.bottom, right: Math.max(8, window.innerWidth - rect.right) })
    }
    positionPanel()
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', positionPanel)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', positionPanel)
    }
  }, [open])

  if (!hasPermission) return null

  const unreadCount = unreadQuery.data?.data ?? 0
  const label = unreadCount > 0 ? `Notifikasi, ${unreadCount} belum dibaca` : 'Notifikasi'
  return (
    <li className={`nav-item dropdown notification-menu ${open ? 'show' : ''}`} ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className="nav-link notification-bell"
        aria-label={label}
        aria-expanded={open}
        aria-controls="notification-dropdown"
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="bi bi-bell fs-5" aria-hidden="true" />
        {unreadCount > 0 && <span className="navbar-badge badge bg-danger" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && createPortal(<div
        id="notification-dropdown"
        ref={panelRef}
        className="dropdown-menu dropdown-menu-lg dropdown-menu-end show"
        style={{ position: 'fixed', top: panelPosition.top, right: panelPosition.right, zIndex: 1080, backgroundColor: 'var(--bs-dropdown-bg)' }}
      >
        <div className="dropdown-header d-flex justify-content-between align-items-center">
          <strong>Notifikasi</strong>
          <span className="d-flex align-items-center gap-2">
            <span className={`badge ${realtime ? 'text-bg-success' : 'text-bg-secondary'}`} role="status">{realtime ? 'Realtime' : 'Polling'}</span>
            {unreadCount > 0 && <span className="badge text-bg-danger">{unreadCount} belum dibaca</span>}
          </span>
        </div>
        <div className="notification-preview-list" aria-live="polite">
          {listQuery.isPending && <p className="dropdown-item-text text-secondary mb-0" role="status">Memuat notifikasi…</p>}
          {listQuery.isError && <div className="dropdown-item-text text-danger" role="alert">Notifikasi gagal dimuat. <button className="btn btn-link btn-sm p-0" onClick={() => void listQuery.refetch()}>Coba lagi</button></div>}
          {listQuery.isSuccess && listQuery.data.data.length === 0 && <p className="dropdown-item-text text-secondary mb-0">Belum ada notifikasi.</p>}
          {listQuery.data?.data.slice(0, 5).map((notification) => (
            <div className="dropdown-item" key={notification.id}>
              <Link to="/notifications" className="text-reset text-decoration-none" onClick={() => setOpen(false)}>
                <span className={`d-block ${notification.readAt ? '' : 'fw-bold'}`}>{notification.type.replaceAll('_', ' ')}</span>
                <span className="d-block small text-secondary">{notification.payload.reason ?? (notification.payload.coreCount != null ? `${notification.payload.coreCount} core` : notification.payload.key ?? 'Pembaruan ATLAS')}</span>
                <span className="d-block small text-secondary">{dateLabel(notification.createdAt)}</span>
              </Link>
              {!notification.readAt && <button className="btn btn-link btn-sm p-0 mt-1" disabled={markRead.isPending} onClick={() => markRead.mutate(notification.id)}>Tandai dibaca</button>}
            </div>
          ))}
        </div>
        <div className="dropdown-divider" />
        <Link to="/notifications" className="dropdown-item dropdown-footer" onClick={() => setOpen(false)}>Lihat semua notifikasi</Link>
      </div>, document.body)}
    </li>
  )
}
