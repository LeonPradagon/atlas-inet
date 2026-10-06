import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { initialize, PushMenu, teardown, Treeview } from 'admin-lte'
import { atlasApi, currentUserQueryKey } from '../shared/api'
import { pagePermissions, useEntityScope } from '../shared/EntityScope'
import { PermissionNotice } from '../components/DomainUi'
import { NotificationBell } from '../components/NotificationBell'

const SIDEBAR_OPENED_EVENT = 'opened.lte.push-menu'
const SIDEBAR_COLLAPSED_EVENT = 'collapsed.lte.push-menu'

const dashboardItem = { label: 'Dashboard', to: '/', icon: 'bi-speedometer2' }

const navigationGroups = [
  {
    id: 'jaringan-analisis',
    label: 'Jaringan & Analisis',
    icon: 'bi-diagram-3',
    items: [
      { label: 'Analisis Lokasi', to: '/analysis', icon: 'bi-geo-alt' },
      { label: 'Peta Jaringan', to: '/network', icon: 'bi-map' },
      { label: 'Aset & Impor Jaringan', to: '/assets', icon: 'bi-diagram-3' },
    ],
  },
  {
    id: 'booking-kapasitas',
    label: 'Booking & Kapasitas',
    icon: 'bi-bookmark-check',
    items: [
      { label: 'Booking Core', to: '/bookings', icon: 'bi-bookmark-check' },
      { label: 'Daftar Tunggu', to: '/waiting-list', icon: 'bi-list-ol' },
    ],
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: 'bi-bar-chart',
    items: [
      { label: 'Laporan & Ekspor', to: '/reports', icon: 'bi-file-earmark-spreadsheet' },
      { label: 'Notifikasi', to: '/notifications', icon: 'bi-bell' },
    ],
  },
  {
    id: 'administrasi',
    label: 'Administrasi',
    icon: 'bi-gear',
    items: [
      { label: 'Pengaturan', to: '/settings', icon: 'bi-gear' },
      { label: 'Audit Log', to: '/access-audit', icon: 'bi-journal-text' },
    ],
  },
] as const

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/network': 'Peta Jaringan',
  '/analysis': 'Analisis Lokasi',
  '/bookings': 'Booking Core',
  '/waiting-list': 'Waiting List',
  '/assets': 'Aset & Impor Jaringan',
  '/reports': 'Laporan & Ekspor',
  '/notifications': 'Notifikasi',
  '/settings': 'Pengaturan',
  '/access-audit': 'Audit Log',
}

export function AppShell() {
  const navigate = useNavigate()
  const scope = useEntityScope()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const title = pageTitles[pathname] ?? 'ATLAS'
  const isLoginPage = pathname === '/login'
  const [sidebarExpanded, setSidebarExpanded] = useState(() => window.matchMedia('(min-width: 992px)').matches)
  const activeGroup = navigationGroups.find((group) => group.items.some((item) => item.to === pathname))?.id ?? null
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup)
  const [sessionMessage, setSessionMessage] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLLIElement>(null)
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
      await queryClient.cancelQueries({ queryKey: ['atlas'] })
      queryClient.removeQueries({ queryKey: ['atlas'] })
      await queryClient.resetQueries({ queryKey: currentUserQueryKey })
      await navigate({ to: '/login' })
    },
    onError: () => setSessionMessage('Tidak dapat mengakhiri sesi. Coba lagi.'),
  })

  useEffect(() => {
    setOpenGroup(activeGroup)
  }, [activeGroup])

  useEffect(() => {
    if (!userMenuOpen) return

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false)
        userMenuRef.current?.querySelector<HTMLButtonElement>('#user-menu-toggle')?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [userMenuOpen])

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
            <NotificationBell />
            {currentUserQuery.data
              ? <li className={`nav-item dropdown user-menu ${userMenuOpen ? 'show' : ''}`} ref={userMenuRef}>
                  <button
                    id="user-menu-toggle"
                    className="nav-link dropdown-toggle d-flex align-items-center gap-2"
                    type="button"
                    aria-expanded={userMenuOpen}
                    aria-controls="user-menu-dropdown"
                    onClick={() => setUserMenuOpen((open) => !open)}
                  >
                    <i className="bi bi-person-circle fs-5" aria-hidden="true" />
                    <span>{currentUserQuery.data.user.name}</span>
                  </button>
                  <ul id="user-menu-dropdown" className={`dropdown-menu dropdown-menu-lg dropdown-menu-end ${userMenuOpen ? 'show' : ''}`} aria-labelledby="user-menu-toggle">
                    <li className="user-header bg-primary text-white">
                      <div className="user-menu-avatar bg-white text-primary rounded-circle d-flex align-items-center justify-content-center mx-auto" aria-hidden="true">
                        <i className="bi bi-person-fill" />
                      </div>
                      <p>{currentUserQuery.data.user.name}<small>{currentUserQuery.data.user.email}</small></p>
                    </li>
                    <li className="user-footer d-flex justify-content-end">
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        type="button"
                        disabled={signOutMutation.isPending}
                        onClick={() => {
                          setUserMenuOpen(false)
                          signOutMutation.mutate()
                        }}
                      >
                        <i className="bi bi-box-arrow-right me-1" aria-hidden="true" />
                        {signOutMutation.isPending ? 'Keluar…' : 'Logout'}
                      </button>
                    </li>
                  </ul>
                </li>
              : <li className="nav-item"><Link to="/login" className="nav-link">Masuk</Link></li>}
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
                const items = group.items.filter((item) => pagePermissions[item.to]?.some(scope.can))
                if (!items.length) return null
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
                      {items.map((item) => {
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
            {pathname !== '/' && !pagePermissions[pathname]?.some(scope.can) ? <PermissionNotice /> : <div key={`${currentUserQuery.data?.user.id}:${scope.entity?.id ?? 'none'}:${scope.entity?.permissions.join(',')}`}><Outlet /></div>}
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div><strong>ATLAS</strong> · Version 1.0.0</div>
      </footer>
    </div>
  )
}
