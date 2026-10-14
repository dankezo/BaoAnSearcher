import type { ReactNode, ReactElement } from 'react'
import type { DavColumn, DrugItem, ColumnFilters, DavSuggestion, DavSearchResult } from './types/dav'
export const Icons: Record<
  'search' | 'x' | 'filter' | 'download' | 'external' | 'chevL' | 'chevR' | 'clock' | 'columns' | 'refresh',
  ReactElement
>
export function SuggestField(props: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  onSearch: (value: string) => void
  suggest: (q: string) => Promise<string[]>
  placeholder?: string
  className?: string
}): ReactElement
export function MultiSelectField(props: {
  label: string
  hint?: string
  value: string[]
  onChange: (value: string[]) => void
  suggest?: (q: string) => Promise<string[]>
  options?: Array<string | { value: string; label: string }>
  placeholder?: string
}): ReactElement
export function CountSelect(props: {
  label: string
  value: string
  otherValue: string
  options: Array<number | string>
  onChange: (value: string) => void
  onOther: (value: string) => void
}): ReactElement
export function SearchSuggestBar(props: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  suggestions: DavSuggestion[]
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  hint: string
  onPick: (item: DavSuggestion) => void
}): ReactElement
export function FilterModal(props: {
  open: boolean
  onClose: () => void
  onApply: () => void
  children: ReactNode
}): ReactElement | null
export function TableToolbar(props: {
  kicker: string
  title: string
  selectedCount: number
  onClearSelection: () => void
  onExport: () => void
  exporting: boolean
  filtersVisible: boolean
  onToggleFilters: () => void
  activeColumnFilters: number
  onClearColumnFilters: () => void
  children: ReactNode
}): ReactElement
export function ErrorNote(props: { children: ReactNode }): ReactElement | null
export function DataTable<Row extends object>(props: {
  columns: { [Key in keyof Row]-?: {
    key: Key; label: string; render?: (value: Row[Key], row: Row) => ReactNode
    text?: (row: Row) => unknown; align?: string; width?: number; mono?: boolean
    nowrap?: boolean; filter?: 'select' | 'text' | false; truncateAt?: number
  } }[keyof Row][]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  startIndex?: number
  showIndex?: boolean
  selectable?: boolean
  selected?: Map<string, Row> | Set<string>
  onToggleRow?: (key: string, row: Row) => void
  onToggleAll?: (pairs: [string, Row][], checked: boolean) => void
  columnFilters?: ColumnFilters
  onColumnFilter?: (key: string, value: string) => void
  filtersVisible?: boolean
  onFilterEnter?: (key?: string, value?: string) => void
  onFilterSuggest?: (key: string, q: string) => Promise<string[]>
  onRowDoubleClick?: (row: Row) => void
  rowDoubleClickCapture?: boolean
  loading?: boolean
  emptyText?: string
  emptyAction?: ReactNode
  cardKeys?: (keyof Row)[]
  minWidth?: number
  rowClassName?: (row: Row) => string
  trailing?: { label: string; render: (row: Row) => ReactNode }
}): ReactElement
export function Pagination(props: {
  page: number
  size: number
  total?: number | null
  hasMore?: boolean
  shown: number
  onPage: (page: number) => void
  pageSize: number
  onPageSize: (size: number) => void
  extra: ReactNode
}): ReactElement
export function DetailModal(props: {
  row: DrugItem | null
  fields: DavColumn[]
  title: string
  subtitle: string
  sourceUrl: string
  onClose: () => void
  renderValue: (field: DavColumn, row: DrugItem, value: ReactNode) => ReactNode
}): ReactElement | null
export function LoadingOverlay(props: {
  show: boolean
  percent: number
  message: string
  etaSec?: number | null
  onCancel: () => void
}): ReactElement | null
export function UpdatedNote(props: {
  updated: string | null
  count: number | null
  source?: string
}): ReactElement | null
export { IngredientText } from './tt20'
export function useSectionMeta(
  section: string,
  localMode: boolean,
  fallback: null,
  refreshKey: number,
): { updated: string | null; count: number | null }
export function useLoadProgress(
  loading: boolean,
  message: string,
  progress: number | null,
): { percent: number; message: string; etaSec: number | null }
export function useSelection<T>(): {
  selected: Map<string, T>
  toggle: (key: string, row: T) => void
  setMany: (pairs: [string, T][], checked: boolean) => void
  clear: () => void
  size: number
}
export function resolvePageSize(choice: number | string): number
export function serverFilters(
  filters: ColumnFilters,
  map: Partial<Record<keyof DrugItem, string>>,
): Partial<Record<string, string>>
export function applyColumnFilters(rows: DrugItem[], columns: DavColumn[], filters: ColumnFilters): DrugItem[]
export function fetchAllPages(
  fetchPage: (page: number, size: number, cursor?: Record<string, string> | null) => Promise<DavSearchResult>,
  options?: { size?: number; cap?: number; onProgress?: (pct: number) => void; shouldCancel?: () => boolean; strict?: boolean },
): Promise<DrugItem[]>
export function exportSelectionOrAll(options: {
  columns: DavColumn[]
  selected: Map<string, DrugItem>
  fetchAll: () => Promise<DrugItem[]>
  filename: string
  sheetName: string
  columnFilters: ColumnFilters
}): Promise<number>
export const DAV_METRICS_CAP: number
