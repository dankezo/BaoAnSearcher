# -*- coding: utf-8 -*-
"""P6: dirty values, upsert SQL, schema split, resume cursor. No cluster."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "tidb"))

import checkpoint
import rows
import schema_sql
from schema_sql import SCHEMA_FILES


class DirtyValueTests(unittest.TestCase):
    def test_self_check(self):
        self.assertEqual(rows.self_check(), [])

    def test_vietnamese_thousands_and_overflow(self):
        row = rows.build_vss_row({
            "fingerprint": "fp",
            "raw": {"gia": "1.234", "thanhtien": "99999999999999", "soluong": "380.000"},
        })
        self.assertEqual(row["gia"], "1234.00")
        self.assertIsNone(row["thanhtien"])
        self.assertEqual(row["thanhtien_raw"], "99999999999999")
        self.assertEqual(row["soluong"], "380000.000")

    def test_fold_matches_search_contract(self):
        from server.common import fold
        self.assertEqual(fold("Amoxicillin"), "amoxicillin")
        self.assertEqual(fold("Cefuroxim"), "cefuroxim")
        self.assertEqual(fold("Thành phố Hồ Chí Minh"), "thanh pho ho chi minh")


class UpsertTests(unittest.TestCase):
    def test_batch_and_duplicate_update(self):
        self.assertEqual(rows.BATCH, 1000)
        sql = rows.upsert_sql("suggest_values", rows.SUGGEST_COLUMNS, 1)
        self.assertIn("ON DUPLICATE KEY UPDATE", sql)
        self.assertIn("cnt=VALUES(cnt)", sql)
        self.assertNotIn("section=VALUES(section)", sql)
        self.assertNotIn("OFFSET", sql)
        self.assertEqual(sql.count("%s"), len(rows.SUGGEST_COLUMNS))

    def test_rollup_blank_dimension_stays_empty_string(self):
        row = rows.build_rollup_row({"loai": None, "nam": None, "ym": None, "ma_tinh": None, "nhomthau": None, "sum_thanhtien": "10", "cnt": 2})
        self.assertEqual(row["loai"], "")
        self.assertEqual(row["nam"], 0)
        self.assertEqual(row["ym"], "")
        self.assertEqual(row["sum_thanhtien"], "10.00")


class SchemaTests(unittest.TestCase):
    def test_split_keeps_prepare_blocks(self):
        statements = schema_sql.load_statements()
        names = [name for name, _statement in statements]
        self.assertEqual(names[0], "001_search_schema.sql")
        self.assertIn("002_perf_schema.sql", names)
        joined = "\n".join(statement for _name, statement in statements)
        self.assertIn("CREATE TABLE IF NOT EXISTS vss_bids", joined)
        self.assertIn("CREATE TABLE IF NOT EXISTS agg_vss_monthly", joined)
        self.assertIn("CREATE TABLE IF NOT EXISTS agg_msc_price_monthly", joined)
        # 002 enables all fact tables and 003 reasserts the MSC replica after
        # its generated lookup columns are added.
        self.assertEqual(joined.count("SET TIFLASH REPLICA 1"), 5)
        creates = [statement for _name, statement in statements if statement.startswith("CREATE TABLE IF NOT EXISTS vss_bids")]
        self.assertEqual(len(creates), 1)
        for _name, statement in statements:
            self.assertNotIn(";", statement)

    def test_schema_files_exist(self):
        for path in SCHEMA_FILES:
            self.assertTrue(path.exists(), path)


class CheckpointTests(unittest.TestCase):
    def test_stamp_change_resets_cursor(self):
        state = {"vss_bids": {"stamp": {"size": 1, "mtime_ns": 1}, "last_id": 50, "sent": 50}}
        same = checkpoint.resume_cursor(state, "vss_bids", {"size": 1, "mtime_ns": 1})
        self.assertEqual(same["last_id"], 50)
        changed = checkpoint.resume_cursor(state, "vss_bids", {"size": 2, "mtime_ns": 1})
        self.assertNotIn("last_id", changed)
        self.assertEqual(changed["sent"], 0)

    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".tidb_sync_state.json"
            checkpoint.save_state({"vss_bids": {"last_id": 3, "sent": 3}}, path)
            loaded = checkpoint.load_state(path)
            self.assertEqual(loaded["vss_bids"]["last_id"], 3)
            self.assertTrue(path.exists())


class DryRunTests(unittest.TestCase):
    def test_apply_describe_does_not_need_a_driver(self):
        described = schema_sql.load_statements()
        self.assertGreater(len(described), 10)

    def test_suggest_row_clips(self):
        row = rows.build_suggest_row({"section": "vss", "field": "hoatchat", "value": "Ticarcillin", "cnt": 105})
        self.assertEqual(row["value"], "Ticarcillin")
        self.assertIsNone(rows.build_suggest_row({"section": "vss", "field": "hoatchat", "value": ""}))


if __name__ == "__main__":
    unittest.main()
