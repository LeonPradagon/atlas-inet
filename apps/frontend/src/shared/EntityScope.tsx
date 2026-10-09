import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { atlasApi, currentUserQueryKey } from './api'
import type { CurrentUser, CurrentUserResponse } from './api'
import type { EntityAccess } from './domain-types'

export function resolveEntity(access: EntityAccess[]): EntityAccess | undefined {
  return access[0]
}
const ScopeContext = createContext<{ entity?: EntityAccess; entities: EntityAccess[]; user?: CurrentUser; can: (permission: string) => boolean } | null>(null)
export function EntityScopeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const session = useQuery<CurrentUserResponse>({ queryKey: currentUserQueryKey, queryFn: ({ signal }) => atlasApi.auth.currentUser(signal), retry: false, staleTime: 30_000 })
  useEffect(() => {
    const expire = () => {
      void client.cancelQueries({ queryKey: ['atlas'] })
      client.removeQueries({ queryKey: ['atlas'] })
      // Reset removes stale identity immediately while the session is rechecked.
      void client.resetQueries({ queryKey: currentUserQueryKey })
    }
    window.addEventListener('atlas-session-expired', expire)
    return () => window.removeEventListener('atlas-session-expired', expire)
  }, [client])
  const entities = session.isSuccess ? session.data.entityAccess ?? [] : []
  const entity = resolveEntity(entities)
  return <ScopeContext.Provider value={{ entity, entities, user: session.isSuccess ? session.data.user : undefined, can: (permission) => Boolean(entity?.permissions.includes(permission)) }}>{children}</ScopeContext.Provider>
}
export function useEntityScope() {
  const context = useContext(ScopeContext)
  if (!context) throw new Error('EntityScopeProvider is required')
  return context
}
export const domainKey = (entityId: string | undefined, userId: string | undefined, ...parts: unknown[]) => ['atlas', userId ?? '', entityId ?? '', ...parts] as const
export const pagePermissions: Record<string, string[]> = {
  '/network': ['network.read'], '/analysis': ['analysis.create', 'analysis.bulk', 'analysis.read'],
  '/bookings': ['bookings.read', 'bookings.create'], '/waiting-list': ['waiting-list.read', 'waiting-list.create'],
  '/assets': ['network.read', 'imports.write', 'network.master-write'], '/reports': ['reports.read', 'reports.export'],
  '/notifications': ['notifications.read'], '/settings': ['settings.read'], '/access-audit': ['audit.read'],
  '/accounts': ['accounts.manage'],
}
