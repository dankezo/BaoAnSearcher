import { useState } from 'react'
import { useAuth } from './auth'
import { getRememberPreference } from './supabaseClient'

export default function LoginPage() {
  const {
    signIn, signInWithOutlook, authError, setAuthError,
    allowedDomain, supabaseConfigured, rememberDays,
  } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(() => getRememberPreference())
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [localErr, setLocalErr] = useState('')

  const err = localErr || authError

  const onOutlook = async () => {
    setLocalErr('')
    setAuthError('')
    if (!supabaseConfigured) {
      setLocalErr('Chưa cấu hình Supabase.')
      return
    }
    setBusy(true)
    try {
      const r = await signInWithOutlook({ remember })
      if (!r.ok && !r.redirecting) setBusy(false)
      // if redirecting, leave busy spinner until navigation
    } catch {
      setBusy(false)
    }
  }

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
        window.history.replaceState(null, '', `${window.location.origin}/`)
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
          Nhân viên Sales / Import: đăng nhập bằng tài khoản Outlook công ty.
          Chỉ email đã được Admin cấp quyền mới vào được hệ thống.
        </p>

        <div className="login-form">
          <label className="login-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={busy}
            />
            <span>Ghi nhớ đăng nhập {rememberDays || 30} ngày</span>
          </label>

          <button
            type="button"
            className="btn login-outlook"
            onClick={onOutlook}
            disabled={busy}
          >
            <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
              <path fill="#f35325" d="M1 1h10v10H1z" />
              <path fill="#81bc06" d="M12 1h10v10H12z" />
              <path fill="#05a6f0" d="M1 12h10v10H1z" />
              <path fill="#ffba08" d="M12 12h10v10H12z" />
            </svg>
            {busy ? 'Đang chuyển tới Outlook…' : 'Đăng nhập với Outlook'}
          </button>

          {err && (
            <div className="login-error" role="alert">{err}</div>
          )}

          <button
            type="button"
            className="login-toggle-password"
            onClick={() => setShowPassword((v) => !v)}
            disabled={busy}
          >
            {showPassword ? 'Ẩn đăng nhập mật khẩu' : 'Admin · đăng nhập bằng mật khẩu'}
          </button>
        </div>

        {showPassword && (
          <form className="login-form login-password-form" onSubmit={onSubmit} noValidate>
            <label className="login-field">
              <span>Email nội bộ</span>
              <input
                type="email"
                autoComplete="username"
                placeholder={`admin@${allowedDomain}`}
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
            <button type="submit" className="btn login-submit" disabled={busy}>
              {busy ? 'Đang đăng nhập…' : 'Đăng nhập mật khẩu'}
            </button>
          </form>
        )}

        <p className="login-foot muted small">
          Outlook: sales@{allowedDomain}, importer@{allowedDomain}.
          Bỏ tick “Ghi nhớ” thì phiên chỉ giữ đến khi đóng trình duyệt.
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
