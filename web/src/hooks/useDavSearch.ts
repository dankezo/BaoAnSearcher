import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sortByDateDesc } from '../api'
import { supabaseConfigured } from '../supabaseCloud'
import { useAuth } from '../auth'
import {
  applyColumnFilters,
  exportSelectionOrAll,
  fetchAllPages,
  resolvePageSize,
  serverFilters,
  useSectionMeta,
  useSelection,
  useLoadProgress,
  useTt20,
  DAV_METRICS_CAP,
} from '../components'
import { useTagFilterState } from '../TagFilterDropdown'
import { enrichRowTag } from '../tagConfig'
import { ingredientAllowedAtGrade } from '../tt20'
import { loadUserJson, saveUserJson, userKeyPart } from '../userPrefs'
import { applyMetricQuick } from '../metrics'
import { EMPTY_FILTERS, SERVER_MAP } from '../components/dav/davConfig'
import { useDavColumns } from '../components/dav/useDavColumns'
import { api, cloudDavSearch, cloudMetrics, davErrorMessage, readDavSession } from '../services/davService'
import type {
  ColumnFilters,
  DavFilters,
  DavMetricCard,
  DavMetricPatch,
  DavSearchResult,
  DavSectionProps,
  DavSuggestion,
  DrugItem,
} from '../types/dav'

const PAGE_SIZE_DEFAULT = 100
const METRICS_CAP = DAV_METRICS_CAP

export function useDavSearch({ localMode, embedded = false }: DavSectionProps) {
  const { user } = useAuth()
  const userId = userKeyPart(user)
  const { index: tt20Index } = useTt20()
  const [filters, setFilters] = useState<DavFilters>(EMPTY_FILTERS)
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({})
  const [filtersRow, setFiltersRow] = useState(false)
  const [filterModalOpen, setFilterModalOpen] = useState(false)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<DavSearchResult>({ total: 0, items: [], page: 0, size: 100 })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportPct, setExportPct] = useState(0)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<DrugItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [suggests, setSuggests] = useState<DavSuggestion[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [prefsReady, setPrefsReady] = useState(false)
  const [loadPct, setLoadPct] = useState<number | null>(null)
  const [metricsSample, setMetricsSample] = useState<DrugItem[] | null>(null)
  const [metricsCards, setMetricsCards] = useState<DavMetricCard[] | null>(null)
  const [metricsTotal, setMetricsTotal] = useState<number | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(false)
  const [metricsError, setMetricsError] = useState('')
  const [metricsRetry, setMetricsRetry] = useState(0)
  const [tableReady, setTableReady] = useState(false)
  const [metricActiveId, setMetricActiveId] = useState<string | null>(null)
  const [metricQuick, setMetricQuick] = useState<string | null>(null)
  const sim = useLoadProgress(loading, 'Đang lọc thuốc DAV', loadPct)
  const sel = useSelection<DrugItem>()
  const reqSeq = useRef(0)
  const sawTableLoad = useRef(false)
  useEffect(
    () => () => {
      reqSeq.current += 1
    },
    [],
  )
  const suggestSeq = useRef(0)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const meta = useSectionMeta('dav', localMode, null, refreshKey)
  const { selectedTags, draftTags, setDraftTags, setSelectedTags, commitDraft, configs } = useTagFilterState(userId)
  const filtersRef = useRef(filters)
  const columnFiltersRef = useRef(columnFilters)
  const selectedTagsRef = useRef(selectedTags)
  const pageSizeRef = useRef(pageSize)
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  selectedTagsRef.current = selectedTags
  pageSizeRef.current = pageSize

  // Restore per-user session filters (isolated by user id)
  useEffect(() => {
    const saved = readDavSession(loadUserJson(userId, 'dav', 'session', null))
    if (saved && typeof saved === 'object') {
      if (saved.filters) setFilters({ ...EMPTY_FILTERS, ...saved.filters, tags: null })
      if (saved.columnFilters) setColumnFilters(saved.columnFilters)
    }
    setPrefsReady(true)
  }, [userId])

  // Persist per-user session
  useEffect(() => {
    if (!prefsReady) return
    saveUserJson(userId, 'dav', 'session', {
      filters: { ...filters, tags: null },
      columnFilters,
    })
  }, [userId, prefsReady, filters, columnFilters])

  const cols = useDavColumns(configs)

  const mergedFilters = useCallback(
    (cf?: ColumnFilters, tagsOverride?: string[] | null): DavFilters => ({
      ...filtersRef.current,
      ...serverFilters(cf ?? columnFiltersRef.current, SERVER_MAP),
      tags: tagsOverride ?? selectedTagsRef.current,
    }),
    [],
  )

  const search = useCallback(
    async (
      p = 0,
      cf?: ColumnFilters,
      override: Partial<DavFilters> | null = null,
      tagsOverride: string[] | null = null,
    ) => {
      const id = ++reqSeq.current
      const stale = () => id !== reqSeq.current
      const size = resolvePageSize(pageSizeRef.current)
      setLoading(true)
      setErr('')
      const active = { ...mergedFilters(cf, tagsOverride), ...(override || {}) }
      try {
        if (localMode || supabaseConfigured) {
          const needGrade = Array.isArray(active.hangBenhVien)
            ? active.hangBenhVien.length > 0
            : !!active.hangBenhVien
          const searchFn = localMode
            ? (page: number, sz: number) => api.davSearch({ filters: active, page, size: sz })
            : (page: number, sz: number) => cloudDavSearch({ filters: active, page, size: sz })

          if (needGrade) {
            const allRaw = await fetchAllPages(searchFn, {
              size: Math.max(size, 400),
              onProgress: (pct) => {
                if (!stale()) setLoadPct(pct)
              },
            })
            if (stale()) return
            let items = allRaw.map(enrichRowTag)
            const grades = Array.isArray(active.hangBenhVien) ? active.hangBenhVien : [active.hangBenhVien]
            items = items.filter((r) =>
              grades.some((g) => ingredientAllowedAtGrade(tt20Index, r.hoatChat, g)),
            )
            items = sortByDateDesc(items, ['ngayCap', 'ngayGiaHan', 'ngayHetHan'])
            setData({ total: items.length, items, page: 0, size: items.length || size })
            setPage(0)
          } else {
            const res = await searchFn(p, size)
            if (stale()) return
            let items = (res.items || []).map(enrichRowTag)
            items = sortByDateDesc(items, ['ngayCap', 'ngayGiaHan', 'ngayHetHan'])
            setData({ ...res, items })
            setPage(p)
          }
          return
        }
        setErr('Chưa cấu hình Supabase. Thêm VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY rồi build lại.')
        setData({ total: 0, items: [], page: 0, size })
      } catch (e) {
        if (!stale()) setErr(davErrorMessage(e))
      } finally {
        if (!stale()) {
          setLoading(false)
          setLoadPct(null)
          setRefreshKey((k) => k + 1)
        }
      }
    },
    [localMode, mergedFilters, tt20Index],
  )

  // Draft filters are applied only on explicit search; suggestions remain debounced.
  useEffect(() => {
    if (!prefsReady) return
    search(0)
  }, [prefsReady, pageSize, search])

  // Track first table paint before loading metrics (avoids bandwidth contention)
  useEffect(() => {
    if (!prefsReady || embedded) return
    if (loading) sawTableLoad.current = true
    else if (sawTableLoad.current) setTableReady(true)
  }, [prefsReady, embedded, loading])

  // Metrics: cloud = 1 aggregate API; local = full catalog pages (deferred after table)
  useEffect(() => {
    if (!prefsReady || embedded || !tableReady) return undefined
    if (!(localMode || supabaseConfigured)) {
      setMetricsSample([])
      setMetricsError('Chưa cấu hình nguồn dữ liệu DAV.')
      return undefined
    }
    let cancelled = false
    setMetricsLoading(true)
    setMetricsError('')
    const finish = () => {
      if (!cancelled) setMetricsLoading(false)
    }
    if (!localMode) {
      cloudMetrics('dav')
        .then((payload) => {
          if (cancelled) return
          if (!payload) throw new Error('Missing metrics')
          setMetricsCards(payload.cards || [])
          setMetricsTotal(payload.total ?? payload.sampleSize ?? null)
          setMetricsSample(null)
        })
        .catch(() => {
          if (!cancelled) {
            setMetricsCards(null)
            setMetricsSample([])
            setMetricsError('Chưa tải được chỉ số DAV.')
          }
        })
        .finally(finish)
      return () => {
        cancelled = true
      }
    }
    const metricsFn = (page: number, sz: number) => api.davSearch({ filters: {}, page, size: sz })
    fetchAllPages(metricsFn, { size: 500, cap: METRICS_CAP, shouldCancel: () => cancelled })
      .then((all) => {
        if (cancelled) return
        setMetricsSample(all.map(enrichRowTag))
        setMetricsCards(null)
        setMetricsTotal(all.length)
      })
      .catch(() => {
        if (!cancelled) {
          setMetricsSample([])
          setMetricsError('Chưa tải được chỉ số DAV.')
        }
      })
      .finally(finish)
    return () => {
      cancelled = true
    }
  }, [prefsReady, localMode, embedded, tableReady, metricsRetry])

  const toSuggest = useCallback(
    (items: DrugItem[]) =>
      (items || []).slice(0, 4).map((r, i) => ({
        id: r.id ?? `${r.soDangKy}-${i}`,
        title: r.tenThuoc || r.soDangKy || '—',
        subtitle: [r.soDangKy, r.hoatChat].filter(Boolean).join(' · '),
        meta: r.hamLuong || '',
        row: r,
      })),
    [],
  )

  useEffect(() => {
    const id = ++suggestSeq.current
    const q = (filters.q || '').trim()
    clearTimeout(suggestTimer.current)
    if (q.length < 2) {
      setSuggests([])
      setSuggesting(false)
      return
    }
    suggestTimer.current = setTimeout(async () => {
      setSuggesting(true)
      try {
        let items: DrugItem[] = []
        if (localMode || supabaseConfigured) {
          const res = localMode
            ? await api.davSearch({
                filters: { ...mergedFilters(), q, tenThuoc: '', soDangKy: '', hoatChat: '' },
                page: 0,
                size: 4,
              })
            : await cloudDavSearch({
                filters: { ...mergedFilters(), q, tenThuoc: '', soDangKy: '', hoatChat: '' },
                page: 0,
                size: 4,
              })
          items = res?.items || []
        }
        if (id === suggestSeq.current) setSuggests(toSuggest(items))
      } catch {
        if (id === suggestSeq.current) setSuggests([])
      } finally {
        if (id === suggestSeq.current) setSuggesting(false)
      }
    }, 260)
    return () => {
      clearTimeout(suggestTimer.current)
      suggestSeq.current += 1
    }
  }, [filters.q, localMode, mergedFilters, toSuggest])

  const setF = <K extends keyof DavFilters>(key: K, val: DavFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: val }))
  const setCF = (key: string, val: string) => setColumnFilters((f) => ({ ...f, [key]: val }))
  const activeCF = Object.values(columnFilters).filter((v) => String(v ?? '').trim()).length
  const advancedActive = [
    filters.tenThuoc,
    filters.soDangKy,
    filters.hoatChat,
    filters.dangBaoChe,
    filters.sanXuat,
    filters.dangKy,
    filters.nuocSanXuat,
    filters.ingredientCount,
    filters.dosageFormCount,
    filters.strengthCount,
    filters.hangBenhVien,
  ].filter((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '')).length

  const fieldSuggest = useCallback(
    (fieldKey: string) => async (q: string) => {
      const needle = String(q || '').trim()
      try {
        let items: DrugItem[] = []
        if (localMode || supabaseConfigured) {
          const filters = needle
            ? { ...mergedFilters(), [fieldKey]: needle, q: '' }
            : { ...mergedFilters(), q: '' }
          const res = localMode
            ? await api.davSearch({ filters, page: 0, size: needle ? 40 : 80 })
            : await cloudDavSearch({ filters, page: 0, size: needle ? 40 : 80 })
          items = res?.items || []
        }
        const seen = new Set<string>()
        const out: string[] = []
        const rowKeyOf =
          (
            {
              tenThuoc: 'tenThuoc',
              soDangKy: 'soDangKy',
              hoatChat: 'hoatChat',
              dangBaoChe: 'dangBaoChe',
              sanXuat: 'ctySanXuat',
              dangKy: 'ctyDangKy',
              nuocSanXuat: 'nuocSanXuat',
            } as Record<string, keyof DrugItem>
          )[fieldKey] || (fieldKey as keyof DrugItem)
        for (const r of items) {
          const t = String(r[rowKeyOf] || '').trim()
          if (!t || seen.has(t)) continue
          seen.add(t)
          out.push(t)
          if (out.length >= (needle ? 8 : 12)) break
        }
        return out
      } catch {
        return []
      }
    },
    [localMode, mergedFilters],
  )

  const runSearch = useCallback(
    (override?: Partial<DavFilters>) => {
      setSuggestOpen(false)
      const tags = commitDraft()
      search(0, undefined, override || null, tags)
    },
    [search, commitDraft],
  )

  const rows = useMemo(() => {
    let list = applyColumnFilters(data.items, cols, columnFilters)
    list = applyMetricQuick(list, metricQuick, 'dav')
    return list
  }, [data.items, cols, columnFilters, metricQuick])
  const rowKey = useCallback(
    (r: DrugItem, i: number) => (r.id != null ? `id:${r.id}` : `${r.soDangKy}|${page}|${i}`),
    [page],
  )
  const pageSizeNum = resolvePageSize(pageSize)
  const metricsItems = metricsSample ?? data.items

  const onMetricFilter = useCallback(
    (patch: DavMetricPatch, id: string) => {
      if (metricActiveId === id) {
        setMetricActiveId(null)
        setMetricQuick(null)
        return
      }
      setMetricActiveId(id)
      if (patch?._tag) {
        setSelectedTags([patch._tag])
        setMetricQuick(null)
        search(0, undefined, null, [patch._tag])
        return
      }
      if (patch?._quick) {
        setMetricQuick(patch._quick)
        return
      }
      const rest = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !key.startsWith('_')),
      ) as Partial<DavFilters>
      if (Object.keys(rest).length) {
        setFilters((f) => ({ ...f, ...rest }))
        setMetricQuick(null)
        runSearch(rest)
      }
    },
    [metricActiveId, search, runSearch, setSelectedTags],
  )

  const fetchAll = useCallback(async () => {
    if (!localMode && !supabaseConfigured) return []
    const searchFn = localMode
      ? (p: number, size: number) => api.davSearch({ filters: mergedFilters(), page: p, size })
      : (p: number, size: number) => cloudDavSearch({ filters: mergedFilters(), page: p, size })
    const all = await fetchAllPages(searchFn, { onProgress: setExportPct })
    if (filters.hangBenhVien && (Array.isArray(filters.hangBenhVien) ? filters.hangBenhVien.length : true)) {
      const grades = Array.isArray(filters.hangBenhVien) ? filters.hangBenhVien : [filters.hangBenhVien]
      return all.filter((r) => grades.some((g) => ingredientAllowedAtGrade(tt20Index, r.hoatChat, g)))
    }
    return all
  }, [localMode, mergedFilters, filters, selectedTags, tt20Index])

  const doExport = async () => {
    setExporting(true)
    setExportPct(5)
    try {
      const n = await exportSelectionOrAll({
        columns: cols,
        selected: sel.selected,
        fetchAll,
        filename: 'DAV_thuoc',
        sheetName: 'DAV',
        columnFilters,
      })
      if (!n) setErr('Không có dòng nào để xuất.')
    } catch (e) {
      setErr(davErrorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return {
    metricsError,
    retryMetrics: () => setMetricsRetry((k) => k + 1),
    filters,
    setFilters,
    columnFilters,
    setColumnFilters,
    filtersRow,
    setFiltersRow,
    filterModalOpen,
    setFilterModalOpen,
    pageSize,
    setPageSize,
    page,
    setPage,
    data,
    loading,
    exporting,
    exportPct,
    err,
    setErr,
    detail,
    setDetail,
    suggests,
    setSuggests,
    suggestOpen,
    setSuggestOpen,
    suggesting,
    metricsSample,
    metricsCards,
    metricsTotal,
    metricsLoading,
    metricActiveId,
    sim,
    sel,
    meta,
    draftTags,
    setDraftTags,
    configs,
    userId,
    cols,
    search,
    setF,
    setCF,
    activeCF,
    advancedActive,
    fieldSuggest,
    runSearch,
    rows,
    rowKey,
    pageSizeNum,
    metricsItems,
    onMetricFilter,
    doExport,
    cancelSearch: () => {
      reqSeq.current += 1
      setLoading(false)
    },
    cancelExport: () => setExporting(false),
  }
}

export type DavSearchController = ReturnType<typeof useDavSearch>
