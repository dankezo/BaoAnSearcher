import { useState } from 'react'
import { useAuth } from './auth'
import { getRememberPreference } from './supabaseClient'

export default function LoginPage() {
  const { signIn, authError, setAuthError, allowedDomain, supabaseConfigured, rememberDays } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => getRememberPreference())
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState('')

  const err = localErr || authError

  const onSubmit = async (e) => {
    e.preventDefault()
    setLocalErr('')
    setAuthError('')
    if (!supabaseConfigured) {
      setLocalErr('Chưa cấu hình Supabase. Thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY vào web/.env.local.')
      return
    }
    const em = email.trim()
    if (!em || !password) {
      setLocalErr('Vui lòng nhập đầy đủ email và mật khẩu.')
      return
    }
    setBusy(true)
    try {
      const r = await signIn(em, password, { remember })
      if (r.ok) {
        const base = import.meta.env.BASE_URL || '/'
        const home = base.endsWith('/') ? base : `${base}/`
        window.history.replaceState(null, '', home)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-panel" role="main">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">B</span>
          <div>
            <div className="login-title">BaoAn Searcher</div>
            <div className="login-sub">Công cụ nội bộ · @{allowedDomain}</div>
          </div>
        </div>

        <h1 className="login-h1">Đăng nhập</h1>
        <p className="login-lead muted">
          Dùng email Outlook công ty (ví dụ sales@{allowedDomain}, importer@{allowedDomain}). Chỉ tài khoản Admin đã cấp mới vào được.
        </p>

        <form className="login-form" onSubmit={onSubmit} noValidate>
          <label className="login-field">
            <span>Email công ty</span>
            <input
              type="email"
              autoComplete="username"
              placeholder={`sales@${allowedDomain}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          <label className="login-field">
            <span>Mật khẩu</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <label className="login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={busy}
            />
            <span>Ghi nhớ đăng nhập {rememberDays || 30} ngày</span>
          </label>

          {err && (
            <div className="login-error" role="alert">{err}</div>
          )}

          <button type="submit" className="btn login-submit" disabled={busy}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>

        <p className="login-foot muted small">
          Bỏ tick “Ghi nhớ” thì phiên chỉ giữ đến khi đóng trình duyệt. Liên hệ Admin nếu cần cấp tài khoản mới.
        </p>
      </div>
      <div className="login-aside" aria-hidden="true">
        <div className="login-aside-inner">
          <strong>BaoAn Pharma</strong>
          <span>Tra cứu DAV · MSC · VSS BHYT</span>
        </div>
      </div>
    </div>
  )
}
