"""Read-only report inputs; retain the same contract-start window as VSS metrics."""
from contextlib import closing
from datetime import date, timedelta
import json
import sqlite3
from .common import VSS_DB, DAV_DB, fold
from .dav import flatten
from .vss import parse_vn_number
from .sdk_forms import norm_sdk


def report_inputs(q):
    if q.get('source') == 'msc':
        return msc_report_inputs(q)
    keyword = str(q.get('keyword') or '').strip()
    searches = [(key, str(q.get(key) or '').strip()) for key in ('ingredient','name','registration') if str(q.get(key) or '').strip()]
    if not searches:
        searches = [(q.get('searchField') or 'ingredient', keyword)]
    if any(len(value) < 3 for _, value in searches):
        raise ValueError('Nhập ít nhất 3 ký tự hoạt chất, tên thuốc hoặc SĐK.')
    start_text, end_text = str(q.get('start') or ''), str(q.get('end') or '')
    try:
        start, end = date.fromisoformat(start_text), date.fromisoformat(end_text)
    except ValueError:
        raise ValueError('Khoảng ngày không hợp lệ.') from None
    if start.isoformat() != start_text or end.isoformat() != end_text:
        raise ValueError('Khoảng ngày không hợp lệ.')
    if start > end:
        raise ValueError('Từ ngày phải trước hoặc bằng đến ngày.')
    clauses = ['loai = ?', 'tungay_hd >= ?', 'tungay_hd < ?']
    args = ['Tân dược', start.isoformat(), (end + timedelta(days=1)).isoformat()]
    for key, value in searches:
        field = {'ingredient':'hoatchat','name':'ten','registration':'sodk'}.get(key,'hoatchat')
        clauses.append('sodk = ?' if key == 'registration' else f'fold({field}) LIKE ?')
        args.append(norm_sdk(value) if key == 'registration' else '%' + fold(value).replace('%','').replace('_','') + '%')
    group = str(q.get('group') or '')
    if group in ('1','2','3','4','5'):
        clauses.append('nhomthau IN (?, ?, ?)')
        args.extend([group, 'N' + group, 'Nhóm ' + group])
    with closing(sqlite3.connect(f'file:{VSS_DB}?mode=ro', uri=True)) as con:
        con.create_function('fold', 1, fold)
        rows = con.execute('SELECT id, raw FROM bids WHERE ' + ' AND '.join(clauses) + ' ORDER BY tungay_hd DESC, id DESC LIMIT 5001', args).fetchall()
    if len(rows) > 5000:
        raise ValueError('Có hơn 5.000 dòng. Hãy thu hẹp hoạt chất hoặc kỳ để lấy báo cáo đầy đủ.')
    raw = [(str(key), json.loads(value)) for key, value in rows]
    catalog = dav_catalog({norm_sdk(row.get('sodk')) for _, row in raw})
    def number(row, key):
        if '_analyticsNumbers' in row:
            value = row['_analyticsNumbers'].get(key)
            return float(value) if value is not None else None
        return parse_vn_number(row.get(key))
    items = []
    for key, row in raw:
        dav = catalog.get(norm_sdk(row.get('sodk')), {})
        row = {**row, 'dangbaoche':one(dav,'forms') or row.get('dangbaoche'), 'nhasx':one(dav,'manufacturers') or row.get('nhasx'), 'nuocsx':one(dav,'countries') or row.get('nuocsx')}
        items.append(dict(id=key, brandName=row.get('ten') or '', activeIngredient=row.get('hoatchat') or '', strength=row.get('hamluong') or '', regNumber=row.get('sodk') or '', registrationCompany=one(dav,'companies'), route=row.get('duongdung') or '', dosageForm=row.get('dangbaoche') or one(dav,'forms'), group=''.join(c for c in str(row.get('nhomthau') or '') if c in '12345'), manufacturer=row.get('nhasx') or '', country=row.get('nuocsx') or '', unit=row.get('donvitinh') or '', quantity=number(row,'soluong'), unitPrice=number(row,'gia'), totalAmount=number(row,'thanhtien'), hospitalName=row.get('ten_cskcb') or row.get('ten_don_vi') or '', province=row.get('ten_tinh') or '', procurementCode=row.get('goithau') or row.get('quyetdinh') or '', date=str(row.get('tungay_hd') or '')[:10], dateBasis='Ngày bắt đầu HĐ'))
    return {'items': items, 'query': q, 'source':'VSS · hồ sơ DAV', 'dateBasis':'Ngày bắt đầu HĐ'}


def msc_report_inputs(q):
    from .msc import search
    from .metric_slice import _num
    start, end = date.fromisoformat(q.get('start') or ''), date.fromisoformat(q.get('end') or '')
    if start.isoformat() != q.get('start') or end.isoformat() != q.get('end'):
        raise ValueError('Khoảng ngày không hợp lệ.')
    if start > end:
        raise ValueError('Từ ngày phải trước hoặc bằng đến ngày.')
    filters = {key: str(q.get(key) or '').strip() for key in ('ingredient', 'name', 'registration')}
    if not any(filters.values()):
        field = q.get('searchField') if q.get('searchField') in filters else 'ingredient'
        filters[field] = str(q.get('keyword') or '').strip()
    if any(len(value) < 3 for value in filters.values() if value) or not any(filters.values()):
        raise ValueError('Nhập ít nhất 3 ký tự hoạt chất, tên thuốc hoặc SĐK.')
    filters.update(publishedFrom=start.isoformat(), publishedTo=end.isoformat(), strictDates=True, group_name=q.get('group') or '')
    rows, cursor = [], None
    while True:
        result = search('prices', filters, size=1000, cursor=cursor)
        rows.extend(result['items'])
        if len(rows) > 5000:
            raise ValueError('Có hơn 5.000 dòng. Hãy thu hẹp hoạt chất hoặc kỳ để lấy báo cáo đầy đủ.')
        if not result.get('hasMore'):
            break
        cursor = result['nextCursor']
    catalog = dav_catalog({norm_sdk(row.get('registration')) for row in rows})
    items = []
    for row in rows:
        dav = catalog.get(norm_sdk(row.get('registration')), {})
        numbers = row.get('_analyticsNumbers')
        def number(key):
            value = numbers.get(key) if numbers is not None else row.get(key)
            return None if value is None or value == '' else float(value) if numbers is not None else _num(value)
        price, quantity = number('unit_price'), number('quantity')
        items.append(dict(id=row['source_id'], brandName=row.get('name') or '', activeIngredient=row.get('ingredient') or '', strength=row.get('strength') or '', regNumber=row.get('registration') or '', registrationCompany=one(dav, 'companies'), route=row.get('route') or '', dosageForm=row.get('dosage_form') or '', group=''.join(c for c in str(row.get('group_name') or '') if c in '12345'), manufacturer=row.get('manufacturer') or '', country=row.get('country') or '', unit=row.get('unit') or '', quantity=quantity, unitPrice=price, totalAmount=price * quantity if price is not None and quantity is not None else None, hospitalName=row.get('buyer') or '', province=row.get('province') or '', procurementCode=row.get('tender_no') or '', date=str(row.get('published') or '')[:10], dateBasis='Ngày KQLCNT'))
    return {'items': items, 'query': q, 'source': 'MSC', 'dateBasis': 'Ngày KQLCNT'}


def dav_catalog(sdks):
    catalog = {}
    if DAV_DB.exists() and sdks:
        with closing(sqlite3.connect(f'file:{DAV_DB}?mode=ro', uri=True)) as con:
            con.create_function('norm_sdk', 1, norm_sdk)
            keys = sorted(sdks - {''})
            slots = ','.join('?' for _ in keys)
            matched = con.execute(f"SELECT raw FROM drugs WHERE norm_sdk(json_extract(raw,'$.soDangKy')) IN ({slots}) OR norm_sdk(json_extract(raw,'$.soDangKyCu')) IN ({slots})", keys + keys) if keys else []
            for value, in matched:
                doc = json.loads(value)
                flat = flatten(doc)
                for key in (norm_sdk(flat.get('soDangKy')), norm_sdk(flat.get('soDangKyCu'))):
                    if key not in sdks:
                        continue
                    entry = catalog.setdefault(key, {})
                    for field, name in [('dangBaoChe','forms'),('ctyDangKy','companies'),('ctySanXuat','manufacturers'),('nuocSanXuat','countries')]:
                        text = str(flat.get(field) or doc.get(field) or '').strip()
                        if text:
                            entry.setdefault(name,set()).add(text)
    return catalog


def one(entry, field):
    values = entry.get(field) or set()
    return next(iter(values)) if len(values) == 1 else ''
