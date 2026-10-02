import type { ReactNode } from 'react'

interface ContentCardProps {
  title: ReactNode
  children: ReactNode
  tools?: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'div' | 'section'
}

export function ContentCard({
  title,
  children,
  tools,
  className = '',
  bodyClassName = '',
  as = 'section',
}: ContentCardProps) {
  const CardElement = as

  return (
    <CardElement className={['card', className].filter(Boolean).join(' ')}>
      <div className="card-header">
        <h3 className="card-title">{title}</h3>
        {tools != null && <div className="card-tools">{tools}</div>}
      </div>
      <div className={['card-body', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </CardElement>
  )
}
