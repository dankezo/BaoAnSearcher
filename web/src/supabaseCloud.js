import { getSupabase, supabaseConfigured } from './supabaseClient'

export { supabaseConfigured, getSupabase }

function fold(text) {
  const s = String(text ?? '').toLowerCase().replace(/đ/g, 'd')
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function foldParam(v) {
  const s = fold(v || '').trim()
  return s || null
}

/** Cloud search — same shape as local FastAPI `{ total, page, size, items }`. */
export async function cloudVssSearch({ filters = {}, page = 0, size = 100 } = {}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
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

export async function cloudDavSearch({ filters = {}, page = 0, size = 100 } = {}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
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

export async function cloudMscSearch({ kind = 'prices', filters = {}, page = 0, size = 100 } = {}) {
  const sb = getSupabase()
  if (!sb) throw new Error('Chưa cấu hình Supabase (VITE_SUPABASE_URL / ANON_KEY).')
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

export async function cloudMeta(section) {
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
