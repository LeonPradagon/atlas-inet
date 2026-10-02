import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from '../layout/AppShell'
import { AnalysisPage } from '../pages/AnalysisPage'
import { AssetsPage } from '../pages/AssetsPage'
import { BookingsPage } from '../pages/BookingsPage'
import { DashboardPage } from '../pages/DashboardPage'
import { LoginPage } from '../pages/LoginPage'
import { NetworkMapPage } from '../pages/NetworkMapPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { ReportsPage } from '../pages/ReportsPage'
import { SettingsPage } from '../pages/SettingsPage'
import { UsersAuditPage } from '../pages/UsersAuditPage'
import { WaitingListPage } from '../pages/WaitingListPage'

const rootRoute = createRootRoute({
  component: AppShell,
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const analysisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analysis',
  component: AnalysisPage,
})

const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  component: NetworkMapPage,
})

const bookingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bookings',
  component: BookingsPage,
})

const waitingListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/waiting-list',
  component: WaitingListPage,
})

const assetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/assets',
  component: AssetsPage,
})

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: ReportsPage,
})

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notifications',
  component: NotificationsPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const accessAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/access-audit',
  component: UsersAuditPage,
})

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  loginRoute,
  analysisRoute,
  networkRoute,
  bookingsRoute,
  waitingListRoute,
  assetsRoute,
  reportsRoute,
  notificationsRoute,
  settingsRoute,
  accessAuditRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
