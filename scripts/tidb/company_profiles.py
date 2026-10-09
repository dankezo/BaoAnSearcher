"""Verified DAV location sidecar, mirrored from production without editing fact geography."""
import argparse
import json
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from scripts.tidb.connect import connect, require_config
from server.common import ROOT, DAV_DB, MSC_DB, VSS_DB, fold

PATH = ROOT / 'data' / 'company_profiles.json'

def key(value):
    return re.sub(r'\s+', ' ', fold(value)).strip()[:700]

def province(address, country=''):
    if country and key(country) not in ('viet nam','vietnam','vn'):
        return None
    text=key(address)
    # Country and the final province segment prevent e.g. Hanoi street names
    # from being interpreted as a province in another city.
    names=re.findall(r"'\d+': '([^']+)'", (ROOT/'api-lib'/'vnProvinces.js').read_text(encoding='utf-8'))
    aliases={'ho chi minh':['tp hcm','tphcm','tp.hcm','hcm'], 'thua thien hue':['hue']}
    matches=[]
    for name in names:
        for label in [key(name),*aliases.get(key(name),[])]:
            found=list(re.finditer(r'(?<!\w)'+re.escape(label)+r'(?!\w)',text))
            if found: matches.append((found[-1].start(),name))
    return max(matches)[1] if matches else None

def mirror(connection):
    with connection.cursor() as cursor:
        cursor.execute('SELECT name_key,profile_json FROM company_profiles')
        records={name:json.loads(value) if isinstance(value,str) else value for name,value in cursor.fetchall()}
    PATH.parent.mkdir(parents=True,exist_ok=True)
    temporary=PATH.with_suffix('.tmp')
    temporary.write_text(json.dumps(records,ensure_ascii=False),encoding='utf-8')
    temporary.replace(PATH)
    return records

def upsert(connection,profile):
    name=profile.get('legalName') or ''
    if not name or len(name)>700: raise ValueError('Invalid company name')
    with connection.cursor() as cursor:
        cursor.execute('INSERT INTO company_profiles(name_key,legal_name,office_province,factory_province,profile_json,checked_at) VALUES (%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE legal_name=VALUES(legal_name),office_province=VALUES(office_province),factory_province=VALUES(factory_province),profile_json=VALUES(profile_json),checked_at=VALUES(checked_at)',
                       (key(name),name,profile.get('officeProvince'),profile.get('factoryProvince'),json.dumps(profile,ensure_ascii=False),datetime.now()))

def publish_dav(connection):
    marker=ROOT/'data'/'analytics_production_baseline.json'
    if not marker.exists() or not json.loads(marker.read_text(encoding='utf-8')).get('identityVerifiedAt'):
        raise ValueError('Production baseline must be pulled and identities verified before enrichment')
    with connection.cursor() as cursor:
        cursor.execute('SELECT DISTINCT cty_san_xuat FROM dav_drugs WHERE cty_san_xuat IS NOT NULL')
        manufacturers={key(row[0]) for row in cursor.fetchall()}
        cursor.execute('SELECT DISTINCT cty_dang_ky FROM dav_drugs WHERE cty_dang_ky IS NOT NULL')
        registrants={key(row[0]) for row in cursor.fetchall()}
    records=mirror(connection)
    observed={}
    with sqlite3.connect(f'file:{DAV_DB.as_posix()}?mode=ro',uri=True) as local:
        for (raw,) in local.execute('SELECT raw FROM drugs WHERE id IN (SELECT id FROM analytics_cloud_members)'):
            doc=json.loads(raw)
            for role,container,name_field,address_field,country_field,allowed in [
                ('factory','congTySanXuat','tenCongTySanXuat','diaChiSanXuat','nuocSanXuat',manufacturers),
                ('office','congTyDangKy','tenCongTyDangKy','diaChiDangKy','nuocDangKy',registrants)]:
                company=doc.get(container) or {}; name=company.get(name_field) or ''; address=company.get(address_field) or ''
                name_key=key(name)
                if not name_key or name_key not in allowed or not address: continue
                location=province(address,company.get(country_field) or '')
                if not location: continue
                item=observed.setdefault(name_key,{'legalName':name,'office':{},'factory':{}})
                item[role].setdefault(location,set()).add(address)
    updated=0; ambiguous=0
    for name_key,item in observed.items():
        profile=records.get(name_key) or {'legalName':item['legalName'],'status':'source_verified','sourceUrls':['https://dichvucong.dav.gov.vn/congbothuoc/index'],'introduction':'Đơn vị xuất hiện trong hồ sơ đăng ký thuốc DAV.'}
        for role in ('office','factory'):
            locations=item[role]
            if len(locations)==1:
                location,addresses=next(iter(locations.items()))
                # Web-refreshed address has a more recent verified provenance.
                if profile.get('status')!='web_verified' or not profile.get(role+'Province'):
                    profile[role+'Province']=location
                    profile[role+'Address']=sorted(addresses)[0]
                    profile[role+'Addresses']=sorted(addresses)[:8]
            elif len(locations)>1:
                ambiguous+=1
                profile[role+'Locations']=sorted(locations)
                if profile.get('status')!='web_verified': profile[role+'Province']=None
        profile['checkedAt']=datetime.now().isoformat()
        upsert(connection,profile);updated+=1
    connection.commit()
    profiles=mirror(connection)
    return {'publishedProfiles':updated,'ambiguousRoleLocations':ambiguous,'productionProfiles':len(profiles),'localProfiles':len(profiles)}

def verify_baseline(connection):
    """Retain local-only data; restrict analytics to the cloud identities."""
    import pymysql
    marker=ROOT/'data'/'analytics_production_baseline.json'
    if not marker.exists():raise ValueError('Pull must finish first')
    state=json.loads(marker.read_text(encoding='utf-8'))
    with sqlite3.connect(MSC_DB) as local:
        for kind,table in [('prices','msc_prices'),('tenders','msc_tenders')]:
            matched=local.execute('SELECT COUNT(*) FROM records r JOIN analytics_cloud_members m ON m.kind=r.kind AND m.id=r.source_id WHERE r.kind=?',(kind,)).fetchone()[0]
            if matched!=state['counts'][table]: raise ValueError('MSC production membership verification failed')
    with sqlite3.connect(VSS_DB,timeout=60) as local:
        local.execute('CREATE TABLE IF NOT EXISTS analytics_cloud_members(id TEXT PRIMARY KEY)')
        local.execute('DELETE FROM analytics_cloud_members')
        with connection.cursor(pymysql.cursors.SSCursor) as cursor:
            cursor.execute('SELECT fp_hash FROM vss_bids')
            while batch:=cursor.fetchmany(5000):local.executemany('INSERT OR IGNORE INTO analytics_cloud_members(id) VALUES (?)',batch)
        total=local.execute('SELECT COUNT(*) FROM analytics_cloud_members').fetchone()[0]
        if total!=state['counts']['vss_bids']:raise ValueError('VSS production changed since pull; repeat the pull')
        matched=local.execute("SELECT COUNT(*) FROM bids WHERE json_extract(raw,'$.fp_hash') IN (SELECT id FROM analytics_cloud_members)").fetchone()[0]
        if matched!=total:raise ValueError('VSS identity verification failed')
    with sqlite3.connect(DAV_DB,timeout=60) as local:
        local.execute('CREATE TABLE IF NOT EXISTS analytics_cloud_members(id TEXT PRIMARY KEY)')
        local.execute('DELETE FROM analytics_cloud_members')
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM dav_drugs')
            local.executemany('INSERT OR IGNORE INTO analytics_cloud_members(id) VALUES (?)',cursor.fetchall())
        dav_total=local.execute('SELECT COUNT(*) FROM analytics_cloud_members').fetchone()[0]
        if dav_total!=state['counts']['dav_drugs']:raise ValueError('DAV production changed since pull; repeat the pull')
        dav_matched=local.execute('SELECT COUNT(*) FROM drugs WHERE id IN (SELECT id FROM analytics_cloud_members)').fetchone()[0]
        if dav_total!=dav_matched:raise ValueError('DAV identity verification failed')
    state['identityVerifiedAt']=datetime.now().isoformat();state['canonicalVssRows']=matched;state['canonicalDavRows']=dav_matched
    temporary=marker.with_suffix('.tmp');temporary.write_text(json.dumps(state),encoding='utf-8');temporary.replace(marker)
    return {'canonicalVssRows':matched,'canonicalDavRows':dav_matched}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--publish-dav',action='store_true');parser.add_argument('--mirror',action='store_true');parser.add_argument('--verify-baseline',action='store_true');args=parser.parse_args()
    connection=connect(require_config())
    try:
        if args.verify_baseline:print(json.dumps(verify_baseline(connection)))
        elif args.publish_dav:
            with connection.cursor() as cursor: cursor.execute((ROOT/'tidb'/'010_company_profiles.sql').read_text(encoding='utf-8'))
            connection.commit();print(json.dumps(publish_dav(connection)))
        else: print(json.dumps({'mirroredProfiles':len(mirror(connection))}))
    finally: connection.close()
