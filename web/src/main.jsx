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
  const base = import.meta.env.BASE_URL || '/'
  const login = `${base.endsWith('/') ? base : `${base}/`}login`
  if (!pathIsLogin()) {
    window.history.replaceState(null, '', login)
  }
}

function goHome() {
  const base = import.meta.env.BASE_URL || '/'
  const home = base.endsWith('/') ? base : `${base}/`
  if (pathIsLogin()) {
    window.history.replaceState(null, '', home)
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
