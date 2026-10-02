export function userKeyPart(user) {
  return user?.id || user?.email || 'anon'
}

export function userJsonKey(key, user) {
  return `baoan.userjson.${userKeyPart(user)}.${key}`
}

function browserStorage() {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function loadUserJson(key, user, fallback = null) {
  const store = browserStorage()
  if (!store) return fallback
  try {
    const raw = store.getItem(userJsonKey(key, user))
    if (raw == null || raw === '') return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveUserJson(key, user, value) {
  const store = browserStorage()
  if (!store) return
  store.setItem(userJsonKey(key, user), JSON.stringify(value))
}
