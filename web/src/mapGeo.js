/** Province regions, heat colors, and map placement helpers. */

export const REGION_ORDER = [
  'Tây Bắc',
  'Đông Bắc',
  'Đồng bằng sông Hồng',
  'Bắc Trung Bộ',
  'Nam Trung Bộ',
  'Tây Nguyên',
  'Đông Nam Bộ',
  'Đồng bằng sông Cửu Long',
]

const REGION_CODES = {
  'Tây Bắc': ['11', '12', '14', '17'],
  'Đông Bắc': ['02', '04', '06', '08', '10', '15', '19', '20', '22', '24', '25'],
  'Đồng bằng sông Hồng': ['01', '26', '27', '30', '31', '33', '34', '35', '36', '37'],
  'Bắc Trung Bộ': ['38', '40', '42', '44', '45', '46'],
  'Nam Trung Bộ': ['48', '49', '51', '52', '54', '56', '58', '60'],
  'Tây Nguyên': ['62', '64', '66', '67', '68'],
  'Đông Nam Bộ': ['70', '72', '74', '75', '77', '79'],
  'Đồng bằng sông Cửu Long': ['80', '82', '83', '84', '86', '87', '89', '91', '92', '93', '94', '95', '96'],
}

export const REGION_BY_CODE = Object.fromEntries(
  Object.entries(REGION_CODES).flatMap(([region, codes]) => codes.map((code) => [code, region])),
)

export const GROUP_COLORS = ['#0f5c6b', '#1b7a48', '#b45309', '#1d4ed8', '#64748b']

export function padProvinceCode(code) {
  const key = String(code || '').trim()
  if (!key) return ''
  return /^\d+$/.test(key) ? key.padStart(2, '0') : key
}

export function regionOf(code) {
  return REGION_BY_CODE[padProvinceCode(code)] || ''
}

export function yoyPercent(current, previous) {
  const cur = Number(current) || 0
  const prev = Number(previous) || 0
  if (prev > 0) return ((cur - prev) / prev) * 100
  if (cur > 0) return null
  return 0
}

export function groupPercents(groups = []) {
  const vals = [0, 1, 2, 3, 4].map((i) => Number(groups[i]) || 0)
  const total = vals.reduce((sum, n) => sum + n, 0)
  if (!total) return [0, 0, 0, 0, 0]
  return vals.map((n) => (n / total) * 100)
}

export function topByValue(rows = [], limit = 3) {
  return [...rows].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)).slice(0, limit)
}

export function packageTone(status) {
  if (status === 'open') return 'blue'
  if (status === 'review' || status === 'closed') return 'orange'
  return ''
}

export function heatFill(yoy, value) {
  const amount = Number(value) || 0
  if (amount <= 0) return 'rgb(203, 213, 225)'
  if (yoy == null || Number.isNaN(Number(yoy)) || Number(yoy) === 0) return 'rgb(148, 163, 184)'
  const mag = Math.min(1, Math.abs(Number(yoy)) / 40)
  if (Number(yoy) > 0) return `rgba(22, 163, 74, ${0.22 + mag * 0.58})`
  return `rgba(220, 38, 38, ${0.22 + mag * 0.58})`
}

const HEAT_LIGHT = {
  open: [187, 247, 208],
  closed: [186, 230, 253],
  other: [254, 215, 170],
}
const HEAT_DARK = {
  open: [20, 83, 45],
  closed: [7, 89, 133],
  other: [154, 52, 18],
}

export function heatSwatch(tone = 'other', t = 1) {
  const light = HEAT_LIGHT[tone] || HEAT_LIGHT.other
  const dark = HEAT_DARK[tone] || HEAT_DARK.other
  const mix = Math.max(0, Math.min(1, t))
  const rgb = light.map((channel, index) => Math.round(channel + (dark[index] - channel) * mix))
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

/** Rank-based heat so neighboring values stay visibly different. */
export function heatFillValue(value, tone, sortedPositive = []) {
  const amount = Number(value) || 0
  if (amount <= 0 || !sortedPositive.length) return 'rgb(203, 213, 225)'
  let index = 0
  while (index < sortedPositive.length && sortedPositive[index] < amount) index += 1
  const rank = sortedPositive.length === 1 ? 1 : index / (sortedPositive.length - 1)
  return heatSwatch(tone, 0.08 + rank * 0.92)
}

export function heatColor(yoy) {
  if (yoy == null || Number.isNaN(Number(yoy))) return '#3b4550'
  if (Number(yoy) >= 0) return '#166534'
  return '#b91c1c'
}

export function dotOffset(key) {
  const text = String(key || 'x')
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const angle = ((hash >>> 0) % 360) * Math.PI / 180
  const radius = 6 + ((hash >>> 8) % 9)
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

export function haloRadius(value, maxValue) {
  const amount = Math.max(0, Number(value) || 0)
  const max = Math.max(0, Number(maxValue) || 0)
  const scale = max > 0 ? Math.sqrt(amount / max) : 0
  return 7 + scale * 26
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const KM_PER_DEG = 111.32

/** Golden-angle spiral in kilometers. Index 0 stays on the province centroid. */
export function spreadLatLon(lon, lat, index) {
  const baseLon = Number(lon)
  const baseLat = Number(lat)
  const step = Math.max(0, Math.floor(Number(index) || 0))
  if (!Number.isFinite(baseLon) || !Number.isFinite(baseLat)) return [0, 0]
  if (step <= 0) return [baseLon, baseLat]
  const angle = step * GOLDEN_ANGLE
  const radiusKm = Math.min(38, 4.2 * Math.sqrt(step))
  const latRad = (baseLat * Math.PI) / 180
  const dLat = (radiusKm * Math.sin(angle)) / KM_PER_DEG
  const dLon = (radiusKm * Math.cos(angle)) / (KM_PER_DEG * Math.max(0.2, Math.cos(latRad)))
  return [baseLon + dLon, baseLat + dLat]
}

/** Pixel radius for a value bubble: about 8px up to about 34px. */
export function markerRadiusPx(value, maxValue) {
  const amount = Math.max(0, Number(value) || 0)
  const max = Math.max(0, Number(maxValue) || 0)
  const scale = max > 0 ? Math.sqrt(amount / max) : 0
  return 8 + scale * 26
}

export function bubbleFill(kind, status) {
  if (kind === 'facility') return '#0f5c6b'
  if (status === 'open') return '#16a34a'
  return '#15803d'
}

export function geometryBounds(features = []) {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  const visit = (pair) => {
    const lon = Number(pair?.[0])
    const lat = Number(pair?.[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  for (const feature of features) {
    const geom = feature?.geometry
    const polys = geom?.type === 'Polygon' ? [geom.coordinates] : (geom?.coordinates || [])
    for (const poly of polys) {
      for (const ring of poly || []) {
        for (const pair of ring || []) visit(pair)
      }
    }
  }
  if (!Number.isFinite(minLon)) return null
  return { minLon, minLat, maxLon, maxLat }
}

export function projectPoint(lon, lat, bounds, width, height, pad = 16) {
  const x = pad + ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * (width - pad * 2)
  const y = pad + ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * (height - pad * 2)
  return [x, y]
}

export function ringCentroid(ring = []) {
  const closed = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1]
  const use = closed ? ring.slice(0, -1) : ring
  if (!use.length) return null
  let lon = 0
  let lat = 0
  for (const pair of use) {
    lon += Number(pair[0]) || 0
    lat += Number(pair[1]) || 0
  }
  return [lon / use.length, lat / use.length]
}

export function featureCentroid(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : (geometry?.coordinates || [])
  let best = null
  for (const poly of polys) {
    const ring = poly?.[0]
    if (!ring || ring.length < (best?.length || 0)) continue
    best = ring
  }
  return best ? ringCentroid(best) : null
}

/** Tây Bắc, Đông Bắc, Đồng bằng sông Hồng — the default map frame. */
export const NORTH_REGIONS = REGION_ORDER.slice(0, 3)

export const PROVINCE_LABEL_MIN_ZOOM = 6

export function showProvinceLabels(zoom) {
  return Number(zoom) >= PROVINCE_LABEL_MIN_ZOOM
}

export function rankByValue(rows = []) {
  return [...rows].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
}

/** Left-list click keeps the province or region already on screen. */
export function focusAfterListClick(place) {
  const type = place?.type
  const id = String(place?.id || '').trim()
  if ((type !== 'province' && type !== 'region') || !id) return { place: null, camera: null }
  return { place: { type, id }, camera: null }
}

/** Province polygon click may move the camera onto that province. */
export function focusAfterProvinceClick(code) {
  const id = padProvinceCode(code)
  return { place: { type: 'province', id }, camera: { province: id, region: '' } }
}

/** Region label click may move the camera onto that region. */
export function focusAfterRegionClick(name) {
  const id = String(name || '').trim()
  return { place: { type: 'region', id }, camera: { province: '', region: id } }
}

/** Clear-filters returns the map to the northern default. */
export function focusAfterClear() {
  return { place: null, camera: { north: true } }
}

/** Gentle flyToBounds options. Province focus stays near zoom 8. */
export function cameraForIntent(intent = {}) {
  const province = Boolean(String(intent?.province || '').trim())
  const region = Boolean(String(intent?.region || '').trim())
  if (province) {
    return { padding: [48, 48], maxZoom: 8, duration: 0.85, easeLinearity: 0.5 }
  }
  if (region) {
    return { padding: [40, 40], maxZoom: 8, duration: 0.85, easeLinearity: 0.5 }
  }
  return { padding: [36, 36], maxZoom: 7, duration: 0.5, easeLinearity: 0.5 }
}

/** Province wins, then region, otherwise the three northern regions. */
export function featuresForView(features = [], intent = {}) {
  const province = padProvinceCode(intent?.province)
  const region = String(intent?.region || '').trim()
  const northern = !province && !region
  return (features || []).filter((feature) => {
    const code = padProvinceCode(feature?.properties?.ma)
    if (province) return code === province
    const area = regionOf(code)
    if (region) return area === region
    return northern && NORTH_REGIONS.includes(area)
  })
}

/** Leaflet fitBounds pair: [[south, west], [north, east]]. */
export function leafletBoundsFor(features = [], intent = {}) {
  const box = geometryBounds(featuresForView(features, intent))
  if (!box) return null
  return [[box.minLat, box.minLon], [box.maxLat, box.maxLon]]
}

/** Leaflet [lat, lon] at the mean of feature centroids. */
export function meanLatLon(features = []) {
  let lon = 0
  let lat = 0
  let count = 0
  for (const feature of features) {
    const point = featureCentroid(feature?.geometry)
    if (!point) continue
    lon += point[0]
    lat += point[1]
    count += 1
  }
  if (!count) return null
  return [lat / count, lon / count]
}
