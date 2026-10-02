/**
 * Request timing for Server-Timing. Never log Authorization, tokens, or SQL args.
 */
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export function beginTiming(route) {
  const requestId = randomUUID()
  const spans = []
  const state = { dbMs: 0, dbTrips: 0, rows: null, bytes: null, status: null }

  return {
    requestId,
    add(name, ms) {
      const dur = Number(ms)
      if (!Number.isFinite(dur) || dur < 0) return
      spans.push({ name: String(name), ms: dur })
    },
    noteDb(ms) {
      const dur = Number(ms)
      if (!Number.isFinite(dur) || dur < 0) return
      state.dbMs += dur
      state.dbTrips += 1
    },
    finish(res, { rows = null, bytes = null, status = null } = {}) {
      state.rows = rows
      state.bytes = bytes
      state.status = status
      const parts = spans.map((s) => `${s.name};dur=${s.ms.toFixed(1)}`)
      if (state.dbTrips > 0) {
        parts.push(`db;dur=${state.dbMs.toFixed(1)};desc="trips=${state.dbTrips}"`)
      }
      if (parts.length && res && typeof res.setHeader === 'function') {
        res.setHeader('Server-Timing', parts.join(', '))
        res.setHeader('X-Request-Id', requestId)
      }
      const line = {
        lvl: 'perf',
        requestId,
        route,
        dbMs: Number(state.dbMs.toFixed(1)),
        dbTrips: state.dbTrips,
        rows: state.rows,
        bytes: state.bytes,
        status: state.status,
      }
      console.log(JSON.stringify(line))
      return line
    },
  }
}

/** Count execute() round-trips and accumulate db time. Does not log SQL. */
export function traceDb(db, timing) {
  if (!db || typeof db.execute !== 'function' || !timing) return db
  return {
    execute: async (stmt) => {
      const t0 = performance.now()
      try {
        return await db.execute(stmt)
      } finally {
        timing.noteDb(performance.now() - t0)
      }
    },
  }
}
