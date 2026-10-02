import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { initialize, PushMenu, teardown, Treeview } from 'admin-lte'
import { ApiStatusBadge } from '../components/ApiStatusBadge'
import { atlasApi, currentUserQueryKey } from '../shared/api'

const SIDEBAR_OPENED_EVENT = 'opened.lte.push-menu'
const SIDEBAR_COLLAPSED_EVENT = 'collapsed.lte.push-menu'

const dashboardItem = { label: 'Dashboard', to: '/', icon: 'bi-speedometer2' }

const navigationGroups = [
  {
    id: 'operasional',
    label: 'Operasional',
    icon: 'bi-briefcase',
    items: [
      { label: 'Network Map', to: '/network', icon: 'bi-map' },
      { label: 'Analisis Alamat', to: '/analysis', icon: 'bi-geo-alt' },
      { label: 'Booking Core', to: '/bookings', icon: 'bi-bookmark-check' },
      { label: 'Waiting List', to: '/waiting-list', icon: 'bi-list-ol' },
      { label: 'Notifikasi', to: '/notifications', icon: 'bi-bell' },
    ],
  },
  {
    id: 'jaringan',
    label: 'Jaringan & Monitoring',
    icon: 'bi-diagram-3',
    items: [
      { label: 'Aset Jaringan', to: '/assets', icon: 'bi-diagram-3' },
      { label: 'Monitoring & Export', to: '/reports', icon: 'bi-bar-chart' },
    ],
  },
  {
    id: 'sistem',
    label: 'Sistem',
    icon: 'bi-gear',
    items: [
      { label: 'Pengaturan', to: '/settings', icon: 'bi-gear' },
      { label: 'Pengguna & Audit', to: '/access-audit', icon: 'bi-people' },
    ],
  },
] as const

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/network': 'Network Map',
  '/analysis': 'Analisis Alamat',
  '/bookings': 'Booking Core',
  '/waiting-list': 'Waiting List',
  '/assets': 'Aset Jaringan',
  '/reports': 'Monitoring & Export',
  '/notifications': 'Notifikasi',
  '/settings': 'Pengaturan',
  '/access-audit': 'Pengguna & Audit',
}

export function AppShell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const title = pageTitles[pathname] ?? 'ATLAS'
  const isLoginPage = pathname === '/login'
  const [sidebarExpanded, setSidebarExpanded] = useState(() => window.matchMedia('(min-width: 992px)').matches)
  const activeGroup = navigationGroups.find((group) => group.items.some((item) => item.to === pathname))?.id ?? null
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup)
  const [sessionMessage, setSessionMessage] = useState('')
  const currentUserQuery = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: ({ signal }) => atlasApi.auth.currentUser(signal),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: !isLoginPage,
    refetchInterval: isLoginPage ? false : 60_000,
  })
  const isAuthenticated = currentUserQuery.isSuccess && Boolean(currentUserQuery.data)
  const signOutMutation = useMutation({
    mutationFn: () => atlasApi.auth.signOut(),
    onSuccess: async () => {
      setSessionMessage('')
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey })
      await navigate({ to: '/login' })
    },
    onError: () => setSessionMessage('Tidak dapat mengakhiri sesi. Coba lagi.'),
  })

  useEffect(() => {
    setOpenGroup(activeGroup)
  }, [activeGroup])

  useEffect(() => {
    if (!isLoginPage && !currentUserQuery.isPending && !isAuthenticated) {
      void navigate({ to: '/login', replace: true })
    }
  }, [currentUserQuery.isPending, isAuthenticated, isLoginPage, navigate])

  useEffect(() => {
    if (isLoginPage || !isAuthenticated) return teardown

    // The module loads before React renders, so initialize its DOM behaviors after mount.
    initialize()
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
    if (!sidebar) return teardown

    const updateExpandedState = () => {
      setSidebarExpanded(!document.body.classList.contains('sidebar-collapse'))
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
        PushMenu.getInstance(sidebar)?.collapse()
      }
    }

    updateExpandedState()
    sidebar.addEventListener(SIDEBAR_OPENED_EVENT, updateExpandedState)
    sidebar.addEventListener(SIDEBAR_COLLAPSED_EVENT, updateExpandedState)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      const pushMenu = PushMenu.getInstance(sidebar)
      if (pushMenu?.isMobileSize() && pushMenu.isExplicitlyOpen()) pushMenu.collapse()
      sidebar.removeEventListener(SIDEBAR_OPENED_EVENT, updateExpandedState)
      sidebar.removeEventListener(SIDEBAR_COLLAPSED_EVENT, updateExpandedState)
      document.removeEventListener('keydown', closeOnEscape)
      teardown()
    }
  }, [isAuthenticated, isLoginPage])

  function closeMobileSidebar() {
    const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
    const pushMenu = PushMenu.getInstance(sidebar)
    if (pushMenu?.isMobileSize()) pushMenu.collapse()
  }

  if (isLoginPage) return <Outlet />

  if (!isAuthenticated) {
    return (
      <main className="d-flex min-vh-100 align-items-center justify-content-center p-4">
        <div className="text-center text-secondary" role="status">
          {currentUserQuery.isPending
            ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Memverifikasi sesi…</>
            : 'Sesi tidak aktif. Mengalihkan ke halaman login…'}
        </div>
      </main>
    )
  }

  return (
    <div className="app-wrapper">
      <nav className="app-header navbar navbar-expand bg-body" aria-label="Header utama">
        <div className="container-fluid">
          <ul className="navbar-nav">
            <li className="nav-item">
              <button
                className="nav-link"
                type="button"
                data-lte-toggle="sidebar"
                aria-label={sidebarExpanded ? 'Ciutkan navigasi' : 'Buka navigasi'}
                aria-controls="main-sidebar"
                aria-expanded={sidebarExpanded}
                onClick={(event) => {
                  event.stopPropagation()
                  const sidebar = document.querySelector<HTMLElement>('.app-sidebar')
                  if (!sidebar) return

                  let pushMenu = PushMenu.getInstance(sidebar)
                  if (!pushMenu) {
                    pushMenu = PushMenu.getOrCreateInstance(sidebar)
                    pushMenu.init()
                  }
                  pushMenu.toggle()
                }}
              >
                <i className="bi bi-list" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <span className="navbar-brand mb-0 d-lg-none fw-light">ATLAS</span>
          <ul className="navbar-nav ms-auto align-items-center">
            {currentUserQuery.data
              ? <>
                  <li className="nav-item d-none d-md-block"><span className="nav-link">{currentUserQuery.data.user.name}</span></li>
                  <li className="nav-item me-2"><button className="btn btn-outline-secondary btn-sm" type="button" disabled={signOutMutation.isPending} onClick={() => signOutMutation.mutate()}>{signOutMutation.isPending ? 'Keluar…' : 'Keluar'}</button></li>
                </>
              : <li className="nav-item"><Link to="/login" className="nav-link">Masuk</Link></li>}
            <li className="nav-item me-2"><ApiStatusBadge /></li>
          </ul>
        </div>
      </nav>
      {sessionMessage && <div className="alert alert-warning rounded-0 mb-0" role="status">{sessionMessage}</div>}

      <aside id="main-sidebar" className="app-sidebar bg-body-secondary shadow" data-bs-theme="dark" data-enable-persistence="true" aria-label="Navigasi utama">
        <div className="sidebar-brand border-bottom">
          <Link to="/" className="brand-link">
            <i className="brand-image bi bi-broadcast-pin text-primary" aria-hidden="true" />
            <span className="brand-text fw-light">ATLAS</span>
          </Link>
        </div>
        <div className="sidebar-wrapper">
          <nav className="mt-2" aria-label="Menu utama">
            <ul className="nav sidebar-menu flex-column">
              <li className="nav-item">
                <Link
                  to={dashboardItem.to}
                  className={`nav-link ${pathname === dashboardItem.to ? 'active' : ''}`}
                  aria-current={pathname === dashboardItem.to ? 'page' : undefined}
                  title={dashboardItem.label}
                  onClick={closeMobileSidebar}
                >
                  <i className={`nav-icon bi ${dashboardItem.icon}`} aria-hidden="true" />
                  <p>{dashboardItem.label}</p>
                </Link>
              </li>
              {navigationGroups.map((group) => {
                const isOpen = openGroup === group.id
                const isActive = group.items.some((item) => item.to === pathname)
                return (
                  <li className={`nav-item ${isOpen ? 'menu-open' : ''}`} key={group.id}>
                    <button
                      className={`nav-link text-start border-0 ${isActive ? 'active' : ''}`}
                      type="button"
                      data-lte-toggle="treeview"
                      aria-expanded={isOpen}
                      aria-controls={`menu-${group.id}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        const menuItem = event.currentTarget.closest<HTMLElement>('.nav-item')
                        if (!menuItem) return

                        Treeview.getOrCreateInstance(menuItem).toggle()
                        setOpenGroup(menuItem.classList.contains('menu-open') ? group.id : null)
                      }}
                    >
                      <i className={`nav-icon bi ${group.icon}`} aria-hidden="true" />
                      <p>{group.label}<i className="nav-arrow bi bi-chevron-right" aria-hidden="true" /></p>
                    </button>
                    <ul id={`menu-${group.id}`} className="nav nav-treeview">
                      {group.items.map((item) => {
                        const active = pathname === item.to
                        return (
                          <li className="nav-item" key={item.to}>
                            <Link
                              to={item.to}
                              className={`nav-link ${active ? 'active' : ''}`}
                              aria-current={active ? 'page' : undefined}
                              title={item.label}
                              onClick={closeMobileSidebar}
                            >
                              <i className={`nav-icon bi ${item.icon}`} aria-hidden="true" />
                              <p>{item.label}</p>
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content-header">
          <div className="container-fluid">
            <div className="row">
              <div className="col-sm-6"><h3 className="mb-0">{title}</h3></div>
              <div className="col-sm-6">
                <ol className="breadcrumb float-sm-end mb-0">
                  <li className="breadcrumb-item"><Link to="/">ATLAS</Link></li>
                  <li className="breadcrumb-item active" aria-current="page">{title}</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
        <div className="app-content">
          <div className="container-fluid page-container">
            <Outlet />
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div><strong>ATLAS</strong> · Version 1.0.0</div>
      </footer>
    </div>
  )
}
