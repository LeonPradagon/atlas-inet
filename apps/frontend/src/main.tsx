import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import 'bootstrap-icons/font/bootstrap-icons.css'
import 'admin-lte/dist/css/adminlte.min.css'
import './styles.css'
import { AppProviders } from './app/AppProviders'
import { router } from './app/router'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>,
)
