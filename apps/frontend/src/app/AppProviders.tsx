import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './query-client'
import { EntityScopeProvider } from '../shared/EntityScope'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <EntityScopeProvider>{children}</EntityScopeProvider>
    </QueryClientProvider>
  )
}
