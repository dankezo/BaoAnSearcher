import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LoginPage from './LoginPage'
import { AuthProvider, useAuth } from './auth'
import './styles.css'

function pathIsLogin() {
  const p = (window.location.pathname || '/').replace(/\/+$/, '') || '/'
  return p === '/login' || p.endsWith('/login')
}

function goLogin() {
  // Keep the destination across the Outlook round trip, which replaces the URL.
  if (window.location.hash === '#regulatory') {
    try { window.sessionStorage.setItem('baoan-login-destination', '#home') } catch { /* Storage may be disabled. */ }
  }
  const base = import.meta.env.BASE_URL || '/'
  const login = `${base.endsWith('/') ? base : `${base}/`}login`
  if (!pathIsLogin()) {
    window.history.replaceState(null, '', `${login}${window.location.hash}`)
  }
}

function goHome() {
  const base = import.meta.env.BASE_URL || '/'
  const home = base.endsWith('/') ? base : `${base}/`
  let destination = ''
  try {
    const stored = window.sessionStorage.getItem('baoan-login-destination')
    if (stored === '#home' || stored === '#regulatory') destination = '#home'
    window.sessionStorage.removeItem('baoan-login-destination')
  } catch { /* Preserve the current URL when browser storage is unavailable. */ }
  if (pathIsLogin() || destination) {
    window.history.replaceState(null, '', `${home}${destination || window.location.hash}`)
  }
}

function AuthGate() {
  const { session, loading } = useAuth()
  const [, setTick] = useState(0)

  useEffect(() => {
    const onPop = () => setTick((t) => t + 1)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (loading) return
    if (!session) goLogin()
    else goHome()
    setTick((t) => t + 1)
  }, [session, loading])

  if (loading) {
    return (
      <div className="auth-boot">
        <div className="auth-boot-card">Đang kiểm tra phiên đăng nhập…</div>
      </div>
    )
  }

  if (!session) return <LoginPage />
  return <App />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </React.StrictMode>,
)
