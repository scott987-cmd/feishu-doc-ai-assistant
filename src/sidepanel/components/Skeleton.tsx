import './Skeleton.css'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
  style?: React.CSSProperties
}

/** A single shimmering placeholder block. */
export function Skeleton({ width, height = 12, radius = 6, className = '', style }: SkeletonProps) {
  return (
    <span
      className={`skel ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  )
}

/** Placeholder card matching the template card layout (icon + 2 text lines + button). */
export function TemplateCardSkeleton() {
  return (
    <div className="sc-card sc-card--skeleton">
      <div className="sc-card-left">
        <Skeleton width={46} height={46} radius={13} />
      </div>
      <div className="sc-card-body">
        <Skeleton width="55%" height={13} />
        <Skeleton width="92%" height={11} style={{ marginTop: 8 }} />
        <Skeleton width="40%" height={11} style={{ marginTop: 6 }} />
      </div>
      <Skeleton width={52} height={30} radius={9} />
    </div>
  )
}
