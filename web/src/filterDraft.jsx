import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Owns in-progress filter text. The parent state (and the results table)
 * updates only when commit() or reset() runs — Tìm kiếm, Enter, or a suggestion.
 */
export const FilterDraft = forwardRef(function FilterDraft({ applied, children }, ref) {
  const [draft, setDraft] = useState(applied)
  const draftRef = useRef(applied)
  const appliedKey = JSON.stringify(applied ?? {})

  useEffect(() => {
    const next = JSON.parse(appliedKey)
    draftRef.current = next
    setDraft(next)
  }, [appliedKey])

  const setF = (key, value) => {
    const next = { ...draftRef.current, [key]: value }
    draftRef.current = next
    setDraft(next)
  }

  useImperativeHandle(ref, () => ({
    commit(override) {
      const next = { ...draftRef.current, ...(override || {}) }
      draftRef.current = next
      setDraft(next)
      return next
    },
    reset(empty) {
      draftRef.current = empty
      setDraft(empty)
      return empty
    },
  }), [])

  return children(draft, setF)
})
