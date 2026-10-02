/**
 * Data policy for medicine-line eligibility. This is intentionally separate
 * from the matcher so legal/editorial changes can be reviewed as data.
 * Current basis: Appendix I, Circular 40/2025/TT-BYT (effective 25-10-2025).
 */
export const LEGAL_BASIS = 'Phụ lục I, Thông tư 40/2025/TT-BYT'

export const INGREDIENT_ALIASES = Object.freeze({
  fenofibrat: 'fenofibrate',
  fenofibrate: 'fenofibrate',
  atorvastatine: 'atorvastatin',
  ciprofloxacine: 'ciprofloxacin',
  hydroclorid: 'hydrochloride',
  hydrochlorid: 'hydrochloride',
  hcl: 'hydrochloride',
  sulphate: 'sulfate',
  sulfat: 'sulfate',
})

export const DOSAGE_FORM_RULES = Object.freeze({
  vien: ['vien', 'vien nen', 'vien nen bao phim', 'vien bao duong', 'vien nang'],
  'vien nen': ['vien nen'],
  'vien nen bao phim': ['vien nen bao phim'],
  'vien bao duong': ['vien bao duong'],
  'vien nang': ['vien nang'],
  'thuoc tiem': ['thuoc tiem', 'dung dich tiem', 'hon dich tiem', 'nhu tuong tiem', 'bot pha tiem'],
  'dung dich uong': ['dung dich uong', 'hon dich uong', 'bot pha uong', 'com pha uong'],
  'hon dich uong': ['dung dich uong', 'hon dich uong', 'bot pha uong', 'com pha uong'],
  'thuoc dung ngoai': ['thuoc dung ngoai', 'thuoc mo', 'kem boi da', 'gel boi da', 'nhu tuong boi'],
  'thuoc boi da': ['thuoc dung ngoai', 'thuoc mo', 'kem boi da', 'gel boi da', 'nhu tuong boi'],
})

// These need their own Appendix-I clause and are never silently folded into
// a generic tablet rule without reviewing the HSMT.
export const SPECIAL_RELEASE_FORMS = Object.freeze([
  'vien bao tan o ruot',
  'vien giai phong co kiem soat',
  'vien hoa tan nhanh',
  'vien sui',
])
