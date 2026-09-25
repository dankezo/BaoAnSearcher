/**
 * Hybrid cloud search: Supabase Auth session → Vercel /api/tender → Turso.
 * Falls back to Supabase RPC if Turso API is unavailable (503).
 */
import { getSupabase, supabaseConfigured } from './supabaseClient'

export { supabaseConfigured, getSupabase }

/** Prefer Turso hybrid when auth is configured (API verifies JWT). */
export const tursoHybridEnabled = supabaseConfigured

function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function foldParam(v) {
  const s = fold(v || '').trim()
  return s || null
}

async function accessToken() {
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase Auth.')
  const { data, error } = await sb.auth.getSession()
  if (error) throw new Error(error.message)
  const token = data.session?.access_token
  if (!token) throw new Error('Unauthorized — vui lòng đăng nhập lại.')
  return token
}

async function tenderFetch(path, body) {
  const token = await accessToken()
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { error: text }
  }
  if (!res.ok) {
    const err = new Error(payload?.error || text || res.statusText)
    err.status = res.status
    throw err
  }
  return payload
}

async function supabaseVss(filters, page, size) {
  const sb = getSupabase()
  const f = filters || {}
  let nam = null
  if (f.nam != null && String(f.nam).trim() !== '') {
    const n = parseInt(String(f.nam).trim(), 10)
    if (!Number.isNaN(n)) nam = n
  }
  const { data, error } = await sb.rpc('search_vss_bids', {
    p_q: foldParam(f.q),
    p_hoatchat: foldParam(f.hoatchat) || (f.hoatchat ? String(f.hoatchat).trim() : null),
    p_sodk: f.sodk ? String(f.sodk).trim() : null,
    p_loai: f.loai ? String(f.loai).trim() : null,
    p_nhomthau: f.nhomthau ? String(f.nhomthau).trim() : null,
    p_loai_thau: f.loai_thau ? String(f.loai_thau).trim() : null,
    p_duongdung: f.duongdung ? String(f.duongdung).trim() : null,
    p_ma_tinh: f.ma_tinh ? String(f.ma_tinh).trim() : null,
    p_nuocsx: f.nuocsx ? String(f.nuocsx).trim() : null,
    p_nam: nam,
    p_tu_ngay: f.tuNgay || null,
    p_den_ngay: f.denNgay || null,
    p_page: page,
    p_size: size,
  })
  if (error) throw new Error(error.message || String(error))
  const payload = typeof data === 'string' ? JSON.parse(data) : data
  return {
    total: payload?.total ?? 0,
    page: payload?.page ?? page,
    size: payload?.size ?? size,
    items: payload?.items || [],
  }
}

/** Cloud search — Turso first, Supabase RPC fallback. */
export async function cloudVssSearch({ filters = {}, page = 0, size = 100 } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: 'vss',
      filters,
      page,
      size,
    })
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: payload?.items || [],
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    // Turso API missing / not deployed yet → legacy Supabase
    return supabaseVss(filters, page, size)
  }
}

export async function cloudDavSearch({ filters = {}, page = 0, size = 100 } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: 'dav',
      filters,
      page,
      size,
    })
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: payload?.items || [],
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    const sb = getSupabase()
    const f = filters || {}
    const { data, error } = await sb.rpc('search_dav_drugs', {
      p_q: foldParam(f.q),
      p_ten_thuoc: f.tenThuoc ? String(f.tenThuoc).trim() : null,
      p_so_dang_ky: f.soDangKy ? String(f.soDangKy).trim() : null,
      p_hoat_chat: f.hoatChat ? String(f.hoatChat).trim() : null,
      p_dang_bao_che: f.dangBaoChe ? String(f.dangBaoChe).trim() : null,
      p_page: page,
      p_size: size,
    })
    if (error) throw new Error(error.message || String(error))
    const payload = typeof data === 'string' ? JSON.parse(data) : data
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: payload?.items || [],
    }
  }
}

export async function cloudMscSearch({ kind = 'prices', filters = {}, page = 0, size = 100 } = {}) {
  if (!supabaseConfigured) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
  try {
    const payload = await tenderFetch('/api/tender/search', {
      kind: kind === 'tenders' ? 'msc_tenders' : 'msc_prices',
      filters,
      page,
      size,
    })
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: payload?.items || [],
    }
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw e
    const sb = getSupabase()
    const f = filters || {}
    const { data, error } = await sb.rpc('search_msc', {
      p_kind: kind === 'tenders' ? 'tenders' : 'prices',
      p_q: foldParam(f.q),
      p_page: page,
      p_size: size,
    })
    if (error) throw new Error(error.message || String(error))
    const payload = typeof data === 'string' ? JSON.parse(data) : data
    return {
      total: payload?.total ?? 0,
      page: payload?.page ?? page,
      size: payload?.size ?? size,
      items: payload?.items || [],
    }
  }
}

export async function cloudMeta(section) {
  if (!supabaseConfigured) return null
  try {
    return await tenderFetch('/api/tender/meta', { section })
  } catch {
    const sb = getSupabase()
    if (!sb) return null
    const { data, error } = await sb.from('app_meta').select('value, updated_at').eq('key', section).maybeSingle()
    if (error || !data) return null
    const value = data.value || {}
    return {
      ...value,
      updated: value.updated || value.synced_at || data.updated_at,
      count: value.count ?? value.synced ?? value.prices ?? null,
    }
  }
}
