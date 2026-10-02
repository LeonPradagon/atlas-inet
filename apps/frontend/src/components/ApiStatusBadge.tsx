import { useApiHealth } from '../shared/api/ApiHealth'

export function ApiStatusBadge() {
  const status = useApiHealth()
  const config = {
    checking: { className: 'text-bg-secondary', label: 'Memeriksa API' },
    online: { className: 'text-bg-success', label: 'API online' },
    offline: { className: 'text-bg-warning', label: 'API offline' },
  }[status]

  return <span className={`badge ${config.className}`} role="status">{config.label}</span>
}
