import { useEffect, useRef, useState } from 'react'
import './dateInput.css'

const display = value => value ? value.split('-').reverse().join('/') : ''

/** @param {ParentNode | null} [scope] */
export function validateDateInputs(scope = document) {
  const invalid = [...(scope?.querySelectorAll('input[data-date-input]:invalid') || [])].find(input => input.getClientRects().length)
  if (invalid) { invalid.reportValidity(); return false }
  return true
}

export default function DateInput({ value = '', onValueChange, ...props }) {
  const [text, setText] = useState(display(value))
  const picker = useRef(null), input = useRef(null)
  useEffect(() => { setText(display(value)); input.current?.setCustomValidity('') }, [value])
  function edit(event) {
    const next = event.currentTarget.value
    setText(next)
    const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next)
    const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : ''
    const date = iso ? new Date(`${iso}T00:00:00Z`) : null
    const valid = !next || (date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso)
    event.currentTarget.setCustomValidity(valid ? '' : 'Nhập ngày hợp lệ theo dd/mm/yyyy, ví dụ 01/06/2025.')
    if (valid) onValueChange(iso)
  }
  return <span className="date-input">
    <input {...props} ref={input} data-date-input type="text" inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} value={text} onInput={edit} onBlur={e => e.currentTarget.reportValidity()} />
    <button type="button" className="date-input-picker" aria-label={`Chọn ngày${props['aria-label'] ? ' · '+props['aria-label'] : ''}`} disabled={props.disabled} onClick={() => picker.current?.showPicker?.()}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3"/></svg>
    </button>
    <input ref={picker} className="date-input-native" type="date" value={value} disabled={props.disabled} aria-hidden="true" tabIndex={-1} onInput={e => { const iso=e.currentTarget.value; setText(display(iso)); input.current?.setCustomValidity(''); onValueChange(iso) }} />
  </span>
}
