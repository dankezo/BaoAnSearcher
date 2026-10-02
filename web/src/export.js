/**
 * Minimal dependency-free XLSX writer.
 * Produces an Office Open XML workbook using a STORED (uncompressed) zip.
 * Good enough for a few thousand rows × a few dozen columns.
 */

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ---------------- ZIP (stored) ---------------- */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

function zipStored(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  const { time, date } = dosDateTime()

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name)
    const body = typeof data === 'string' ? enc.encode(data) : data
    const crc = crc32(body)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // version needed
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, body.length, true)
    local.setUint32(22, body.length, true)
    local.setUint16(26, nameBytes.length, true)
    local.setUint16(28, 0, true)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true)
    cen.setUint16(12, time, true)
    cen.setUint16(14, date, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, body.length, true)
    cen.setUint32(24, body.length, true)
    cen.setUint16(28, nameBytes.length, true)
    cen.setUint16(30, 0, true)
    cen.setUint16(32, 0, true)
    cen.setUint16(34, 0, true)
    cen.setUint16(36, 0, true)
    cen.setUint32(38, 0, true)
    cen.setUint32(42, offset, true)

    parts.push(new Uint8Array(local.buffer), nameBytes, body)
    central.push(new Uint8Array(cen.buffer), nameBytes)
    offset += 30 + nameBytes.length + body.length
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true)

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/* ---------------- SpreadsheetML ---------------- */
function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // strip control chars that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export function colLetter(i) {
  let s = ''
  let n = i
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

function cellXml(ref, value, isHeader) {
  if (value == null || value === '') return ''
  const style = isHeader ? ' s="1"' : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`
  }
  const text = xmlEsc(typeof value === 'object' ? JSON.stringify(value) : value)
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''
  return `<c r="${ref}" t="inlineStr"${style}><is><t${preserve}>${text}</t></is></c>`
}

function sheetXml(headers, rows, widths) {
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, w))}" customWidth="1"/>`)
    .join('')
  const out = []
  out.push(`<row r="1">${headers.map((h, i) => cellXml(`${colLetter(i)}1`, h, true)).join('')}</row>`)
  rows.forEach((r, ri) => {
    const rn = ri + 2
    out.push(`<row r="${rn}">${r.map((v, ci) => cellXml(`${colLetter(ci)}${rn}`, v, false)).join('')}</row>`)
  })
  const lastRef = `${colLetter(Math.max(0, headers.length - 1))}${rows.length + 1}`
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastRef}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${out.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastRef}"/>` +
    `</worksheet>`
  )
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`

/**
 * Build an .xlsx Blob.
 * @param {Array<{key:string,label:string}>} columns
 * @param {Array<object>} rows
 * @param {(row:object, col:object)=>any} [getValue] optional accessor (default row[col.key])
 */
export function buildXlsx(columns, rows, getValue, sheetName = 'Data', extraSheets = []) {
  const headers = columns.map((c) => c.label || c.key)
  const matrix = rows.map((r) => columns.map((c) => (getValue ? getValue(r, c) : r[c.key])))
  const widths = headers.map((h, i) => {
    let w = String(h).length + 2
    for (let j = 0; j < Math.min(matrix.length, 200); j++) {
      const v = matrix[j][i]
      if (v != null) w = Math.max(w, Math.min(60, String(v).length + 2))
    }
    return w
  })
  const sheets = [{ name: sheetName, xml: sheetXml(headers, matrix, widths) }, ...extraSheets.map((sheet) => ({
    name: String(sheet.name),
    xml: heatmapSheetXml(sheet.rows, sheet.note),
  }))]
  return packageWorkbook(sheets, workbookStyles())
}

export function sheetCell(ref, value, styleId = 0) {
  const style = styleId ? ` s="${styleId}"` : ''
  if (value && typeof value === 'object' && value.formula) {
    return `<c r="${ref}" t="str"${style}><f>${xmlEsc(value.formula)}</f><v>${xmlEsc(value.text || '')}</v></c>`
  }
  if (value == null || value === '') return styleId ? `<c r="${ref}"${style}/>` : ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`
  }
  const text = xmlEsc(typeof value === 'object' ? JSON.stringify(value) : value)
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : ''
  return `<c r="${ref}" t="inlineStr"${style}><is><t${preserve}>${text}</t></is></c>`
}

export function buildSingleSheetXlsx(sheetName, sheetXmlText, stylesXml) {
  return packageWorkbook([{ name: sheetName, xml: sheetXmlText }], stylesXml)
}

export function buildSheetsXlsx(sheets, stylesXml) {
  return packageWorkbook(sheets, stylesXml)
}

function packageWorkbook(sheets, stylesXml) {
  const named = sheets.map((sheet) => ({
    name: xmlEsc(String(sheet.name).slice(0, 31).replace(/[\\/?*[\]:]/g, ' ')),
    xml: sheet.xml,
    rels: sheet.rels || '',
  }))
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${named.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: 'xl/styles.xml', data: stylesXml },
    ...named.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheet.xml })),
    ...named.flatMap((sheet, i) => (sheet.rels
      ? [{ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: sheet.rels }]
      : [])),
  ]
  return zipStored(files)
}

function workbookStyles() {
  const colors = ['FFD1FAE5', 'FFFEE2E2', 'FFE2E8F0']
  return STYLES_XML.replace('<fills count="3">', '<fills count="6">')
    .replace('</fills>', colors.map(rgb => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`).join('') + '</fills>')
    .replace('<cellXfs count="2">', '<cellXfs count="5">')
    .replace('</cellXfs>', colors.map((_, i) => `<xf numFmtId="0" fontId="1" fillId="${i + 3}" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`).join('') + '</cellXfs>')
}

function heatmapSheetXml(provinces = [], note = '') {
  const lines = new Map(), merges = []
  const add = (row, col, value, style = 0) => {
    const xml = cellXml(`${colLetter(col)}${row}`, value, false).replace('<c ', `<c s="${style}" `)
    lines.set(row, (lines.get(row) || '') + xml)
  }
  add(1, 0, 'HEATMAP VSS · GIÁ TRỊ TRÚNG THẦU THEO TỈNH', 1)
  merges.push('A1:O1')
  add(2, 0, note || '12 tháng gần nhất so với cùng kỳ năm trước · Nguồn: BHYT VSS')
  merges.push('A2:O2')
  add(3, 0, 'Xanh: tăng · Đỏ: giảm · Xám: chưa có cùng kỳ. Giá trị: VND. Heatmap gồm tất cả tỉnh theo bộ lọc; độc lập với các dòng được chọn ở sheet VSS.')
  merges.push('A3:O3')
  const money = n => Number(n || 0).toLocaleString('vi-VN') + ' đ'
  provinces.forEach((p, i) => {
    const row = 5 + Math.floor(i / 5) * 5, col = (i % 5) * 3
    const style = p.yoy == null ? 4 : p.yoy < 0 ? 3 : 2
    const values = [`${p.name || p.code} (${p.code || '—'})`, money(p.value), p.yoy == null ? 'Chưa có cùng kỳ' : `${p.yoy > 0 ? '+' : ''}${Number(p.yoy).toFixed(1)}%`, `Cùng kỳ: ${money(p.prev)}`]
    values.forEach((value, offset) => {
      add(row + offset, col, value, style)
      merges.push(`${colLetter(col)}${row + offset}:${colLetter(col + 2)}${row + offset}`)
    })
  })
  const start = 6 + Math.ceil(provinces.length / 5) * 5
  const headers = ['Mã tỉnh', 'Tỉnh / TP', 'Giá trị (VND)', 'Cùng kỳ (VND)', 'Tăng trưởng (%)', 'Tỷ trọng (%)', 'Số dòng', 'N1 (VND)', 'N2 (VND)', 'N3 (VND)', 'N4 (VND)', 'N5 (VND)']
  headers.forEach((v, c) => add(start, c, v, 1))
  provinces.forEach((p, i) => [p.code, p.name, p.value, p.prev, p.yoy ?? 'Chưa có cùng kỳ', p.share, p.count, ...(p.groups || [])].forEach((v, c) => add(start + i + 1, c, v)))
  const end = start + provinces.length
  const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([r, xml]) => `<row r="${r}" ht="${r === 3 ? 30 : r < start ? 25 : 20}" customHeight="1">${xml}</row>`).join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:O${end}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="15" width="14" customWidth="1"/></cols>' +
    `<sheetData>${rows}</sheetData><autoFilter ref="A${start}:L${end}"/><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` +
    '<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>'
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** Export rows to .xlsx and trigger download. */
export function exportXlsx({ columns, rows, getValue, filename = 'export', sheetName = 'Data', extraSheets = [] }) {
  const blob = buildXlsx(columns, rows, getValue, sheetName, extraSheets)
  downloadBlob(blob, `${filename}_${stamp()}.xlsx`)
}
