# -*- coding: utf-8 -*-
"""One-off: push today's collected MSC rows to Turso via @libsql/client (small batches)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.export_all_for_pages import MSC_PRICE_SLIM, MSC_TENDER_SLIM
from scripts.turso_mcp_batch_sql import insert_or_replace
from server import msc
from server.common import MSC_DB, fold, now_iso

OUT = ROOT / "data" / "_sync_tmp" / "tiny"
DAY = "2026-09-25%"
BATCH = 15


def emit(kind: str) -> list[Path]:
    keys = MSC_PRICE_SLIM if kind == "prices" else MSC_TENDER_SLIM
    table = "msc_prices" if kind == "prices" else "msc_tenders"
    cols = ("source_id", "search", *[k for k in keys if k != "source_id"], "updated_at")
    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob(f"{kind}_*.sql"):
        p.unlink()
    files: list[Path] = []
    core = msc._import_core()
    with core.connect(MSC_DB) as con:
        cur = con.execute(
            "SELECT source_id, normalized, collected_at, search_text "
            "FROM records WHERE kind=? AND collected_at LIKE ?",
            (kind, DAY),
        )
        batch: list[dict] = []
        i = 0
        while True:
            rows = cur.fetchmany(200)
            if not rows:
                break
            for sid0, norm, collected, search_text in rows:
                item = json.loads(norm)
                sid = str(sid0 or item.get("source_id") or item.get("tender_no") or "")
                if not sid and kind == "prices":
                    sid = fold(
                        f"{item.get('registration')}|{item.get('tender_no')}|"
                        f"{item.get('name')}|{item.get('unit_price')}|{collected}"
                    )[:120]
                if not sid:
                    continue
                row = {
                    "source_id": sid,
                    "search": search_text or fold(json.dumps(item, ensure_ascii=False)),
                    "updated_at": now_iso(),
                }
                for k in keys:
                    if k == "source_id":
                        continue
                    v = item.get(k)
                    if v is None or v == "":
                        continue
                    row[k] = v if not isinstance(v, (dict, list)) else json.dumps(v, ensure_ascii=False)
                batch.append(row)
                if len(batch) >= BATCH:
                    i += 1
                    path = OUT / f"{kind}_{i:03d}.sql"
                    path.write_text(insert_or_replace(table, cols, batch), encoding="utf-8")
                    files.append(path)
                    batch = []
        if batch:
            i += 1
            path = OUT / f"{kind}_{i:03d}.sql"
            path.write_text(insert_or_replace(table, cols, batch), encoding="utf-8")
            files.append(path)
    print(f"{kind}: {len(files)} files")
    return files


def push(files: list[Path]) -> None:
    if not files:
        return
    list_path = OUT / "filelist.txt"
    list_path.write_text("\n".join(str(p) for p in files), encoding="utf-8")
    node = r"""
import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{ const i=l.indexOf('='); return [l.slice(0,i), l.slice(i+1)] }))
const client = createClient({ url: env.TURSO_DATABASE_URL.trim(), authToken: env.TURSO_AUTH_TOKEN.trim() })
const files = readFileSync(process.argv[2],'utf8').split(/\r?\n/).filter(Boolean)
let n=0
for (const f of files) {
  const sql = readFileSync(f,'utf8')
  try {
    await client.execute(sql)
    n++
    if (n%5===0 || n===files.length) console.log(n+'/'+files.length)
  } catch (e) {
    console.error('FAIL', f, String(e).slice(0,200))
    process.exit(1)
  }
}
const now = new Date().toISOString()
await client.execute({
  sql: 'INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  args: ['msc', JSON.stringify({synced_at: now, note:'delta today'}), now],
})
const p = await client.execute('SELECT COUNT(*) AS n FROM msc_prices')
const t = await client.execute('SELECT COUNT(*) AS n FROM msc_tenders')
console.log('DONE prices', p.rows[0].n, 'tenders', t.rows[0].n)
"""
    script = OUT / "_push.mjs"
    script.write_text(node, encoding="utf-8")
    subprocess.check_call(
        ["node", str(script), str(list_path)],
        cwd=str(ROOT),
    )


def main() -> None:
    files = emit("prices") + emit("tenders")
    print("pushing", len(files), "tiny batches…")
    push(files)


if __name__ == "__main__":
    main()
