/** In-memory request cache: identical keys share one flight; a fresh hit skips the network. */

export function stableKey(path, body) {
  return `${path}\n${JSON.stringify(body ?? null)}`
}

const memory = new Map()
const flights = new Map()

export function cachedQuery(key, factory, { freshMs = 10000, staleMs = 60000 } = {}) {
  const now = Date.now()
  const hit = memory.get(key)
  if (hit && now - hit.at < freshMs) return Promise.resolve(hit.value)
  const refresh = () => {
    const pending = Promise.resolve()
      .then(factory)
      .then((value) => {
        memory.set(key, { at: Date.now(), value })
        flights.delete(key)
        return value
      })
      .catch((error) => {
        flights.delete(key)
        throw error
      })
    flights.set(key, pending)
    return pending
  }
  if (flights.has(key)) return flights.get(key)
  if (hit && now - hit.at < staleMs) {
    refresh().catch(() => {})
    return Promise.resolve(hit.value)
  }
  return refresh()
}

export function resetQueryCache() {
  memory.clear()
  flights.clear()
}
