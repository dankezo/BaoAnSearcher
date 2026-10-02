"""Evidence-backed prices and award histories for the portfolio."""
from __future__ import annotations
import json
import re
import sqlite3
from .common import MSC_DB, fold, normalize_strength
from .portfolio import _sdk_key, _plant_key, parse_money, group_number


def tender_links():
    if not MSC_DB.exists():
        return {}
    with sqlite3.connect(MSC_DB) as con:
        rows = con.execute("SELECT normalized FROM records WHERE kind='tenders'").fetchall()
    return {str(r.get('tender_no') or '').split('-')[0]: r.get('source_url') for (raw,) in rows if (r := json.loads(raw)).get('source_url')}


def award(row, source, links):
    msc = source == 'MSC'
    number = str(row.get('tender_no') if msc else row.get('goithau') or '')
    url = links.get(number.split('-')[0]) if msc else None
    original = str(row.get('source_url') or '')
    if not url and original.startswith('https://muasamcong.mpi.gov.vn/') and 'id=' in original:
        url = original
    return {
        'source': source, 'tenderNo': number, 'decision': row.get('decision' if msc else 'quyetdinh') or '',
        'date': row.get('decision_date') or row.get('published') or row.get('tungay_hd') or row.get('tungay') or row.get('congbo') or '',
        'dateKind': 'Ngày quyết định' if msc and row.get('decision_date') else 'Ngày công bố' if msc else 'Bắt đầu hợp đồng',
        'name': row.get('name' if msc else 'ten') or '',
        'registration': row.get('registration' if msc else 'sodk') or '',
        'ingredient': row.get('ingredient' if msc else 'hoatchat') or '',
        'strength': row.get('strength' if msc else 'hamluong') or '',
        'dosageForm': row.get('dosage_form' if msc else 'dangbaoche') or '',
        'group': row.get('group_name' if msc else 'nhomthau') or '',
        'manufacturer': row.get('manufacturer' if msc else 'nhasx') or '',
        'buyer': row.get('buyer' if msc else 'ten_cskcb') or row.get('ten_don_vi') or '',
        'province': row.get('province' if msc else 'ten_tinh') or '',
        'winner': row.get('winner' if msc else 'tennhathau') or '',
        'unit': row.get('unit' if msc else 'donvitinh') or '',
        'price': parse_money(row.get('unit_price' if msc else 'gia')),
        'quantity': parse_money(row.get('quantity' if msc else 'soluong')),
        'sourceUrl': url or '',
    }


def registration_keys(value):
    found = re.findall(r'\b(?:[A-Z]{1,5}[-\s]?\d{2,8}[-\s]\d{2,4}|\d{12})\b', str(value or '').upper())
    return {_sdk_key(v) for v in found} or ({_sdk_key(value)} if value else set())


def _line_key(item):
    """One stored copy of a line. A different tender group is a different award."""
    return (
        item['source'], item['tenderNo'], item['registration'], item['buyer'],
        item['price'], item['quantity'], item['date'], item['decision'],
        item['group'], item['strength'], item['dosageForm'], item['name'], item['province'],
    )


def index_awards(msc, vss, dav_rows=()):
    links, index = tender_links(), {}
    aliases = {}
    for row in dav_rows:
        current = _sdk_key(row.get('so_dang_ky') or '')
        if current:
            related = registration_keys(row.get('so_dang_ky_cu')) | {current}
            for sdk in related:
                aliases.setdefault(sdk, set()).update(related)
    for source, rows, key in [('MSC', msc, 'registration'), ('VSS', vss, 'sodk')]:
        seen = set()
        for row in rows:
            sdks = registration_keys(row.get(key))
            if not sdks:
                continue
            # Old/new registration relationships come only from the DAV record.
            for sdk in tuple(sdks):
                sdks.update(aliases.get(sdk, ()))
            item = award(row, source, links)
            identity = _line_key(item)
            if identity in seen:
                continue
            seen.add(identity)
            for sdk in sdks:
                index.setdefault(sdk, []).append(item)
    for history in index.values():
        history.sort(key=lambda r: (str(r['date']), r['source'] == 'MSC'), reverse=True)
    return index


def summarize(history):
    priced = [h for h in history if h['price'] is not None and h['price'] > 0]
    latest = priced[0] if priced else None
    # Do not add the same procurement from MSC and VSS together.
    source = 'MSC' if any(h['source'] == 'MSC' for h in history) else 'VSS'
    quantities = [h for h in history if h['source'] == source and h['quantity'] is not None]
    units = {fold(h['unit']) for h in quantities}
    quantity = sum(h['quantity'] for h in quantities) if quantities and len(units) == 1 and '' not in units else None
    totals = {}
    for item in history:
        if item['quantity'] is None or not item['unit']:
            continue
        key = (item['source'], fold(item['unit']))
        slot = totals.setdefault(key, {'source': item['source'], 'unit': item['unit'], 'quantity': 0})
        slot['quantity'] += item['quantity']
    return {'latestAward': latest, 'mscPrice': latest['price'] if latest else None,
            'mscUnit': latest['unit'] if latest else '', 'mscGroup': latest['group'] if latest else '',
            'awardCount': len(history), 'totalQuantity': quantity, 'quantitySource': source,
            'quantityUnit': quantities[0]['unit'] if quantity is not None else '',
            'quantityTotals': list(totals.values())}


def compare_price(own, rival):
    a, b = own.get('latestAward'), rival.get('latestAward')
    if not a or not b:
        return None, 'Chưa có giá trúng thầu để so sánh'
    if not a.get('unit') or fold(a['unit']) != fold(b.get('unit')):
        return None, 'Khác hoặc thiếu đơn vị tính'
    if not group_number(a.get('group')) or group_number(a['group']) != group_number(b.get('group')):
        return None, 'Khác hoặc thiếu nhóm thầu'
    if not a.get('strength') or normalize_strength(a['strength']) != normalize_strength(b.get('strength') or ''):
        return None, 'Khác hoặc thiếu hàm lượng trong kết quả thầu'
    if not a.get('dosageForm') or fold(a['dosageForm']) != fold(b.get('dosageForm')):
        return None, 'Khác hoặc thiếu dạng bào chế trong kết quả thầu'
    return (b['price'] / a['price'] - 1) * 100, ''


def enrich(row, index):
    history = index.get(_sdk_key(row['regNumber']), [])
    row.update(summarize(history))
    row['wonBid'] = bool(history)
    for rival in row['competitors']:
        if not str(rival.get('inn') or '').strip():
            rival['inn'] = row.get('inn') or ''
        rival.update(summarize(index.get(_sdk_key(rival['regNumber']), [])))
        rival['priceDeltaPct'], rival['comparisonNote'] = compare_price(row, rival)
