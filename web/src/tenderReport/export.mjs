import { buildSingleSheetXlsx, sheetCell, colLetter, downloadBlob, xmlEsc } from '../export.js'
import { reportColumns, rowValues, blockColors } from './model.mjs'
const day=value=>value.split('-').reverse().join('/')
const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

export function buildTenderReportXlsx(blocks,isStackMode=false,includeDetails=false){
  const source=blocks[0]?.query.source==='msc'?'MSC':'BHYT'
  const rows=[],merges=[];let rn=0,stt=0
  const widths=[6,23,32,16,20,30,14,24,9,9,30,18,18,16,22]
  const units=[...new Set(blocks.flatMap(block=>block.rows.map(row=>row.unit)).filter(Boolean))]
  const add=(values,style,child=false,merged=false)=>{rn++;const lines=Math.max(1,...values.map((value,i)=>Math.ceil(String(value??'').length/((merged?widths.reduce((a,b)=>a+b,0):widths[i])-2))));rows.push(`<row r="${rn}" ht="${Math.max(24,lines*13+8)}" customHeight="1"${child?' outlineLevel="1"':''}>${values.map((value,i)=>sheetCell(`${colLetter(i)}${rn}`,value,typeof style==='function'?style(i):style)).join('')}</row>`)}
  const band=(text,style)=>{add([text],style,false,true);merges.push(`A${rn}:O${rn}`)}
  band('SỐ LIỆU THỐNG KÊ',1)
  const ranges=[...new Set(blocks.map(block=>`${day(block.query.start)} đến ${day(block.query.end)}`))]
  band(ranges.length===1?`(${ranges[0]})`:'Các kỳ theo từng khối hoạt chất',2)
  add(reportColumns,3)
  for(const [index,block] of blocks.entries()){
    const palette=isStackMode?index%blockColors.length:0
    const style=(i,unit)=>i===4?19+palette:i===12&&unit?24+units.indexOf(unit)*5+palette:4+palette*3+(i>=12?2:[0,8,9].includes(i)?1:0)
    band(`${block.queryKeyword} · ${day(block.query.start)} đến ${day(block.query.end)} · ${block.query.composition==='single'?'Đơn chất':block.query.composition==='combination'?'Phối hợp':'Đơn chất và phối hợp'}${block.query.group?' · Nhóm '+block.query.group:''}${block.query.strength?' · '+block.query.strength:''}${block.query.form?' · '+block.query.form:''}`,4+palette*3)
    for(const row of block.rows){
      add(rowValues(row,row.singleProduct,++stt),i=>style(i,row.unit))
      if(includeDetails && row.productCount>1)for(const product of row.children)add(rowValues(row,product,'',true),i=>style(i,row.unit),true)
    }
  }
  const tableEnd=rn
  band(`Số lượng trúng thầu; thành tiền = tổng từng dòng thầu. Đơn giá = thấp nhất trong kỳ. Thời gian theo ${source==='MSC'?'ngày đăng KQLCNT':'ngày bắt đầu HĐ'}. Dòng thiếu ngày không thuộc kỳ.`,2)
  const xml=header+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:O${rn}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A3:O${tableEnd}"/><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`
  const xfs=[`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,`<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf>`,`<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" wrapText="1"/></xf>`,`<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`]
  for(let i=0;i<blockColors.length;i++)for(const align of ['left','center','right'])xfs.push(`<xf numFmtId="${align==='right'?3:0}" fontId="0" fillId="${3+i}" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`)
  for(let i=0;i<blockColors.length;i++)xfs.push(`<xf numFmtId="49" fontId="0" fillId="${3+i}" borderId="1" xfId="0" applyNumberFormat="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>`)
  for(let u=0;u<units.length;u++)for(let i=0;i<blockColors.length;i++)xfs.push(`<xf numFmtId="${164+u}" fontId="0" fillId="${3+i}" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf>`)
  const formats=units.map((unit,index)=>`<numFmt numFmtId="${164+index}" formatCode="${xmlEsc('#,##0 "'+unit+'"')}"/>`).join('')
  const styles=header+`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${units.length}">${formats}</numFmts><fonts count="4"><font><sz val="10"/><name val="Times New Roman"/></font><font><b/><sz val="14"/><name val="Times New Roman"/></font><font><i/><sz val="11"/><name val="Times New Roman"/></font><font><b/><sz val="10"/><name val="Times New Roman"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${['F2F2F2',...blockColors].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left','right','top','bottom'].map(side=>`<${side} style="thin"><color rgb="FF000000"/></${side}>`).join('')}<diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  return buildSingleSheetXlsx(`Thống kê ${source}`,xml,styles)
}
export function exportTenderReportToExcel(blocksData,isStackMode,includeDetails){downloadBlob(buildTenderReportXlsx(blocksData,isStackMode,includeDetails),`Thong_ke_thau_${blocksData[0]?.query.source==='msc'?'MSC':'BHYT'}.xlsx`)}
