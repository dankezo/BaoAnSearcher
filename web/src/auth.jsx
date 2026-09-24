import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ALLOWED_EMAIL_DOMAIN, getSupabase, isCompanyEmail, supabaseConfigured } from './supabaseClient'

const AuthContext = createContext(null)

function mapAuthError(err) {
  const msg = String(err?.message || err || '')
  const low = msg.toLowerCase()
  if (low.includes('invalid login') || low.includes('invalid credentials')) {
    return 'Email hoặc mật khẩu không đúng.'
  }
  if (low.includes('email not confirmed') || low.includes('not confirmed')) {
    return 'Tài khoản chưa kích hoạt. Liên hệ Admin để xác nhận email.'
  }
  if (low.includes('user not found')) {
    return 'Tài khoản không tồn tại. Liên hệ Admin để được cấp quyền.'
  }
  if (low.includes('signups not allowed') || low.includes('signup is disabled')) {
    return 'Không cho phép tự đăng ký. Liên hệ Admin để tạo tài khoản.'
  }
  return msg || 'Đăng nhập thất bại.'
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) {
      setLoading(false)
      return
    }
    let alive = true
    sb.auth.getSession().then(({ data }) => {
      if (!alive) return
      const s = data.session
      if (s?.user?.email && !isCompanyEmail(s.user.email)) {
        sb.auth.signOut()
        setSession(null)
        setAuthError('Tài khoản không thuộc quyền quản trị nội bộ')
      } else {
        setSession(s)
      }
      setLoading(false)
    }).catch(() => {
      if (alive) {
        setSession(null)
        setLoading(false)
      }
    })
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      if (next?.user?.email && !isCompanyEmail(next.user.email)) {
        sb.auth.signOut()
        setSession(null)
        setAuthError('Tài khoản không thuộc quyền quản trị nội bộ')
        return
      }
      setSession(next)
      setAuthError('')
    })
    return () => {
      alive = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email, password) => {
    setAuthError('')
    const sb = getSupabase()
    if (!sb) {
      const m = 'Chưa cấu hình Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
      setAuthError(m)
      return { ok: false, error: m }
    }
    const em = String(email || '').trim().toLowerCase()
    if (!isCompanyEmail(em)) {
      const m = 'Tài khoản không thuộc quyền quản trị nội bộ'
      setAuthError(m)
      return { ok: false, error: m }
    }
    if (!password) {
      const m = 'Vui lòng nhập mật khẩu.'
      setAuthError(m)
      return { ok: false, error: m }
    }
    const { data, error } = await sb.auth.signInWithPassword({ email: em, password })
    if (error) {
      const m = mapAuthError(error)
      setAuthError(m)
      return { ok: false, error: m }
    }
    if (data.user?.email && !isCompanyEmail(data.user.email)) {
      await sb.auth.signOut()
      const m = 'Tài khoản không thuộc quyền quản trị nội bộ'
      setAuthError(m)
      return { ok: false, error: m }
    }
    setSession(data.session)
    return { ok: true }
  }, [])

  const signOut = useCallback(async () => {
    const sb = getSupabase()
    if (sb) await sb.auth.signOut()
    setSession(null)
    setAuthError('')
  }, [])

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    loading,
    authError,
    setAuthError,
    signIn,
    signOut,
    supabaseConfigured,
    allowedDomain: ALLOWED_EMAIL_DOMAIN,
  }), [session, loading, authError, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
