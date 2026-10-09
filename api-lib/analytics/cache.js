// Bounded process cache shares in-flight requests and never publishes user data.
const entries = new Map(), flights = new Map()
export async function memo(key, factory, ttl = 300000) {
  const hit = entries.get(key)
  if (hit && Date.now() - hit.at < ttl) return { ...hit.value, cached: true }
  if (flights.has(key)) return flights.get(key)
  const pending = Promise.resolve().then(factory).then(value => {
    if (entries.size >= 128) entries.delete(entries.keys().next().value)
    entries.set(key, { at: Date.now(), value }); return value
  }).finally(()=>flights.delete(key))
  flights.set(key,pending); return pending
}
export function clearAnalyticsCache() { entries.clear(); flights.clear() }
