interface FormStatusProps {
  message: string
  tone?: 'info' | 'warning'
}

export function FormStatus({ message, tone = 'info' }: FormStatusProps) {
  if (!message) return null
  return <div className={`alert alert-${tone} mt-3 mb-0`} role="status">{message}</div>
}
