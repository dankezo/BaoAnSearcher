import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from scripts.tidb import pull_to_local as pull
from server import analytics, analytics_sqlite, dav, vss as vss_module


class KeepOpenConnection(sqlite3.Connection):
    """Let import helpers use closing() while tests inspect the memory DB."""

    def close(self):
        pass


def memory_db():
    return sqlite3.connect(":memory:", factory=KeepOpenConnection)


class AnalyticsLocalTest(unittest.TestCase):
    def test_indexed_date_candidates_preserve_exact_money_legacy_dates_and_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, PYTHONUTF8="1", ANALYTICS_DB_DIR=directory, ANALYTICS_PYTHON=sys.executable)
            subprocess.run([sys.executable, "-m", "tests.analytics_fixture", directory], check=True, env=env, capture_output=True)
            path = Path(directory) / "msc_prices.sqlite3"
            with closing(sqlite3.connect(path)) as con:
                con.execute("ALTER TABLE records ADD COLUMN collected_at TEXT")
                row = json.loads(con.execute("SELECT normalized FROM records WHERE source_id='0'").fetchone()[0])
                row["published"] = "28/02/2026"
                con.execute("UPDATE records SET normalized=? WHERE source_id='0'", (json.dumps(row),))
                row = json.loads(con.execute("SELECT normalized FROM records WHERE source_id='1'").fetchone()[0])
                row.update(_analyticsCanonical=True, _analyticsNumbers={"unit_price": "123.456", "quantity": "2.5"})
                con.execute("UPDATE records SET normalized=? WHERE source_id='1'", (json.dumps(row),))
                con.executescript("CREATE TABLE analytics_cloud_members(kind TEXT,id TEXT,PRIMARY KEY(kind,id));"
                                  "INSERT INTO analytics_cloud_members VALUES('prices','0'),('prices','1'),('prices','2');")
                con.commit()
            def run(body):
                result = subprocess.run(["node", "scripts/analytics_local.mjs"], input=json.dumps({"action": "overview", "body": body}),
                                        text=True, encoding="utf-8", capture_output=True, check=True, env=env, timeout=20)
                return json.loads(result.stdout)["sources"]["msc_prices"]["rows"]
            query = {"mode": "macro", "start": "2026-02-01", "end": "2026-03-31"}
            before, all_before = run(query), run({"mode": "macro", "months": "all"})
            with closing(sqlite3.connect(path)) as con:
                con.execute("CREATE INDEX idx_records_kind_cursor ON records(kind,coalesce(json_extract(normalized,'$.published'),json_extract(normalized,'$.close_date'),collected_at) DESC,source_id DESC)")
                con.execute("CREATE INDEX idx_records_kind_registration ON records(kind,json_extract(normalized,'$.registration'))")
                con.commit()
            self.assertEqual(before, run(query))
            self.assertEqual(all_before, run({"mode": "macro", "months": "all"}))
            summary = next(row for row in before if row["kind"] == "summary" and row["period"] == "current")
            self.assertEqual(Decimal(summary["amount"]), Decimal("609.390"))
            self.assertEqual(summary["count"], 2)

    def test_saved_analysis_does_not_recompute_overview(self):
        analytics.clear_cache()
        body = {"query": {"mode": "macro", "months": "all"}, "snapshot": {"version": 2, "generatedAt": "2026-03-31T10:00:00Z", "sources": {}}, "_news": []}
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps({"method": "rules", "evidence": []}), stderr="")
        with patch.object(analytics, "dataset_signature", return_value=["saved-test"]), patch.object(analytics.subprocess, "run", return_value=result) as run:
            analytics.compute("ai-insight", body)
            self.assertEqual(run.call_count, 1)
            payload = json.loads(run.call_args.kwargs["input"])
            self.assertNotIn("overview", payload)
            self.assertEqual(payload["body"]["snapshot"], body["snapshot"])
        analytics.clear_cache()

    def test_canonical_vietnamese_and_float_number_parsing(self):
        self.assertEqual(analytics_sqlite.decimal("1.234,56"), Decimal("1234.56"))
        self.assertEqual(analytics_sqlite.canonical_decimal("1234.56"), "1234.56")
        self.assertEqual(analytics_sqlite.canonical_decimal("123.456"), "123.456")
        self.assertNotEqual(analytics_sqlite.decimal("123.456"), Decimal("123.456"))
        self.assertEqual(analytics_sqlite.decimal(0.1), Decimal("0.1"))
        self.assertIsNone(analytics_sqlite.decimal(float("nan")))

    def test_sqlite_bridge_keeps_decimal_products_and_sums_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "msc.sqlite3"
            sqlite3.connect(db_path).close()
            with patch.object(analytics_sqlite, "MSC_DB", db_path):
                con = analytics_sqlite.open_db("msc_prices")
                try:
                    row = con.execute(
                        "SELECT DNUM(?), CNUM(?), CNUM(?), DNUM(?), "
                        "CMUL(CNUM(?), CNUM(?)), "
                        "SUM(CMUL(CNUM(price), CNUM(quantity))) "
                        "FROM (SELECT ? AS price, ? AS quantity UNION ALL "
                        "SELECT ? AS price, ? AS quantity)",
                        (
                            "1.234,56", "1234.56", "123.456", "123.456",
                            "123.456", "2.5", "123.456", "2.5", "123.456", "2.5",
                        ),
                    ).fetchone()
                finally:
                    con.close()
        self.assertEqual(row[0], "1234.56")
        self.assertEqual(row[1], "1234.56")
        self.assertEqual(row[2], "123.456")
        self.assertEqual(row[3], "123456")
        self.assertEqual(Decimal(row[4]), Decimal("308.640"))
        self.assertEqual(Decimal(row[5]), Decimal("617.280"))

    def test_dav_canonical_unknown_flags_require_verification(self):
        record = {
            "id": "cloud-1",
            "_cloudCanonical": True,
            "isActive": None,
            "soDangKy": "SDK-1",
            "tenThuoc": "Thuốc thử",
        }
        with patch.object(dav, "match_dm93", return_value="no"):
            flat = dav.flatten(record)
        self.assertIsNone(flat["isActive"])
        self.assertIsNone(flat["isDeleted"])
        self.assertIsNone(flat["isDaRut"])
        self.assertIsNone(flat["isHetHan"])
        self.assertEqual(flat["tagId"], dav.TAG_VANG)

    def test_pull_imports_are_idempotent_and_preserve_canonical_values_and_dav_flags(self):
        msc = memory_db()
        msc.executescript(
            "CREATE TABLE records (kind TEXT, source_id TEXT, tender_no TEXT, raw TEXT, "
            "normalized TEXT, search_text TEXT, collected_at TEXT, PRIMARY KEY(kind,source_id));"
            "CREATE TEMP TABLE cloud_price_alias (cloud_id TEXT PRIMARY KEY, source_id TEXT);"
        )
        price_row = {
            "source_id": "p1", "collected_at": "2026-10-08",
            "unit_price": Decimal("123.45670001"), "unit_price_raw": "123,456",
            "quantity": Decimal("2.34560001"), "quantity_raw": "2,345",
            "registration": "R1", "search": "medicine",
        }
        null_price_row = {
            "source_id": "p2", "collected_at": "2026-10-08",
            "unit_price": None, "unit_price_raw": "not parseable",
            "quantity": None, "quantity_raw": "not parseable", "search": "other",
        }
        locale_price_row = {
            "source_id": "p3", "collected_at": "2026-10-08",
            "unit_price": Decimal("123.456"), "quantity": Decimal("1.250"), "search": "third",
        }
        with patch.object(pull, "index_price", lambda *args: None):
            pull.import_msc("prices", [price_row, null_price_row, locale_price_row], msc)
            pull.import_msc("prices", [price_row, null_price_row, locale_price_row], msc)
            pull.import_msc("tenders", [{
                "source_id": "t1", "collected_at": "2026-10-08",
                "bid_price": Decimal("987654321.12345678"),
                "bid_price_raw": "source text", "search": "tender",
            }, {
                "source_id": "t2", "collected_at": "2026-10-08",
                "bid_price": Decimal("1.234"), "search": "second tender",
            }], msc)
        self.assertEqual(msc.execute("SELECT count(*) FROM records WHERE kind='prices'").fetchone()[0], 3)
        price = json.loads(msc.execute("SELECT raw FROM records WHERE source_id='p1'").fetchone()[0])
        null_price = json.loads(msc.execute("SELECT raw FROM records WHERE source_id='p2'").fetchone()[0])
        locale_price = json.loads(msc.execute("SELECT raw FROM records WHERE source_id='p3'").fetchone()[0])
        tender = json.loads(msc.execute("SELECT raw FROM records WHERE source_id='t1'").fetchone()[0])
        locale_tender = json.loads(msc.execute("SELECT raw FROM records WHERE source_id='t2'").fetchone()[0])
        self.assertEqual(price["unit_price"], "123,456")
        self.assertEqual(price["unit_price_raw"], "123,456")
        self.assertTrue(price["_analyticsCanonical"])
        self.assertEqual(price["_analyticsNumbers"]["unit_price"], "123.45670001")
        self.assertEqual(price["_analyticsNumbers"]["quantity"], "2.34560001")
        self.assertEqual(null_price["unit_price"], "not parseable")
        self.assertEqual(null_price["unit_price_raw"], "not parseable")
        self.assertIsNone(null_price["_analyticsNumbers"]["unit_price"])
        self.assertEqual(tender["bid_price"], "source text")
        self.assertEqual(tender["_analyticsNumbers"]["bid_price"], "987654321.12345678")
        self.assertEqual(locale_price["unit_price"], "123,4560")
        self.assertEqual(locale_price["_analyticsNumbers"]["quantity"], "1.250")
        self.assertEqual(locale_price["quantity"], "1,2500")
        self.assertEqual(locale_tender["bid_price"], "1,2340")
        self.assertEqual(locale_tender["_analyticsNumbers"]["bid_price"], "1.234")
        self.assertAlmostEqual(vss_module.parse_vn_number(locale_price["unit_price"]), 123.456)
        self.assertAlmostEqual(vss_module.parse_vn_number(locale_price["quantity"]), 1.25)

        vss = memory_db()
        vss_columns = (
            "fingerprint", "raw", "search", "sodk", "hoatchat", "ten", "loai",
            "nhomthau", "loai_thau", "ma_tinh", "nuocsx", "duongdung",
            "tungay_hd", "denngay_hd", "nam",
        )
        vss.execute(
            "CREATE TABLE bids (" + ",".join(f"{name} TEXT" for name in vss_columns)
            + ", PRIMARY KEY(fingerprint))"
        )
        with patch.object(pull.vss, "connect", return_value=vss):
            vss_row = {
                "fingerprint": "fp1", "gia": Decimal("12.345678901"), "gia_raw": "raw gia",
                "soluong": Decimal("3.000000001"), "soluong_raw": "raw qty",
                "thanhtien": Decimal("37.037036704"), "thanhtien_raw": "raw total", "sodk": "R1",
            }
            pull.import_vss([vss_row])
            pull.import_vss([vss_row])
        self.assertEqual(vss.execute("SELECT count(*) FROM bids").fetchone()[0], 1)
        vss_item = json.loads(vss.execute("SELECT raw FROM bids").fetchone()[0])
        self.assertEqual(vss_item["gia"], "raw gia")
        self.assertEqual(vss_item["gia_raw"], "raw gia")
        self.assertEqual(vss_item["thanhtien"], "raw total")
        self.assertEqual(vss_item["_analyticsNumbers"], {
            "gia": "12.345678901",
            "soluong": "3.000000001",
            "thanhtien": "37.037036704",
        })
        self.assertTrue(vss_item["_analyticsCanonical"])

        with patch.object(pull.vss, "connect", return_value=vss):
            pull.import_vss([{
                "fingerprint": "fp2", "gia": Decimal("123.456"),
                "soluong": Decimal("1.250"), "thanhtien": Decimal("154.32"),
            }])
        locale_item = json.loads(vss.execute("SELECT raw FROM bids WHERE fingerprint='fp2'").fetchone()[0])
        self.assertEqual(locale_item["gia"], "123,4560")
        self.assertEqual(locale_item["_analyticsNumbers"]["gia"], "123.456")

        dav_db = memory_db()
        dav_db.execute("CREATE TABLE drugs (id TEXT PRIMARY KEY, raw TEXT NOT NULL, search TEXT NOT NULL)")
        old_raw = {
            "id": "d1", "isActive": False, "isDeleted": True,
            "isDaRutSoDangKy": True, "isHetHan": True, "ghiChu": "source detail",
        }
        dav_db.execute("INSERT INTO drugs VALUES (?,?,?)", ("d1", json.dumps(old_raw), "old"))
        with patch.object(dav, "connect", return_value=dav_db):
            dav_row = {
                "id": "d1", "so_dang_ky": "R1", "ten_thuoc": "Thuốc",
                "hoat_chat": "Hoạt chất", "drug_group": "Nhóm thuốc", "search": "thuoc",
            }
            pull.import_dav([dav_row])
            pull.import_dav([dav_row])
        self.assertEqual(dav_db.execute("SELECT count(*) FROM drugs").fetchone()[0], 1)
        imported = json.loads(dav_db.execute("SELECT raw FROM drugs WHERE id='d1'").fetchone()[0])
        self.assertFalse(imported["isActive"])
        self.assertTrue(imported["isDeleted"])
        self.assertTrue(imported["isDaRutSoDangKy"])
        self.assertTrue(imported["isHetHan"])
        self.assertEqual(imported["ghiChu"], "source detail")
        self.assertEqual(imported["thongTinThuocCoBan"]["nhomThuoc"], "Nhóm thuốc")

    def test_dataset_signature_tracks_database_and_wal_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / name for name in ("dav.sqlite3", "msc.sqlite3", "vss.sqlite3")]
            for path in paths:
                path.write_bytes(b"db")
            with patch.multiple(analytics, DAV_DB=paths[0], MSC_DB=paths[1], VSS_DB=paths[2]):
                before = analytics.dataset_signature()
                paths[1].write_bytes(b"changed database size")
                after_db = analytics.dataset_signature()
                self.assertNotEqual(before, after_db)
                paths[1].with_name(paths[1].name + "-wal").write_bytes(b"committed wal bytes")
                after_wal = analytics.dataset_signature()
                self.assertNotEqual(after_db, after_wal)


if __name__ == "__main__":
    unittest.main()
