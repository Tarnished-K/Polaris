import { CATEGORY_META, type CategoryId } from '../domain/types'

interface CategoryMonogramProps {
  category: CategoryId
  size?: 'small' | 'medium' | 'large'
}

export function CategoryMonogram({ category, size = 'medium' }: CategoryMonogramProps) {
  const meta = CATEGORY_META[category]
  return (
    <span
      className={`category-monogram category-monogram--${size}`}
      style={{ color: meta.color, background: meta.background }}
      aria-hidden="true"
    >
      {meta.monogram}
    </span>
  )
}
