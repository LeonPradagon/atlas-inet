import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const frontendRoot = dirname(fileURLToPath(import.meta.url))
  const repositoryRoot = resolve(frontendRoot, '../..')
  const env = loadEnv(mode, repositoryRoot, 'VITE_')

  return {
    root: frontendRoot,
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
  }
})
