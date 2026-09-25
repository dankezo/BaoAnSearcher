/**
 * Per-user UI prefs (filters / tags / view) — never shared across accounts.
 */
export function userStorageKey(userId, section, name = 'v1') {
  const uid = String(userId || 'anon').trim() || 'anon'
  return `baoan.user.${uid}.${section}.${name}`
}

export function loadUserJson(userId, section, name = 'v1', fallback = null) {
  try {
    const raw = localStorage.getItem(userStorageKey(userId, section, name))
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveUserJson(userId, section, name, value) {
  try {
    localStorage.setItem(userStorageKey(userId, section, name), JSON.stringify(value))
  } catch { /* quota / private mode */ }
}

export function userKeyPart(user) {
  return user?.id || user?.email || 'anon'
}
