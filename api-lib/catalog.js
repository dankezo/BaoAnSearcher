import { searchBackend } from './backend.js'
import * as tidbDb from './db/tidb.js'
import { getTurso } from './turso.js'
import { supabaseAsUser } from './supabaseClient.js'
import { metricsCacheKey } from './metricsCompute.js'

const SECTION_KEY = {
  vss: 'vss',
  dav: 'dav',
  msc: 'msc',
  msc_prices: 'msc',
  msc_tenders: 'msc',
}

function shapeMeta(rows, section) {
  const map = Object.fromEntries(rows.map((row) => [row.key, row]))
  const vss = map.vss?.value || {}
  const dav = map.dav?.value || {}
  const msc = map.msc?.value || {}
  const key = SECTION_KEY[section] || 'vss'
  const current = map[key]?.value || {}
  const count = Number(current.count ?? current.synced ?? current.prices ?? 0)
  return {
    dataVersion: map[key]?.updated_at || current.synced_at || current.updated || null,
    meta: {
      vss: Number(vss.count ?? vss.synced ?? 0),
      dav: Number(dav.count ?? dav.synced ?? 0),
      msc: Number(msc.tenders ?? msc.count ?? msc.synced ?? 0),
      updated: current.updated || current.synced_at || map[key]?.updated_at || null,
      count: section === 'msc_tenders' ? Number(msc.tenders ?? 0) : section === 'msc' || section === 'msc_prices' ? Number(msc.prices ?? count) : count,
      stats: section.startsWith('msc')
        ? {
          prices: Number(msc.prices ?? 0),
          tenders: Number(msc.tenders ?? msc.count ?? 0),
          total: Number(msc.prices ?? 0),
        }
        : { total: count },
    },
  }
}

async function readSupabase(section, accessToken) {
  const sb = supabaseAsUser(accessToken)
  const { data, error } = await sb.from('app_meta').select('key, value, updated_at')
  if (error) {
    const err = new Error('Chưa đọc được meta Supabase.')
    err.status = 502
    throw err
  }
  const shaped = shapeMeta(data || [], section)
  const metricsKey = metricsCacheKey(section)
  const metricsRow = (data || []).find((row) => row.key === metricsKey)
  const metrics = metricsRow?.value
  return {
    ...shaped,
    metrics_summary: metrics?.cards ? { ...metrics, cached: true } : null,
  }
}

async function readTurso(section) {
  const db = getTurso()
  const rs = await db.execute('SELECT key_name, total_records, updated_at FROM app_metadata')
  const meta = Object.fromEntries((rs.rows || []).map((row) => [
    row.key_name,
    { total: Number(row.total_records || 0), updated: row.updated_at || null },
  ]))
  const prices = meta.msc_prices_total
  const tenders = meta.msc_total
  const vss = meta.vss_total
  const dav = meta.dav_total
  const key = section === 'dav' ? 'dav_total' : section === 'msc_tenders' ? 'msc_total' : section.startsWith('msc') ? 'msc_prices_total' : 'vss_total'
  const row = meta[key]
  const metricsKey = metricsCacheKey(section)
  let metrics = null
  try {
    const cached = await db.execute({
      sql: 'SELECT value, updated_at FROM app_meta WHERE key = ? LIMIT 1',
      args: [metricsKey],
    })
    const hit = cached.rows?.[0]
    if (hit?.value) {
      const value = typeof hit.value === 'string' ? JSON.parse(hit.value) : hit.value
      if (value?.cards) metrics = { ...value, cached: true, cachedAt: hit.updated_at || null }
    }
  } catch {
    metrics = null
  }
  return {
    dataVersion: row?.updated || null,
    meta: {
      vss: vss?.total || 0,
      dav: dav?.total || 0,
      msc: tenders?.total || 0,
      updated: row?.updated || prices?.updated || null,
      count: row?.total || 0,
      stats: section.startsWith('msc')
        ? { prices: prices?.total || 0, tenders: tenders?.total || 0, total: prices?.total || 0 }
        : { total: row?.total || 0 },
    },
    metrics_summary: metrics,
  }
}

function emptyBootstrap(section) {
  const msc = String(section || '').startsWith('msc')
  return {
    dataVersion: null,
    meta: {
      vss: 0,
      dav: 0,
      msc: 0,
      updated: null,
      count: 0,
      stats: msc ? { prices: 0, tenders: 0, total: 0 } : { total: 0 },
    },
    metrics_summary: null,
  }
}

async function readTidb(section) {
  try {
    const rs = await tidbDb.query('SELECT key_name, total_records, updated_at FROM app_metadata')
    const meta = Object.fromEntries((rs.rows || []).map((row) => [
      row.key_name,
      { total: Number(row.total_records || 0), updated: row.updated_at || null },
    ]))
    const prices = meta.msc_prices_total
    const tenders = meta.msc_total
    const vss = meta.vss_total
    const dav = meta.dav_total
    const key = section === 'dav' ? 'dav_total' : section === 'msc_tenders' ? 'msc_total' : String(section).startsWith('msc') ? 'msc_prices_total' : 'vss_total'
    const row = meta[key]
    return {
      dataVersion: row?.updated || null,
      meta: {
        vss: vss?.total || 0,
        dav: dav?.total || 0,
        msc: tenders?.total || 0,
        updated: row?.updated || prices?.updated || null,
        count: row?.total || 0,
        stats: String(section).startsWith('msc')
          ? { prices: prices?.total || 0, tenders: tenders?.total || 0, total: prices?.total || 0 }
          : { total: row?.total || 0 },
      },
      metrics_summary: null,
    }
  } catch (error) {
    if (error.status === 503) throw error
    return emptyBootstrap(section)
  }
}

export async function readBootstrap(section, accessToken) {
  const backend = searchBackend()
  if (backend === 'tidb') return readTidb(section)
  if (backend === 'turso') return readTurso(section)
  return readSupabase(section, accessToken)
}
