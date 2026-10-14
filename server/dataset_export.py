"""Local downloads: stream SQLite rows to a compressed workbook, then reuse it."""
from contextlib import closing
from datetime import date, datetime
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import threading

from . import dav, msc, vss
from .common import ROOT, DATA_DIR, fold, parse_date

COLUMNS_PATH = ROOT / 'web/src/dataExportColumns.json'
COLUMNS = json.loads(COLUMNS_PATH.read_text(encoding='utf-8'))
_lock = threading.Lock()


def export_day(value):
    if not value:
        return ''
    text = str(value)
    if date.fromisoformat(text).isoformat() != text:
        raise ValueError('Ngày tải dữ liệu không hợp lệ.')
    return text


def source_rows(code, filters):
    if code == 'VSS':
        clauses, args = vss.bid_where(filters)
        with closing(sqlite3.connect(f'file:{vss.VSS_DB}?mode=ro', uri=True)) as con:
            con.create_function('fold', 1, fold)
            where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
            for value, in con.execute('SELECT raw FROM bids' + where, args):
                row = json.loads(value)
                if not row.get('dangbaoche'):
                    from .sdk_forms import form_for
                    row['dangbaoche'] = form_for(row.get('sodk'))
                yield row
    elif code == 'DAV':
        # Reuse the DAV search's structured filtering and official flattening.
        yield from dav.search_drugs(filters, all_rows=True)['items']
    elif code == 'MSC_YCBG':
        from .ycbg import search
        page=0
        while True:
            result=search(filters,page=page,size=5000)
            yield from result['items']
            if not result['hasMore']:
                break
            page+=1
    else:
        page, cursor = 0, None
        kind = 'prices' if code == 'MSC_PRICE' else 'tenders'
        while True:
            result = msc.search(kind, filters, page=page, size=5000, cursor=cursor)
            yield from result['items']
            if not result['hasMore']:
                break
            next_cursor = result.get('nextCursor')
            if not next_cursor or next_cursor == cursor:
                raise ValueError('Không thể lấy trang kế tiếp đầy đủ. Hãy thu hẹp bộ lọc.')
            cursor, page = next_cursor, page + 1


def create_export(body):
    code = str(body.get('code') or '').upper()
    fmt = str(body.get('format') or 'xlsx')
    if code not in COLUMNS or fmt not in ('xlsx','csv'):
        raise ValueError('Nguồn hoặc định dạng tải không hợp lệ.')
    filters = dict(body.get('filters') or {})
    start, end = export_day(body.get('start')), export_day(body.get('end'))
    if start and end and start > end:
        raise ValueError('Từ ngày phải trước hoặc bằng đến ngày.')
    if code == 'VSS':
        filters.update(tuNgay=start, denNgay=end)
    elif code.startswith('MSC_') and start:
        filters['publishedFrom'] = start
    from .ycbg import DB as YCBG_DB
    source = {'VSS':vss.VSS_DB, 'DAV':dav.DAV_DB, 'MSC_PRICE':msc.MSC_DB, 'MSC_BID':msc.MSC_DB,'MSC_YCBG':YCBG_DB}[code]
    paths = [source,Path(str(source)+'-wal'),dav.DAV_DB,Path(str(dav.DAV_DB)+'-wal'),COLUMNS_PATH,Path(__file__)]
    signature = [code,fmt,filters,start,end,[(str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in paths if p.exists() and (not str(p).endswith('-wal') or p.stat().st_size)]]
    if not source.exists():
        raise FileNotFoundError('Chưa có dữ liệu local cho nguồn đã chọn.')
    key = hashlib.sha256(json.dumps(signature,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    folder = DATA_DIR / 'downloads'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f'{key}.{fmt}'
    with _lock:
        if path.exists():
            return path, code, fmt
        fd, filename = tempfile.mkstemp(dir=folder, suffix='.'+fmt)
        os.close(fd)
        temporary = Path(filename)
        workbook, handle = None, None
        columns = COLUMNS[code]
        try:
            if fmt == 'xlsx':
                from openpyxl import Workbook
                from openpyxl.cell import WriteOnlyCell
                from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
                from openpyxl.styles import Font, PatternFill
                from openpyxl.utils import get_column_letter
                workbook = Workbook(write_only=True)
                sheet_index = 0
                has_summary = any(column.get('sum') for column in columns)
                data_rows_per_sheet = 1048574
                def new_sheet():
                    nonlocal sheet_index
                    sheet_index += 1
                    sheet = workbook.create_sheet(f'{code}_{sheet_index}')
                    sheet.freeze_panes = 'A3' if has_summary else 'A2'
                    sheet.row_dimensions[1].height = 28
                    for index,column in enumerate(columns,1):
                        sheet.column_dimensions[get_column_letter(index)].width = 36 if column['key'] in ('hoatchat','ten','tenThuoc','hoatChat','name','ingredient','nhasx','ctyDangKy','ctySanXuat','manufacturer','buyer','ten_cskcb') else 20
                    headers = []
                    for column in columns:
                        cell = WriteOnlyCell(sheet, value=column['label'])
                        cell.font = Font(bold=True, color='FFFFFF')
                        cell.fill = PatternFill('solid',fgColor='155E75')
                        headers.append(cell)
                    sheet.append(headers)
                    if has_summary:
                        summary = []
                        for index, column in enumerate(columns,1):
                            cell = WriteOnlyCell(sheet, value=f'=SUM({get_column_letter(index)}3:{get_column_letter(index)}1048576)' if column.get('sum') else ('Tổng' if index == 1 else None))
                            cell.font = Font(bold=True, color='234E3D')
                            cell.fill = PatternFill('solid',fgColor='E8F0EB')
                            summary.append(cell)
                        sheet.append(summary)
                    return sheet
                sheet = new_sheet()
            else:
                handle = temporary.open('w',encoding='utf-8-sig',newline='')
                writer = csv.writer(handle)
                writer.writerow(column['label'] for column in columns)
            count = 0
            for row in source_rows(code, filters):
                if code != 'VSS' and (start or end):
                    parsed = parse_date(row.get('ngayCap' if code == 'DAV' else 'published'))
                    day = parsed.date().isoformat() if parsed else ''
                    if not day or (start and day < start) or (end and day > end):
                        continue
                if fmt == 'xlsx' and count and count % data_rows_per_sheet == 0:
                    sheet = new_sheet()
                values = []
                for column in columns:
                    value = row.get(column['key'])
                    if column.get('numeric') and (value not in (None,'') or code == 'MSC_PRICE' and column['key'] == 'total_value' or code == 'VSS' and column['key'] == 'thanhtien'):
                        if code == 'VSS':
                            canonical = row.get('_analyticsNumbers')
                            if column['key'] == 'thanhtien':
                                if canonical is not None:
                                    price = canonical.get('gia')
                                    quantity = canonical.get('soluong')
                                    value = float(price) * float(quantity) if price is not None and quantity is not None else None
                                else:
                                    price = vss.parse_vn_number(row.get('gia'))
                                    quantity = vss.parse_vn_number(row.get('soluong'))
                                    value = price * quantity if price is not None and quantity is not None else None
                            else:
                                value = (float(canonical[column['key']]) if canonical.get(column['key']) is not None else None) if canonical is not None else vss.parse_vn_number(value)
                        elif code == 'MSC_PRICE' and column['key'] == 'total_value':
                            price, quantity = row.get('unit_price'), row.get('quantity')
                            value = float(price) * float(quantity) if price not in (None,'') and quantity not in (None,'') else None
                        else:
                            value = float(value)
                        if value is not None and not math.isfinite(value):
                            raise ValueError('Dữ liệu có số không hợp lệ; chưa xuất tệp.')
                    elif value is not None:
                        value = str(value)
                    if fmt == 'xlsx':
                        if value and column['key'] in ('tungay_hd','denngay_hd','published','close_date','ngayCap','ngayHetHan'):
                            try:
                                value = datetime.fromisoformat(str(value).replace('Z','+00:00')).replace(tzinfo=None)
                            except ValueError:
                                parsed = parse_date(value)
                                if parsed:
                                    value = parsed.replace(tzinfo=None)
                        if isinstance(value,str):
                            value = ILLEGAL_CHARACTERS_RE.sub('',value)
                        cell = WriteOnlyCell(sheet, value=value)
                        if isinstance(value,str):
                            cell.data_type = 's'
                        if column.get('numeric'):
                            cell.number_format = '#,##0' if value is None or float(value).is_integer() else '#,##0.############'
                        elif column['key'] in ('sodk','soDangKy','soDangKyCu','registration','ma_tinh','ma_cskcb'):
                            cell.number_format = '@'
                        elif isinstance(value,datetime):
                            cell.number_format = 'dd/mm/yyyy'
                        values.append(cell)
                    else:
                        values.append("'"+value if isinstance(value,str) and value.startswith(('=','+','-','@')) else value)
                if fmt == 'xlsx':
                    sheet.append(values)
                else:
                    writer.writerow(values)
                count += 1
            if not count:
                raise ValueError('Không có dữ liệu theo bộ lọc đã chọn.')
            if workbook:
                for index,sheet in enumerate(workbook.worksheets):
                    sheet.auto_filter.ref = f'A1:{get_column_letter(len(columns))}{min(count-index*data_rows_per_sheet,data_rows_per_sheet)+(2 if has_summary else 1)}'
                notes = workbook.create_sheet('Bo_loc')
                notes.column_dimensions['A'].width = 26
                notes.column_dimensions['B'].width = 90
                for pair in [('Nguồn',code),('Từ ngày',start or 'Toàn bộ'),('Đến ngày',end or 'Toàn bộ'),('Số dòng',count),('Bộ lọc',json.dumps(filters,ensure_ascii=False)),('Ngày lọc','Ngày bắt đầu HĐ' if code=='VSS' else 'Ngày cấp SĐK' if code=='DAV' else 'Ngày đăng / KQLCNT')]:
                    notes.append(pair)
                workbook.save(temporary)
            if handle:
                handle.close()
            temporary.replace(path)
        finally:
            if workbook:
                for sheet in workbook.worksheets:
                    if not sheet.closed:
                        sheet.close()
                workbook.close()
            if handle and not handle.closed:
                handle.close()
            temporary.unlink(missing_ok=True)
    return path, code, fmt
