import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateKpis, dm93Shield, formatVnd, recommendation, rivalUndercuts, statusColor } from '../src/portfolioRules.js'

const braforce = {
  brandName: 'BRAFORCE',
  inn: 'Memantin hydrochlorid',
  strength: '2 mg/1ml',
  dosageForm: 'Dung dịch uống',
  therapyClass: 'neuro',
  competitorCount: 1,
  dm93: false,
  cycleGreen: true,
  liveSdk: true,
  wonBid: false,
  monthsLeft: 56,
  expDate: '2031-06-16',
  category: 'Thần kinh & sa sút trí tuệ',
  manufacturer: 'Công ty CP Dược phẩm Hà Tây',
}

const rozymaxta = {
  brandName: 'Rozymaxta',
  inn: 'Ezetimib; Rosuvastatin',
  strength: '10mg; 5mg',
  therapyClass: 'cardio',
  beCandidate: true,
  competitorCount: 4,
  dm93: false,
  cycleGreen: true,
  liveSdk: true,
  wonBid: false,
  monthsLeft: 40,
  expDate: '2030-12-03',
  category: 'Tim mạch',
  manufacturer: 'Phương Đông',
}

const vitamins = {
  brandName: '3Bvit Ansba',
  inn: 'Vitamin B1; Vitamin B6; Vitamin B12',
  strength: '100mg; 50mg; 1mg',
  therapyClass: 'vitamin',
  competitorCount: 3,
  dm93: true,
  cycleGreen: true,
  liveSdk: true,
  wonBid: true,
  monthsLeft: 42,
  expDate: '2030-03-14',
  category: 'Vitamin',
  manufacturer: 'Phương Đông',
}

const gluratintab = {
  brandName: 'Gluratintab',
  inn: 'Glucosamin sulfat; Natri chondroitin sulfat',
  strength: '500mg; 400mg',
  therapyClass: 'msk',
  competitorCount: 9,
  dm93: 'match',
  cycleGreen: true,
  liveSdk: true,
  wonBid: false,
  monthsLeft: 46,
  expDate: '2030-08-15',
  category: 'Cơ xương khớp',
  manufacturer: 'Abipha',
}

const sakiesmin = {
  brandName: 'Sakiesmin',
  inn: 'Diosmin',
  strength: '1000mg',
  therapyClass: 'vascular',
  competitorCount: 2,
  dm93: false,
  cycleGreen: true,
  liveSdk: true,
  wonBid: true,
  monthsLeft: 50,
  expDate: '2030-12-03',
  category: 'Mạch máu & trĩ, suy giãn tĩnh mạch',
  manufacturer: 'Phương Đông',
}

test('status color follows competitor density', () => {
  assert.equal(statusColor(1), 'GREEN')
  assert.equal(statusColor(2), 'GREEN')
  assert.equal(statusColor(4), 'YELLOW')
  assert.equal(statusColor(5), 'RED')
})

test('BRAFORCE low density is a golden niche and not DM93', () => {
  assert.equal(recommendation(braforce), 'Toa do Vang')
  assert.equal(statusColor(braforce.competitorCount), 'GREEN')
  assert.equal(dm93Shield(braforce), false)
})

test('Rozymaxta yellow cardio density proposes a Group 3 BE dossier', () => {
  assert.equal(statusColor(rozymaxta.competitorCount), 'YELLOW')
  assert.equal(recommendation(rozymaxta), 'Lap de an BE len Nhom 3')
})

test('3Bvit Ansba keeps the DM93 shield, including when density is red', () => {
  assert.equal(dm93Shield(vitamins), true)
  assert.equal(recommendation(vitamins), 'Huong bao ho DM93 (Dieu 56)')
  const crowded = { ...vitamins, competitorCount: 8, statusColor: 'RED' }
  assert.equal(recommendation(crowded), 'Kiem soat gia, ne thau mo')
  assert.equal(dm93Shield(crowded), true)
})

test('Gluratintab DM93 plus red density is price control and still shielded', () => {
  assert.equal(statusColor(gluratintab.competitorCount), 'RED')
  assert.equal(recommendation(gluratintab), 'Kiem soat gia, ne thau mo')
  assert.equal(dm93Shield(gluratintab), true)
})

test('Diosmin 1000mg niche uses the provincial pooled-tender label', () => {
  assert.equal(recommendation(sakiesmin), 'Thau So gom, uu the lieu')
  assert.equal(recommendation({ ...sakiesmin, competitorCount: 6 }), 'Theo doi thi truong')
})

test('KPI aggregation is computed from the rows', () => {
  const kpis = aggregateKpis([braforce, rozymaxta, vitamins, gluratintab, sakiesmin])
  assert.equal(kpis.scale.sku, 5)
  assert.equal(kpis.scale.categories, 5)
  assert.equal(kpis.scale.liveSdkPct, 1)
  assert.equal(kpis.golden.count, 2)
  assert.equal(kpis.bids.won, 2)
  assert.equal(kpis.bids.waiting, 3)
  assert.equal(kpis.cycle.ready36, 5)
  assert.equal(kpis.cycle.expiryFrom, 2030)
  assert.equal(kpis.cycle.expiryTo, 2031)
  assert.equal(kpis.cmo.top, 'Phương Đông')
  assert.equal(kpis.cmo.topCount, 3)
})

test('A lower rival price marks the Bảo An row for attention', () => {
  assert.equal(rivalUndercuts({ competitors: [{ priceDeltaPct: -12 }] }), true)
  assert.equal(rivalUndercuts({ competitors: [{ priceDeltaPct: 4 }] }), false)
  assert.equal(rivalUndercuts({ competitors: [] }), false)
})

test('VND formatter uses tỷ and an optional per-year suffix', () => {
  assert.match(formatVnd(1_200_000_000), /tỷ/)
  assert.match(formatVnd(2_500_000_000, { perYear: true }), /tỷ\/năm/)
  assert.equal(formatVnd(null), '—')
})
