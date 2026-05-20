import { useState } from 'react'

/**
 * StaffAvatar — аватар мастера. Если есть URL — отдаёт img. Если нет, или
 * img упало (404, CORS) — fallback на инициал на цветном круге.
 *
 * Размеры: sm = 24px, md = 32px (default), lg = 40px.
 */
const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return STAFF_PALETTE[hash % STAFF_PALETTE.length]!
}

export function StaffAvatar({
  avatarUrl,
  fullName,
  size = 'md',
}: {
  avatarUrl: string | null | undefined
  fullName: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const [failed, setFailed] = useState(false)
  const px = size === 'sm' ? 24 : size === 'lg' ? 40 : 32
  const initial = fullName.charAt(0).toUpperCase() || '?'
  const showImage = !!avatarUrl && !failed

  if (showImage) {
    return (
      <img
        src={avatarUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: px, height: px }}
        className="shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <div
      style={{ width: px, height: px, backgroundColor: colorForName(fullName) }}
      className="grid shrink-0 place-items-center rounded-full text-[11px] font-bold text-stone-700"
      aria-hidden
    >
      {initial}
    </div>
  )
}
