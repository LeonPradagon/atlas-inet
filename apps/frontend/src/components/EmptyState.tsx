interface EmptyStateProps {
  icon: string
  title: string
  detail: string
  spacingClassName?: string
  iconSizeClassName?: string
}

export function EmptyState({
  icon,
  title,
  detail,
  spacingClassName = 'py-5',
  iconSizeClassName = 'display-5',
}: EmptyStateProps) {
  return (
    <div className={`text-center ${spacingClassName}`}>
      <i className={`bi ${icon} ${iconSizeClassName} text-secondary`} aria-hidden="true" />
      <h4 className="mt-3">{title}</h4>
      <p className="text-secondary mb-0">{detail}</p>
    </div>
  )
}
