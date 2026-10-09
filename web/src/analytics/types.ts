export type Mode = 'drug' | 'company' | 'territory' | 'macro'
export type Source = 'msc_prices' | 'msc_tenders' | 'vss' | 'dav'
export type Role = 'winner' | 'manufacturer' | 'registrant' | 'all'
export interface AnalyticsQuery {
  version?: number; mode: Mode; entity: string; role: Role; months: number | 'all'
  start?: string; end?: string; comparison: 'yoy' | 'previous' | 'none'
  companyFocus?: 'manufacturer'|'business'; entityMatch?: 'contains'|'exact'
  filters: Partial<Record<'group'|'strength'|'form'|'route'|'province', string>>
  previousStart?: string; previousEnd?: string
  entityField?: 'ingredient'|'registration'|'name'
  territoryField?: 'province'|'facility'|'region'
}
export interface AggregateRow {
  kind: string; period: 'current'|'previous'; label: string | null
  count: number; amount: string | number | null; quantity: string | number | null
  min_price: string | number | null; max_price: string | number | null
  priced_amount?:string|number|null;priced_quantity?:string|number|null
  active: number | null; expiring: number | null; new_registrations: number | null; unknown_expiry: number | null
  total_registrations?:number|null; won_packages?:number|null
}
export interface SourceStats { status:'available'|'unavailable'|'unsupported'; reason?:string; rows:AggregateRow[]; comparisonMissing?:boolean;linkedTenderCoverage?:string;updatedAt?:string|null }
export interface AnalyticsOverview {
  version:number; query:AnalyticsQuery; generatedAt:string; cached:boolean; snapshot?:boolean
  coverage:'unknown'|'complete'|'partial'; sources:Record<Source,SourceStats>; missing:Record<string,string>
  baoanCoordinates?:{ingredient_key:string;strength_key:string;group_key:string}[]
  baseline?:StrategicInsight
}
export interface DrugAnalyticsData extends AnalyticsOverview { query: AnalyticsQuery & { mode:'drug' } }
export interface CompanyProfile extends AnalyticsOverview { query: AnalyticsQuery & { mode:'company' } }
export interface TerritoryStats extends AnalyticsOverview { query: AnalyticsQuery & { mode:'territory' } }
export interface EntitySuggestion { mode:Mode; role:Role; label:string;roles?:Role[];entityField?:AnalyticsQuery['entityField'];territoryField?:AnalyticsQuery['territoryField'] }
export interface DetailRow {
  id:string; name:string|null; ingredient:string|null; strength:string|null; form:string|null; route:string|null
  registration:string|null; manufacturer:string|null; registrant:string|null; company:string|null; province:string|null
  facility:string|null; group_key:string|null; unit:string|null; price:string|null; quantity:string|null; amount:string|null
  date:string|null; expiry:string|null; tender_no:string|null; source_url:string|null; status:string|null
  [key:string]:string|null
}
export interface DetailPage {source:Source;page:number;items:DetailRow[];hasMore:boolean;reason?:string;registrantUnavailable?:boolean}
export interface NewsContext {id:string;title:string;summary?:string;source_url:string;published_at?:string;issued_at?:string;legal_status?:string;category?:string}
export interface InsightItem {detail:string;source:Source|'regulatory';documentId?:string}
export interface StrategicInsight {method:'ai'|'rules';provider?:string;model?:string;reason?:string;generatedAt:string;evidence:InsightItem[];inference:InsightItem[];verification:InsightItem[];actions:InsightItem[];news?:NewsContext[];newsStatus?:'available'|'unavailable';newsSummary?:{documentId:string;impact:string;action:string}|null}
export interface Preset {id:string;name:string;configuration:AnalyticsQuery;version:number}
export const SOURCE_LABELS:Record<Source,string>={msc_prices:'MSC · Đơn giá',msc_tenders:'MSC · Gói thầu',vss:'VSS · Trúng thầu',dav:'DAV · Số đăng ký'}
export const DEFAULT_QUERY:AnalyticsQuery={mode:'macro',entity:'',role:'winner',months:12,comparison:'yoy',filters:{}}
