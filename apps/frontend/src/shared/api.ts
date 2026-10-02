import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export const API_SERVICE_BASE = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || '/api/v1')
export const AUTH_SERVICE_BASE = normalizeBaseUrl(import.meta.env.VITE_AUTH_BASE_URL || '/api/auth')

export const API_ENDPOINTS = {
  healthLive: `${API_SERVICE_BASE}/health/live`,
  healthReady: `${API_SERVICE_BASE}/health/ready`,
  currentUser: `${API_SERVICE_BASE}/me`,
  signInEmail: `${AUTH_SERVICE_BASE}/sign-in/email`,
  signOut: `${AUTH_SERVICE_BASE}/sign-out`,
} as const

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface CurrentUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

export interface CurrentUserResponse {
  user: CurrentUser
  entities: string[]
  permissions: string[]
}

export const currentUserQueryKey = ['auth', 'current-user'] as const

function responseMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const payload = data as Record<string, unknown>
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.error === 'object' && payload.error !== null && 'message' in payload.error) {
    const message = payload.error.message
    if (typeof message === 'string') return message
  }
  return undefined
}

function createHttpClient(): AxiosInstance {
  const client = axios.create({
    headers: { Accept: 'application/json' },
    withCredentials: true,
  })

  client.interceptors.request.use((config) => {
    config.headers.set('Accept', 'application/json')
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (axios.isAxiosError(error)) {
        return Promise.reject(new ApiError(
          responseMessage(error.response?.data) ?? error.message ?? 'API request failed',
          error.response?.status,
        ))
      }
      return Promise.reject(error instanceof Error ? error : new Error('Unexpected API error'))
    },
  )

  return client
}

export const axiosClient = createHttpClient()

export const atlasApi = {
  health: {
    async readiness(config?: AxiosRequestConfig): Promise<boolean> {
      await axiosClient.get(API_ENDPOINTS.healthReady, {
        ...config,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
      })
      return true
    },
  },
  auth: {
    async signIn(email: string, password: string): Promise<void> {
      await axiosClient.post(API_ENDPOINTS.signInEmail, { email, password, callbackURL: '/' })
    },
    async signOut(): Promise<void> {
      await axiosClient.post(API_ENDPOINTS.signOut)
    },
    async currentUser(signal?: AbortSignal): Promise<CurrentUserResponse> {
      const response = await axiosClient.get<{ data: CurrentUserResponse }>(API_ENDPOINTS.currentUser, { signal })
      return response.data.data
    },
  },
}
