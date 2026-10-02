import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SHORT_SEARCH_NOTE, skipShortTextSearch, sortByDateDesc } from '../api'
import { supabaseConfigured, cloudSuggest, cloudCount } from '../supabaseCloud'
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
} from '../components'
import { useTagFilterState } from '../TagFilterDropdown'
import { DEFAULT_TAG_CONFIGS, enrichRowTag } from '../tagConfig'
import { userKeyPart } from '../userPrefs'
import { applyMetricQuick } from '../metrics'
import { EMPTY_FILTERS, SERVER_MAP } from '../components/dav/davConfig'
import { useDavColumns } from '../components/dav/useDavColumns'
import { api, cloudDavSearch, cloudMetrics, davErrorMessage } from '../services/davService'
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
const DAV_TEXT_KEYS = ['q', 'tenThuoc', 'soDangKy', 'hoatChat', 'dangBaoChe', 'sanXuat', 'dangKy']
const METRICS_REFRESH_NOTE = 'Chưa chạy làm mới dữ liệu hàng ngày — chỉ số DAV chưa được lưu.'

export function useDavSearch({ localMode, embedded = false }: DavSectionProps) {
  const { user } = useAuth()
  const userId = userKeyPart(user)
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
  const pageRef = useRef(0)
  const cursorRef = useRef<Record<string, string> | null>(null)
  filtersRef.current = filters
  columnFiltersRef.current = columnFilters
  selectedTagsRef.current = selectedTags
  pageSizeRef.current = pageSize


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
      const active = { ...mergedFilters(cf, tagsOverride), ...(override || {}) }
      const check = { ...active }
      if (Array.isArray(check.tags) && check.tags.length >= DEFAULT_TAG_CONFIGS.length) check.tags = null
      if (skipShortTextSearch(check, DAV_TEXT_KEYS, EMPTY_FILTERS)) {
        setErr(SHORT_SEARCH_NOTE)
        setLoading(false)
        return
      }
      setLoading(true)
      setErr('')
      try {
        if (localMode || supabaseConfigured) {
          const sequential = p === pageRef.current + 1
          const cursor = !localMode && sequential ? cursorRef.current : null
          const searchFn = localMode
            ? (page: number, sz: number, _cursor?: Record<string, string> | null) => api.davSearch({ filters: active, page, size: sz })
            : (page: number, sz: number, nextCursor?: Record<string, string> | null) => cloudDavSearch({ filters: active, page, size: sz, cursor: nextCursor })
          const res = await searchFn(p, size, cursor)
          if (stale()) return
          pageRef.current = p
          cursorRef.current = res.nextCursor || null
          let items = (res.items || []).map(enrichRowTag)
          items = sortByDateDesc(items, ['ngayCap', 'ngayGiaHan', 'ngayHetHan'])
          setData({ ...res, items })
          setPage(p)
          if (!localMode && res.total == null) {
            cloudCount('dav', active)
              .then((total) => {
                if (stale() || total == null) return
                setData((prev) => ({ ...prev, total }))
              })
              .catch(() => {})
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
    [localMode, mergedFilters],
  )

  // Draft filters are applied only on explicit search; suggestions remain debounced.
  useEffect(() => {
    search(0)
  }, [pageSize, search])

  // Track first table paint before loading metrics (avoids bandwidth contention)
  useEffect(() => {
    if (embedded) return
    if (loading) sawTableLoad.current = true
    else if (sawTableLoad.current) setTableReady(true)
  }, [embedded, loading])

  // Metrics: cloud = 1 aggregate API; local = full catalog pages (deferred after table)
  useEffect(() => {
    if (embedded || !tableReady) return undefined
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
    api.metrics('dav')
      .then((payload: { cards?: DavMetricCard[]; total?: number; sampleSize?: number } | null) => {
        if (cancelled) return
        if (!payload?.cards?.length) throw new Error('Chưa có chỉ số')
        setMetricsCards(payload.cards)
        setMetricsTotal(payload.total ?? payload.sampleSize ?? null)
        setMetricsSample(null)
        setMetricsError('')
      })
      .catch(() => {
        if (cancelled) return
        setMetricsCards([])
        setMetricsSample(null)
        setMetricsTotal(null)
        setMetricsError(METRICS_REFRESH_NOTE)
      })
      .finally(finish)
    return () => {
      cancelled = true
    }
  }, [localMode, embedded, tableReady, metricsRetry])

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
        if (localMode) {
          const res = await api.suggest('dav', 'q', q)
          const names = (res?.items || []) as string[]
          if (id === suggestSeq.current) {
            setSuggests(names.slice(0, 4).map((title: string, i: number) => ({
              id: `${title}-${i}`,
              title,
              subtitle: '',
              meta: '',
              row: null,
            })))
          }
          return
        }
        if (supabaseConfigured) {
          const names = await cloudSuggest('dav', 'q', q)
          if (id === suggestSeq.current) {
            setSuggests(names.slice(0, 4).map((title: string, i: number) => ({
              id: `${title}-${i}`,
              title,
              subtitle: '',
              meta: '',
              row: null,
            })))
          }
          return
        }
        if (id === suggestSeq.current) setSuggests([])
      } catch {
        if (id === suggestSeq.current) setSuggests([])
      } finally {
        if (id === suggestSeq.current) setSuggesting(false)
      }
    }, 300)
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
  ].filter((v) => (Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '')).length

  const fieldSuggest = useCallback(
    (fieldKey: string) => async (q: string) => {
      const needle = String(q || '').trim()
      if (needle.length < 2) return []
      try {
        if (localMode) {
          const res = await api.suggest('dav', fieldKey, needle)
          return ((res?.items || []) as string[]).filter(Boolean).slice(0, 8)
        }
        if (!supabaseConfigured) return []
        return cloudSuggest('dav', fieldKey, needle)
      } catch {
        return []
      }
    },
    [localMode],
  )

  const runSearch = useCallback(
    (override?: Partial<DavFilters>) => {
      setSuggestOpen(false)
      const tags = commitDraft()
      search(0, undefined, override || null, tags)
    },
    [search, commitDraft],
  )

  /** Publish the draft the filter form is showing, then search. */
  const applyFilters = useCallback((next: DavFilters) => {
    filtersRef.current = next
    setFilters(next)
    setSuggestOpen(false)
    const tags = commitDraft()
    search(0, undefined, null, tags)
  }, [search, commitDraft])

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
      : (p: number, size: number, cursor?: Record<string, string> | null) => cloudDavSearch({ filters: mergedFilters(), page: p, size, cursor })
    return fetchAllPages(searchFn, { onProgress: setExportPct })
  }, [localMode, mergedFilters, filters, selectedTags])

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
    applyFilters,
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
