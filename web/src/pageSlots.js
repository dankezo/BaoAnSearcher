/** Page-number buttons, at most five. `page` is 0-based. */

export function pageSlots(page, pageCount) {
  const total = Math.max(0, Number(pageCount) || 0)
  if (total <= 0) return []
  if (total <= 5) return Array.from({ length: total }, (_, i) => i)
  const last = total - 1
  const cur = Math.min(Math.max(0, Number(page) || 0), last)
  if (cur <= 2) return [0, 1, 2, 'gap', last]
  if (cur >= last - 2) return [0, 'gap', last - 2, last - 1, last]
  return [0, 'gap', cur, 'gap', last]
}
