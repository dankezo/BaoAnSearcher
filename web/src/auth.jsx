import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  ALLOWED_EMAIL_DOMAIN,
  REMEMBER_DAYS,
  appRedirectUrl,
  enforceRememberWindow,
  getSupabase,
  isAllowedEmail,
  resetSupabaseClient,
  setRememberPreference,
  supabaseConfigured,
} from './supabaseClient'

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
  if (low.includes('provider is not enabled') || low.includes('unsupported provider')) {
    return 'Đăng nhập Outlook chưa bật trên máy chủ. Admin cần cấu hình Azure trong Supabase.'
  }
  return msg || 'Đăng nhập thất bại.'
}

async function rejectIfNotAllowed(sb, session) {
  const email = session?.user?.email
  if (!email || !isAllowedEmail(email)) {
    await sb.auth.signOut()
    return 'Tài khoản chưa được cấp quyền truy cập BaoAn Searcher.'
  }
  return null
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!enforceRememberWindow()) {
      setSession(null)
      setLoading(false)
      setAuthError(`Phiên đăng nhập đã hết hạn (${REMEMBER_DAYS} ngày). Vui lòng đăng nhập lại.`)
      return undefined
    }
    const sb = getSupabase()
    if (!sb) {
      setLoading(false)
      return undefined
    }
    let alive = true

    const applySession = async (s) => {
      if (!s) {
        setSession(null)
        return
      }
      const denied = await rejectIfNotAllowed(sb, s)
      if (denied) {
        setSession(null)
        setAuthError(denied)
        return
      }
      setSession(s)
      setAuthError('')
    }

    // OAuth / PKCE callback may land with ?code= or hash tokens
    const params = new URLSearchParams(window.location.search)
    const oauthErr = params.get('error_description') || params.get('error')
    if (oauthErr) {
      setAuthError(decodeURIComponent(String(oauthErr).replace(/\+/g, ' ')))
      const clean = appRedirectUrl()
      window.history.replaceState(null, '', clean)
    }

    sb.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      await applySession(data.session)
      if (alive) setLoading(false)
      // Strip OAuth query noise after session resolved
      if (params.has('code') || params.has('error')) {
        window.history.replaceState(null, '', appRedirectUrl())
      }
    }).catch(() => {
      if (alive) {
        setSession(null)
        setLoading(false)
      }
    })

    const { data: sub } = sb.auth.onAuthStateChange(async (_event, next) => {
      if (!alive) return
      await applySession(next)
    })
    return () => {
      alive = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email, password, { remember = true } = {}) => {
    setAuthError('')
    setRememberPreference(!!remember)
    resetSupabaseClient()
    const sb = getSupabase()
    if (!sb) {
      const m = 'Chưa cấu hình Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
      setAuthError(m)
      return { ok: false, error: m }
    }
    const em = String(email || '').trim().toLowerCase()
    if (!isAllowedEmail(em)) {
      const m = 'Tài khoản chưa được cấp quyền truy cập BaoAn Searcher.'
      setAuthError(m)
      return { ok: false, error: m }
    }
    if (!password) {
      const m = 'Vui lòng nhập mật khẩu.'
      setAuthError(m)
      return { ok: false, error: m }
    }
    const timeoutMs = 20000
    let timer
    try {
      const result = await Promise.race([
        sb.auth.signInWithPassword({ email: em, password }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
        }),
      ])
      const { data, error } = result
      if (error) {
        const m = mapAuthError(error)
        setAuthError(m)
        return { ok: false, error: m }
      }
      const denied = await rejectIfNotAllowed(sb, data.session)
      if (denied) {
        setAuthError(denied)
        return { ok: false, error: denied }
      }
      if (remember) setRememberPreference(true)
      setSession(data.session)
      return { ok: true }
    } catch (e) {
      const m = String(e?.message || e) === 'TIMEOUT'
        ? 'Máy chủ Auth không phản hồi (Supabase DB có thể đang lỗi/đầy ổ). Thử lại sau hoặc liên hệ Admin.'
        : mapAuthError(e)
      setAuthError(m)
      return { ok: false, error: m }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }, [])

  const signInWithOutlook = useCallback(async ({ remember = true } = {}) => {
    setAuthError('')
    setRememberPreference(!!remember)
    resetSupabaseClient()
    const sb = getSupabase()
    if (!sb) {
      const m = 'Chưa cấu hình Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).'
      setAuthError(m)
      return { ok: false, error: m }
    }
    try {
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          scopes: 'email openid profile offline_access',
          redirectTo: appRedirectUrl(),
          queryParams: {
            prompt: 'select_account',
          },
        },
      })
      if (error) {
        const m = mapAuthError(error)
        setAuthError(m)
        return { ok: false, error: m }
      }
      // Browser navigates to Microsoft; url present when redirect starts
      if (data?.url) {
        window.location.assign(data.url)
        return { ok: true, redirecting: true }
      }
      return { ok: true }
    } catch (e) {
      const m = mapAuthError(e)
      setAuthError(m)
      return { ok: false, error: m }
    }
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
    signInWithOutlook,
    signOut,
    supabaseConfigured,
    allowedDomain: ALLOWED_EMAIL_DOMAIN,
    rememberDays: REMEMBER_DAYS,
  }), [session, loading, authError, signIn, signInWithOutlook, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
