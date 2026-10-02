import assert from 'node:assert/strict'
import test from 'node:test'
import { VN_PROVINCES } from '../src/vnProvinces.js'
import {
  REGION_BY_CODE,
  REGION_ORDER,
  dotOffset,
  groupPercents,
  haloRadius,
  markerRadiusPx,
  packageTone,
  projectPoint,
  regionOf,
  spreadLatLon,
  topByValue,
  yoyPercent,
  NORTH_REGIONS,
  featuresForView,
  leafletBoundsFor,
  rankByValue,
  showProvinceLabels,
  focusAfterListClick,
  focusAfterProvinceClick,
  focusAfterClear,
  cameraForIntent,
} from '../src/mapGeo.js'

function kmBetween(a, b) {
  const dLat = (b[1] - a[1]) * 111.32
  const midLat = ((a[1] + b[1]) / 2) * Math.PI / 180
  const dLon = (b[0] - a[0]) * 111.32 * Math.cos(midLat)
  return Math.hypot(dLat, dLon)
}

test('every pre-2025 province sits in one of eight regions', () => {
  const seen = new Set()
  for (const code of Object.keys(VN_PROVINCES)) {
    const region = regionOf(code)
    assert.ok(REGION_ORDER.includes(region), `${code} ${VN_PROVINCES[code]}`)
    seen.add(code)
  }
  assert.equal(seen.size, Object.keys(REGION_BY_CODE).length)
  assert.equal(regionOf('15'), 'Đông Bắc')
  assert.equal(regionOf('06'), 'Đông Bắc')
  assert.equal(regionOf('33'), 'Đồng bằng sông Hồng')
  assert.equal(regionOf('75'), 'Đông Nam Bộ')
})

test('package tone and price-strip math', () => {
  assert.equal(packageTone('open'), 'blue')
  assert.equal(packageTone('review'), 'orange')
  assert.equal(packageTone('closed'), 'orange')
  assert.equal(packageTone('cancelled'), '')
  assert.equal(yoyPercent(120, 100), 20)
  assert.equal(yoyPercent(64.2, 100), -35.8)
  assert.equal(yoyPercent(10, 0), null)
  const shares = groupPercents([50, 25, 25, 0, 0])
  assert.equal(shares[0], 50)
  assert.equal(shares[1], 25)
  assert.equal(shares[3], 0)
  const top = topByValue([
    { name: 'Hà Nội', value: 10 },
    { name: 'Đà Nẵng', value: 40 },
    { name: 'Huế', value: 30 },
    { name: 'Cần Thơ', value: 5 },
  ])
  assert.deepEqual(top.map((row) => row.name), ['Đà Nẵng', 'Huế', 'Hà Nội'])
})

test('dot offset stays near the province centroid and does not stack identical keys', () => {
  const [x, y] = dotOffset('79:buyer-a')
  const [x2, y2] = dotOffset('79:buyer-b')
  assert.equal(dotOffset('79:buyer-a')[0], x)
  assert.ok(Math.hypot(x, y) >= 6 && Math.hypot(x, y) <= 15)
  assert.notEqual(`${x},${y}`, `${x2},${y2}`)
  assert.equal(haloRadius(100, 100), 33)
  const [px, py] = projectPoint(102, 23, { minLon: 102, minLat: 8, maxLon: 110, maxLat: 23 }, 100, 200, 10)
  assert.equal(px, 10)
  assert.equal(py, 10)
})

test('spreadLatLon keeps index 0 on the centroid and later points inside 40km', () => {
  const centroid = [105.8542, 21.0285]
  assert.deepEqual(spreadLatLon(centroid[0], centroid[1], 0), centroid)
  const later = [1, 2, 8, 40].map((index) => spreadLatLon(centroid[0], centroid[1], index))
  for (const point of later) {
    assert.notDeepEqual(point, centroid)
    const km = kmBetween(centroid, point)
    assert.ok(km > 0.4, `expected a visible offset, got ${km}`)
    assert.ok(km < 40, `expected to stay within 40km, got ${km}`)
  }
  assert.equal(new Set(later.map((point) => point.join(','))).size, later.length)
})

test('northern bounds and value rank', () => {
  assert.deepEqual(NORTH_REGIONS, ['Tây Bắc', 'Đông Bắc', 'Đồng bằng sông Hồng'])
  const features = [
    {
      properties: { ma: '01' },
      geometry: { type: 'Polygon', coordinates: [[[105.8, 21.0], [105.9, 21.0], [105.9, 21.2], [105.8, 21.0]]] },
    },
    {
      properties: { ma: '79' },
      geometry: { type: 'Polygon', coordinates: [[[106.6, 10.7], [106.8, 10.7], [106.8, 10.9], [106.6, 10.7]]] },
    },
  ]
  assert.deepEqual(featuresForView(features, { north: true }).map((row) => row.properties.ma), ['01'])
  assert.deepEqual(featuresForView(features, {}).map((row) => row.properties.ma), ['01'])
  const north = leafletBoundsFor(features, { north: true })
  assert.ok(north[0][0] > 20 && north[1][0] < 22)
  const city = leafletBoundsFor(features, { province: '79' })
  assert.ok(city[0][0] < 11 && city[1][0] < 12)
  const region = featuresForView(features, { region: 'Đông Nam Bộ' })
  assert.deepEqual(region.map((row) => row.properties.ma), ['79'])
  const ranked = rankByValue([
    { name: 'A', value: 2 },
    { name: 'B', value: 20 },
    { name: 'C', value: 5 },
  ])
  assert.deepEqual(ranked.map((row) => row.name), ['B', 'C', 'A'])
  assert.equal(showProvinceLabels(5), false)
  assert.equal(showProvinceLabels(6), true)
})

test('list click keeps the province and does not ask for a new camera', () => {
  const place = { type: 'province', id: '01' }
  const next = focusAfterListClick(place)
  assert.equal(next.camera, null)
  assert.deepEqual(next.place, place)
  assert.notEqual(next.place, place)
  const region = focusAfterListClick({ type: 'region', id: 'Đồng bằng sông Hồng' })
  assert.equal(region.camera, null)
  assert.equal(region.place.id, 'Đồng bằng sông Hồng')
  const moved = focusAfterProvinceClick('1')
  assert.deepEqual(moved.camera, { province: '01', region: '' })
  assert.equal(moved.place.type, 'province')
  assert.deepEqual(focusAfterClear().camera, { north: true })
  assert.equal(focusAfterClear().place, null)
})

test('province focus flies gently and stays near zoom 8', () => {
  const province = cameraForIntent({ province: '37', region: '' })
  assert.equal(province.maxZoom, 8)
  assert.ok(province.duration >= 0.7 && province.duration <= 0.9)
  assert.ok(province.easeLinearity >= 0.35 && province.easeLinearity <= 0.8)
  assert.ok(province.padding[0] >= 40)
  const region = cameraForIntent({ province: '', region: 'Đồng bằng sông Hồng' })
  assert.equal(region.maxZoom, 8)
  assert.ok(region.duration >= 0.7 && region.duration <= 0.9)
  const north = cameraForIntent({ north: true })
  assert.ok(north.duration < province.duration)
  assert.ok(north.duration > 0)
  assert.equal(focusAfterListClick({ type: 'province', id: '37' }).camera, null)
})

test('markerRadiusPx makes the largest package clearly bigger', () => {
  const small = markerRadiusPx(1, 100)
  const big = markerRadiusPx(100, 100)
  assert.ok(big > small * 2, `${big} should dwarf ${small}`)
  assert.ok(big >= 30)
  assert.ok(small < 12)
})
