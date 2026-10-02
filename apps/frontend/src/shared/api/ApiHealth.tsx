import { createContext, useContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { atlasApi } from '../api'

type ApiStatus = 'checking' | 'online' | 'offline'

const ApiHealthContext = createContext<ApiStatus>('checking')

export function ApiHealthProvider({ children }: { children: ReactNode }) {
  const { isPending, isSuccess } = useQuery({
    queryKey: ['system', 'api-health'],
    queryFn: ({ signal }) => atlasApi.health.readiness({ signal }),
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })

  const status: ApiStatus = isPending ? 'checking' : isSuccess ? 'online' : 'offline'
  return <ApiHealthContext.Provider value={status}>{children}</ApiHealthContext.Provider>
}

export function useApiHealth() {
  return useContext(ApiHealthContext)
}
