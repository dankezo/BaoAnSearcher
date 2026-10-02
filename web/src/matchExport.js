import { buildSheetsXlsx, colLetter, downloadBlob, sheetCell, stamp } from './export.js'

const HEADERS = [
  'STT', 'Mã TBMT', 'Tên gói', 'Chủ đầu tư', 'Tỉnh',
  'Hoạt chất MT', 'Hàm lượng MT', 'Dạng bào chế MT', 'Đường dùng MT', 'ĐVT', 'Đơn giá',
  'Hoạt chất khớp', 'Tên biệt dược', 'Hàm lượng', 'Dạng bào chế', 'Mật độ SĐK',
  'Đóng thầu',
]

const BAOAN = new Set([11, 12, 13, 14, 15])
const TENDER = 1
const CLOSE = 16

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><u/><sz val="11"/><color rgb="FF1D4E89"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="6">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF2"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE7F3FB"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF8E6D0"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFE3F6EA"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '</cellXfs>' +
  '</styleSheet>'

export function formatClose(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!match) return value ? String(value) : ''
  return match[4] ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : `${match[3]}/${match[2]}/${match[1]}`
}

/** soon = đóng thầu trong 3 ngày (cam). week = trong 7 ngày (xanh). */
export function closeTone(value, now = Date.now()) {
  const stamp = Date.parse(String(value || '').slice(0, 19))
  if (!Number.isFinite(stamp)) return ''
  const days = (stamp - now) / 86400000
  if (days < 0) return ''
  if (days <= 3) return 'soon'
  if (days <= 7) return 'week'
  return ''
}

function xmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function httpUrl(value) {
  const text = String(value || '').trim()
  if (!/^https?:\/\//i.test(text)) return ''
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.href
  } catch {
    return ''
  }
}

function valuesOf(row, stt) {
  return [
    stt, row.tenderNo || '', row.name, row.buyer, row.province,
    row.innMt, row.strengthMt, row.formMt, row.routeMt, row.unit, row.price,
    row.inn, row.brand, row.strength, row.form, row.sdkDensity,
    formatClose(row.closeDate),
  ]
}

export function matchSheet(rows, now = Date.now()) {
  const links = []
  for (let index = 0; index < rows.length; index += 1) {
    const url = httpUrl(rows[index].link)
    if (url) links.push({ ref: `${colLetter(TENDER)}${index + 2}`, url })
  }
  const xml = sheetXml(rows, now, links)
  const rels = links.length
    ? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      links.map((link, index) => (
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlAttr(link.url)}" TargetMode="External"/>`
      )).join('') +
      '</Relationships>'
    : ''
  return { xml, rels }
}

export function matchSheetXml(rows, now = Date.now()) {
  return matchSheet(rows, now).xml
}

function sheetXml(rows, now, links) {
  const widths = [6, 18, 36, 28, 16, 24, 16, 18, 16, 10, 14, 24, 22, 16, 18, 14, 18]
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const header = HEADERS.map((label, index) => sheetCell(`${colLetter(index)}1`, label, BAOAN.has(index) ? 2 : 1)).join('')
  const body = rows.map((row, index) => {
    const tone = closeTone(row.closeDate, now)
    const cells = valuesOf(row, index + 1).map((value, col) => {
      let style = 0
      if (BAOAN.has(col)) style = 3
      else if (col === CLOSE && tone === 'soon') style = 4
      else if (col === CLOSE && tone === 'week') style = 5
      else if (col === TENDER && httpUrl(row.link)) style = 6
      return sheetCell(`${colLetter(col)}${index + 2}`, value, style)
    }).join('')
    return `<row r="${index + 2}">${cells}</row>`
  }).join('')
  const last = `${colLetter(HEADERS.length - 1)}${Math.max(1, rows.length + 1)}`
  const hyperlinks = links.length
    ? `<hyperlinks>${links.map((link, index) => `<hyperlink ref="${link.ref}" r:id="rId${index + 1}"/>`).join('')}</hyperlinks>`
    : ''
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    hyperlinks +
    '</worksheet>'
}

function sheetPart(rows, name, now) {
  const sheet = matchSheet(rows, now)
  return { name, xml: sheet.xml, rels: sheet.rels }
}

export function buildMatchBlob(rows, now = Date.now(), { split = false } = {}) {
  if (!split) return buildSheetsXlsx([sheetPart(rows, 'Khớp thuốc', now)], STYLES)
  const exact = rows.filter((row) => row.match === 'exact')
  const near = rows.filter((row) => row.match === 'near')
  return buildSheetsXlsx([
    sheetPart(exact, 'Khớp', now),
    sheetPart(near, 'Gần khớp', now),
  ], STYLES)
}

export function exportMatchWorkbook(rows, filename = 'Khop_thuoc', { split = false } = {}) {
  downloadBlob(buildMatchBlob(rows, Date.now(), { split }), `${filename}_${stamp()}.xlsx`)
}
