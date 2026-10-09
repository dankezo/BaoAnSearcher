"""Read-only SQL bridge. No raw dataset is sent to Node or the browser."""
import json
import re
import sqlite3
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.common import DAV_DB, MSC_DB, VSS_DB, fold


@lru_cache(maxsize=8192)
def decimal(value):
    if value is None or str(value).strip() == '':
        return None
    if isinstance(value, (int, float, Decimal)):
        number = Decimal(str(value))
        return number if number.is_finite() else None
    text = str(value).strip().replace(' ', '')
    if re.fullmatch(r'-?\d{1,3}(\.\d{3})+(,\d+)?', text):
        text = text.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'-?\d+,\d+', text):
        text = text.replace(',', '.')
    try:
        value = Decimal(text)
        return value if value.is_finite() else None
    except InvalidOperation:
        return None


def canonical_decimal(value):
    """TiDB decimal strings use a dot regardless of source locale."""
    try:
        number = Decimal(str(value)) if value not in (None, '') else None
        return str(number) if number is not None and number.is_finite() else None
    except InvalidOperation:
        return None


class DecimalSum:
    def __init__(self):
        self.total = None

    def step(self, value):
        # Canonical SQL has already normalized numbers; avoid re-running the
        # Vietnamese input parser for every aggregate/dimension.
        value = Decimal(str(value)) if value is not None else None
        if value is not None:
            self.total = (self.total or Decimal(0)) + value

    def finalize(self):
        return str(self.total) if self.total is not None else None


class DecimalMin:
    maximum = False
    def __init__(self):
        self.value = None
    def step(self, value):
        if value is None:
            return
        try:
            number=Decimal(str(value))
        except InvalidOperation:
            number=None
        value=number if number is not None else str(value)
        if self.value is None or (value > self.value if self.maximum else value < self.value):
            self.value=value
    def finalize(self):
        return str(self.value) if self.value is not None else None


class DecimalMax(DecimalMin):
    maximum = True


@lru_cache(maxsize=4096)
def date(value):
    text = str(value or '').strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}', text):
        try:
            return datetime.fromisoformat(text[:10]).date().isoformat()
        except ValueError:
            return None
    for pattern in ('%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(text[:10], pattern).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return None


@lru_cache(maxsize=256)
def parsed(source, raw):
    value = json.loads(raw)
    if source != 'dav':
        return value
    tt=value.get('thongTinThuocCoBan') or {}
    td=value.get('thongTinDangKyThuoc') or {}
    sx=value.get('congTySanXuat') or {}
    dk=value.get('congTyDangKy') or {}
    return dict(value, hoatChat=tt.get('hoatChatChinh') or value.get('hoatChatChinh'), hamLuong=tt.get('hamLuong') or value.get('hamLuong'), dangBaoChe=tt.get('dangBaoChe') or value.get('dangBaoChe'), ngayCap=td.get('ngayCapSoDangKy') or value.get('ngayCapSoDangKy'), ngayHetHan=td.get('ngayHetHanSoDangKy'), ctySanXuat=sx.get('tenCongTySanXuat') or value.get('tenCongTySanXuat'), ctyDangKy=dk.get('tenCongTyDangKy'))


MAPS = {
    'dav': {'name':'tenThuoc','ingredient':'hoatChat','strength':'hamLuong','form':'dangBaoChe','registration':'soDangKy','manufacturer':'ctySanXuat','registrant':'ctyDangKy','group_name':'technical_group_unavailable','date':'ngayCap','expiry':'ngayHetHan'},
    'vss': {'name':'ten','ingredient':'hoatchat','strength':'hamluong','form':'dangbaoche','route':'duongdung','registration':'sodk','manufacturer':'nhasx','company':'tennhathau','province':'ten_tinh','facility':'ten_cskcb','group_name':'nhomthau','unit':'donvitinh','price':'gia','quantity':'soluong','amount':'thanhtien','date':'tungay_hd'},
    'msc_prices': {'form':'dosage_form','facility':'buyer','company':'winner','price':'unit_price','date':'published'},
    'msc_tenders': {'facility':'buyer','amount':'bid_price','date':'published','status':'status_label'},
}


def field(source, raw, key):
    item = parsed(source, raw)
    if key == 'updated_at':
        return item.get('collected_at') or item.get('created_date') or item.get('lastModificationTime') or item.get('creationTime')
    if key == 'amount' and source == 'msc_prices':
        price, quantity = decimal(item.get('unit_price')), decimal(item.get('quantity'))
        return str(price * quantity) if price is not None and quantity is not None else None
    value = item.get(MAPS[source].get(key, key))
    if key in ('price', 'quantity', 'amount'):
        number = decimal(value)
        return str(number) if number is not None else None
    if key in ('date', 'expiry'):
        return date(value)
    return str(value) if value is not None and not isinstance(value, (dict, list)) else None


def open_db(source):
    path = DAV_DB if source == 'dav' else VSS_DB if source == 'vss' else MSC_DB
    import os
    if os.environ.get('ANALYTICS_DB_DIR'):
        path=Path(os.environ['ANALYTICS_DB_DIR'])/(source+'.sqlite3')
    connection = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA query_only=ON')
    connection.execute('PRAGMA temp_store=MEMORY')
    connection.execute('PRAGMA cache_size=-32768')
    connection.create_function('AFIELD', 3, field, deterministic=True)
    connection.create_function('ADATE', 1, date, deterministic=True)
    connection.create_function('DNUM', 1, lambda x: str(n) if (n := decimal(x)) is not None else None, deterministic=True)
    connection.create_function('CNUM', 1, canonical_decimal, deterministic=True)
    connection.create_function('DMUL', 2, lambda a,b: str(decimal(a)*decimal(b)) if decimal(a) is not None and decimal(b) is not None else None, deterministic=True)
    connection.create_function('CMUL', 2, lambda a,b: str(Decimal(a)*Decimal(b)) if a is not None and b is not None else None, deterministic=True)
    connection.create_function('FOLD', 1, lambda x: re.sub(r'\s+', ' ', fold(x)).strip(), deterministic=True)
    connection.create_function('AGROUP', 1, lru_cache(maxsize=256)(lambda x: (re.search(r'[1-5]', str(x or '')) or [''])[0]), deterministic=True)
    try:
        profile_path=Path(os.environ['ANALYTICS_COMPANY_PROFILES_PATH']) if os.environ.get('ANALYTICS_COMPANY_PROFILES_PATH') else Path(os.environ['ANALYTICS_DB_DIR'])/'company_profiles.json' if os.environ.get('ANALYTICS_DB_DIR') else ROOT/'data'/'company_profiles.json'
        profiles=json.loads(profile_path.read_text(encoding='utf-8'))
    except (OSError,ValueError):
        profiles={}
    def company_province(name,role):
        item=profiles.get(re.sub(r'\s+',' ',fold(name)).strip()) or {}
        return item.get('factoryProvince' if role=='factory' else 'officeProvince')
    connection.create_function('COMPANY_PROVINCE',2,company_province,deterministic=True)
    connection.create_function('CONCAT', -1, lambda *x: ''.join(str(v or '') for v in x), deterministic=True)
    if source == 'vss':
        from server.sdk_forms import _load, norm_sdk
        forms = _load()
        connection.create_function('SDK_FORM',1,lambda sdk:forms.get(norm_sdk(sdk)),deterministic=True)
    connection.create_aggregate('SUM', 1, DecimalSum)
    connection.create_aggregate('DMIN', 1, DecimalMin)
    connection.create_aggregate('DMAX', 1, DecimalMax)
    return connection


def run():
    connections = {}
    for line in sys.stdin:
        request = json.loads(line)
        try:
            source = request['source']
            if source not in MAPS:
                raise ValueError('Invalid source')
            if source not in connections:
                connections[source] = open_db(source)
            sql = request['sql'].replace('MIN(price)', 'DMIN(price)').replace('MAX(price)', 'DMAX(price)')
            result = [dict(r) for r in connections[source].execute(sql, request.get('args', []))]
            response = {'id':request['id'], 'rows':result}
        except Exception as exc:
            response = {'id':request['id'], 'error':str(exc)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    for connection in connections.values():
        connection.close()


if __name__ == '__main__':
    run()
