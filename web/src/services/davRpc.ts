import type { DavFilters } from '../types/dav'
export function nullableText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}
export function numericPage(value: unknown, fallback: number, minimum: number, maximum = 2147483647): number {
  const number = value == null || value === '' ? fallback : Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.floor(number))) : fallback
}
export function buildDavRpcParams(filters: Partial<DavFilters> = {}, page: unknown = 0, size: unknown = 100) {
  const f = filters ?? {}
  const optional = {
    sanXuat: nullableText(f.sanXuat),
    dangKy: nullableText(f.dangKy),
    nuocSanXuat: f.nuocSanXuat?.map(nullableText).filter((v): v is string => v !== null) ?? null,
    drugGroup: f.drugGroup?.map(nullableText).filter((v): v is string => v !== null) ?? null,
    tags: f.tags?.map(nullableText).filter((v): v is string => v !== null) ?? null,
    ingredientCount: nullableText(f.ingredientCount),
    ingredientCountOther: nullableText(f.ingredientCountOther),
    dosageFormCount: nullableText(f.dosageFormCount),
    dosageFormCountOther: nullableText(f.dosageFormCountOther),
    strengthCount: nullableText(f.strengthCount),
    strengthCountOther: nullableText(f.strengthCountOther),
  }
  return {
    p_q:
      nullableText(f.q)
        ?.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd') ?? null,
    p_ten_thuoc: nullableText(f.tenThuoc),
    p_so_dang_ky: nullableText(f.soDangKy),
    p_hoat_chat: nullableText(f.hoatChat),
    p_dang_bao_che: nullableText(f.dangBaoChe),
    p_page: numericPage(page, 0, 0),
    p_size: numericPage(size, 100, 1, 2000),
    p_filters: optional,
  }
}
