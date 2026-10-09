"""Stream typed TiDB MSC/VSS rows into existing local SQLite, without deleting rows."""
import json
import sys
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'test zone' / 'procurement'))

from scripts.tidb.connect import connect, require_config
from server import vss
from server.common import MSC_DB, fold, write_metadata
from core import connect as local_msc
from excel_import import index_price
from scripts.tidb.rows import msc_price_source_id


def public_row(row):
    out = {}
    for key, value in row.items():
        if isinstance(value, (datetime, date)): value = value.isoformat()
        elif isinstance(value, Decimal): value = str(value)
        out[key] = value
    # Preserve original source text for ambiguous numbers/dates.
    for key in tuple(out):
        if key.endswith('_raw') and out[key] not in (None, '') and key[:-4] not in out:
            out[key[:-4]] = out[key]
    return out


def set_analytics_numbers(item, row, fields):
    item['_analyticsCanonical'] = True
    item['_analyticsNumbers'] = {
        key: str(row[key]) if row.get(key) is not None else None for key in fields
    }
    for key in fields:
        original = row.get(key + '_raw')
        value = row.get(key)
        if original not in (None, ''):
            item[key] = str(original)
        elif value is None:
            item[key] = None
        else:
            localized = format(Decimal(str(value)), 'f').replace('.', ',')
            integer, separator, fraction = localized.partition(',')
            if separator and len(fraction) == 3 and len(integer.lstrip('-')) <= 3:
                localized += '0'
            item[key] = localized


def import_msc(kind, batch, con=None, production_standard=False, membership_table='analytics_cloud_members'):
    owned = con is None
    con = con or local_msc(MSC_DB)
    try:
        for row in batch:
            item = public_row(row)
            sid = str(item['source_id'])
            if kind == 'prices' and not owned:
                alias = con.execute('SELECT source_id FROM cloud_price_alias WHERE cloud_id=?', (sid,)).fetchone()
                if alias: sid = alias[0]
            item['source_id'] = sid
            item['source_label'] = 'API Mua sắm công' if kind == 'prices' else 'Thông báo mời thầu'
            numeric_fields = ('unit_price', 'quantity') if kind == 'prices' else ('bid_price',)
            set_analytics_numbers(item, row, numeric_fields)
            if kind == 'prices':
                from core import registration_keys
                item['registration_keys'] = '; '.join(registration_keys(item.get('registration')))
            stamp = item.get('collected_at') or datetime.now().isoformat()
            # A local crawl that observed a newer source record wins.
            old = con.execute('SELECT collected_at FROM records WHERE kind=? AND source_id=?', (kind, sid)).fetchone()
            if not production_standard and old and str(old[0]) > str(stamp): continue
            raw = json.dumps(item, ensure_ascii=False)
            con.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,source_id) DO UPDATE SET tender_no=excluded.tender_no,raw=excluded.raw,normalized=excluded.normalized,search_text=excluded.search_text,collected_at=excluded.collected_at',
                        (kind, sid, item.get('tender_no') or '', raw, raw, item.get('search') or fold(raw), stamp))
            if kind == 'prices':
                index_item = dict(item)
                index_item.update({key: Decimal(value) if value is not None else None
                                   for key, value in item['_analyticsNumbers'].items()})
                index_price(con, sid, index_item, False)
            if production_standard:
                if membership_table not in ('analytics_cloud_members','analytics_cloud_members_staging'): raise ValueError('Invalid membership table')
                con.execute(f'INSERT OR IGNORE INTO {membership_table}(kind,id) VALUES (?,?)', (kind,sid))
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        if owned: con.close()


def import_vss(batch):
    # Keep the remote fingerprint exactly; replaying a pull is idempotent.
    fields = ('sodk', 'hoatchat', 'ten', 'loai', 'nhomthau', 'loai_thau', 'ma_tinh', 'nuocsx', 'duongdung', 'tungay_hd', 'denngay_hd', 'nam')
    with closing(vss.connect()) as con, con:
        for row in batch:
            item = public_row(row)
            set_analytics_numbers(item, row, ('gia', 'soluong', 'thanhtien'))
            con.execute('INSERT INTO bids (fingerprint,raw,search,' + ','.join(fields) + ') VALUES (' + ','.join('?' for _ in range(15)) + ') ON CONFLICT(fingerprint) DO UPDATE SET raw=excluded.raw,search=excluded.search,' + ','.join(f'{field}=excluded.{field}' for field in fields),
                        (item['fingerprint'], json.dumps(item, ensure_ascii=False), item.get('search') or '', *(item.get(field) for field in fields)))


def import_dav(batch):
    from server import dav
    with closing(dav.connect()) as con, con:
        for row in batch:
            item = public_row(row)
            raw = item.get('raw_json') or item.get('source_raw')
            if isinstance(raw, str):
                raw = json.loads(raw)
            if not isinstance(raw, dict):
                # TiDB stores the searchable DAV fields, not the original API
                # document. Rebuild the source shape from those canonical fields.
                raw = {
                    'id': item.get('id'),
                    'soDangKy': item.get('so_dang_ky') or '',
                    'soDangKyCu': item.get('so_dang_ky_cu') or '',
                    'tenThuoc': item.get('ten_thuoc') or '',
                    'thongTinThuocCoBan': {
                        'hoatChatChinh': item.get('hoat_chat') or '',
                        'hamLuong': item.get('ham_luong') or '',
                        'dangBaoChe': item.get('dang_bao_che') or '',
                        'nhomThuoc': item.get('drug_group') or '',
                        'dongGoi': item.get('dong_goi') or '',
                        'tuoiTho': item.get('han_dung') or '',
                    },
                    'thongTinDangKyThuoc': {
                        'ngayCapSoDangKy': item.get('ngay_cap_raw') or item.get('ngay_cap'),
                        'ngayGiaHanSoDangKy': item.get('ngay_gia_han_raw') or item.get('ngay_gia_han'),
                        'ngayHetHanSoDangKy': item.get('ngay_het_han_raw') or item.get('ngay_het_han'),
                        'soQuyetDinh': item.get('so_quyet_dinh') or '',
                        'tieuChuan': item.get('tieu_chuan') or '',
                    },
                    'congTySanXuat': {
                        'tenCongTySanXuat': item.get('cty_san_xuat') or '',
                        'nuocSanXuat': item.get('nuoc_san_xuat') or '',
                    },
                    'congTyDangKy': {
                        'tenCongTyDangKy': item.get('cty_dang_ky') or '',
                        'nuocDangKy': item.get('nuoc_dang_ky') or '',
                    },
                    '_cloudCanonical': True,
                    'isActive': None,
                }
            source_id = str(item.get('id') or raw.get('id') or item.get('so_dang_ky') or '')
            if not source_id:
                raise ValueError('DAV row missing id and registration number')
            raw['id'] = raw.get('id') or source_id
            previous = con.execute('SELECT raw FROM drugs WHERE id=?', (source_id,)).fetchone()
            if previous and raw.get('_cloudCanonical'):
                existing = json.loads(previous[0])
                # Preserve source-only flags/details that TiDB cannot reproduce.
                for key, value in raw.items():
                    if isinstance(value, dict):
                        existing[key] = dict(existing.get(key) or {}, **{k:v for k,v in value.items() if v not in (None, '')})
                    elif value not in (None, ''):
                        existing[key] = value
                raw = existing
            search = item.get('search') or ''
            con.execute(
                'INSERT INTO drugs (id,raw,search) VALUES (?,?,?) '
                'ON CONFLICT(id) DO UPDATE SET raw=excluded.raw,search=excluded.search',
                (source_id, json.dumps(raw, ensure_ascii=False), search),
            )


def pull_all(production_standard=False):
    import pymysql
    conn = connect(require_config())
    counts = {}
    local = local_msc(MSC_DB)
    try:
        if production_standard:
            local.execute('CREATE TABLE IF NOT EXISTS analytics_cloud_members(kind TEXT,id TEXT,PRIMARY KEY(kind,id))')
            local.execute('CREATE TABLE IF NOT EXISTS analytics_cloud_members_staging(kind TEXT,id TEXT,PRIMARY KEY(kind,id))')
            local.execute('DELETE FROM analytics_cloud_members_staging')
        # Match cloud IDs to existing local source IDs to avoid duplicate prices.
        local.execute('CREATE TEMP TABLE cloud_price_alias (cloud_id TEXT PRIMARY KEY, source_id TEXT)')
        cursor = local.execute("SELECT source_id,normalized,search_text,collected_at FROM records WHERE kind='prices'")
        while batch := cursor.fetchmany(500):
            aliases = [(msc_price_source_id(json.loads(raw), sid, search, stamp), sid) for sid, raw, search, stamp in batch]
            local.executemany('INSERT OR IGNORE INTO cloud_price_alias VALUES (?,?)', aliases)
        local.commit()
        errors = []
        completed_tables = set()
        for table, importer in (
            ('dav_drugs', import_dav),
            ('msc_prices', lambda batch: import_msc('prices', batch, local, production_standard, 'analytics_cloud_members_staging')),
            ('msc_tenders', lambda batch: import_msc('tenders', batch, local, production_standard, 'analytics_cloud_members_staging')),
            ('vss_bids', import_vss),
        ):
            count = 0
            try:
                with conn.cursor(pymysql.cursors.SSDictCursor) as cursor:
                    cursor.execute(f'SELECT * FROM {table}')
                    while batch := cursor.fetchmany(500):
                        importer(batch)
                        count += len(batch)
                completed_tables.add(table)
            except Exception as exc:
                errors.append(f'{table}: {type(exc).__name__}')
            counts[table] = count
        with closing(vss.connect()) as vss_local, vss_local:
            write_metadata(vss_local, 'vss_total', vss_local.execute('SELECT count(*) FROM bids').fetchone()[0])
        if production_standard and len(completed_tables)==4:
            local.execute('DELETE FROM analytics_cloud_members')
            local.execute('INSERT INTO analytics_cloud_members SELECT kind,id FROM analytics_cloud_members_staging')
            local.commit()
            marker=ROOT/'data'/'analytics_production_baseline.json'
            temporary=marker.with_suffix('.tmp')
            temporary.write_text(json.dumps({'counts':counts,'completedAt':datetime.now().isoformat()},ensure_ascii=False),encoding='utf-8')
            temporary.replace(marker)
        from server.common import update_status, now_iso
        from server import dav, msc, stored_metrics
        msc.meta_info()
        if 'vss_bids' in completed_tables:
            update_status('vss', state='idle', count=vss.meta_info()['count'], updated=now_iso(), message='Đã tải dữ liệu TiDB về local')
        for section, rebuild in (('dav', stored_metrics.refresh_dav), ('vss', stored_metrics.refresh_vss)):
            try:
                rebuild()
            except Exception as exc:
                errors.append(f'{section}_derived: {type(exc).__name__}')
        if 'dav_drugs' in completed_tables:
            with closing(dav.connect()) as dav_local:
                dav_count = dav_local.execute('SELECT COUNT(*) FROM drugs').fetchone()[0]
            update_status('dav', state='idle', count=dav_count, updated=now_iso(), message='Đã tải dữ liệu TiDB về local; hồ sơ chỉ có cột chuẩn hóa cần đối chiếu trạng thái gốc DAV')
        try:
            # Build the common suggestion index used by both analytics modes.
            import subprocess
            result = subprocess.run([sys.executable, str(ROOT/'scripts'/'build_rollups.py')], capture_output=True, timeout=900, cwd=ROOT)
            if result.returncode:
                errors.append('analytics_suggestions: rebuild_failed')
        except Exception as exc:
            errors.append(f'analytics_suggestions: {type(exc).__name__}')
        # Public webforms are stored separately from tender summary rows.
        has_scopes = False
        try:
            conn.ping(reconnect=True)
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='msc_scope_lots'")
                has_scopes = bool(cur.fetchone()[0])
        except Exception as exc:
            errors.append(f'msc_scope_lots_metadata: {type(exc).__name__}')
        if has_scopes:
            try:
                from server.msc_scope import _connect
                from server.baoan_match import match_lots
                with closing(_connect()) as scopes, scopes:
                    with conn.cursor(pymysql.cursors.SSDictCursor) as cur:
                        cur.execute('SELECT notify_id,tender_no,lots,fetched_at FROM msc_scope_lots')
                        count = 0
                        while batch := cur.fetchmany(100):
                            for row in batch:
                                lots = row['lots'] if isinstance(row['lots'], list) else json.loads(row['lots'])
                                stamp = row['fetched_at'].isoformat()
                                scopes.execute('INSERT OR REPLACE INTO scope_lots VALUES (?,?,?)', (row['notify_id'], json.dumps(lots, ensure_ascii=False), stamp))
                                scopes.execute('INSERT OR REPLACE INTO scope_match VALUES (?,?,?,?)', (row['notify_id'], row['tender_no'], match_lots(lots), stamp))
                                count += 1
                            scopes.commit()
                        counts['msc_scope_lots'] = count
            except Exception as exc:
                errors.append(f'msc_scope_lots: {type(exc).__name__}')
        counts['_canonical_ready'] = production_standard and len(completed_tables)==4
        if errors:
            counts['_errors'] = errors
        counts['completedAt'] = now_iso()
        return counts
    finally:
        local.close()
        conn.close()
