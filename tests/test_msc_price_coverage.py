import unittest
import json
import sqlite3
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from server.metric_slice import _shape_price_rows, _price_aggregates, slice_payload
from server import metric_slice

WINDOW = (12, datetime(2026, 10, 5), datetime(2025, 11, 1), datetime(2024, 11, 1), datetime(2025, 10, 5))

class PriceCoverageTest(unittest.TestCase):
    def test_price_cache_shares_concurrent_load_and_invalidates_wal_changes(self):
        started, finish = threading.Event(), threading.Event()
        def aggregate(*args):
            started.set()
            self.assertTrue(finish.wait(2))
            return []
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "msc.sqlite3"
            path.write_bytes(b"db")
            with patch.object(metric_slice, "MSC_DB", path), \
                 patch.dict(metric_slice._PRICE_CACHE, clear=True), \
                 patch.dict(metric_slice._PRICE_FLIGHTS, clear=True), \
                 patch.object(metric_slice, "_price_aggregates", side_effect=aggregate) as load:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    first = pool.submit(metric_slice._msc_prices, {}, 12)
                    self.assertTrue(started.wait(2))
                    second = pool.submit(metric_slice._msc_prices, {}, 12)
                    finish.set()
                    self.assertEqual(first.result(), second.result())
                load.assert_called_once()
                metric_slice._msc_prices({}, 12)
                load.assert_called_once()
                path.with_name(path.name + "-wal").write_bytes(b"new commit")
                metric_slice._msc_prices({}, 12)
                self.assertEqual(load.call_count, 2)
                self.assertEqual(metric_slice._PRICE_FLIGHTS, {})

    def test_failed_price_load_is_not_cached_and_can_retry(self):
        with patch.dict(metric_slice._PRICE_CACHE, clear=True), \
             patch.dict(metric_slice._PRICE_FLIGHTS, clear=True), \
             patch.object(metric_slice, "_price_aggregates", side_effect=[RuntimeError("locked"), []]) as load:
            with self.assertRaisesRegex(RuntimeError, "locked"):
                metric_slice._msc_prices({}, 12)
            metric_slice._msc_prices({}, 12)
            self.assertEqual(load.call_count, 2)
            self.assertEqual(metric_slice._PRICE_FLIGHTS, {})

    def test_unfiltered_dav_reuses_stored_cards_and_filtered_dav_still_searches(self):
        stored = {"section": "dav", "cards": [{"subtitle": "Toàn bộ danh mục"}]}
        with patch("server.stored_metrics.read_metrics", return_value=stored) as read, \
             patch("server.dav.search_drugs", return_value={"items": []}) as search, \
             patch("server.stored_metrics.summarize_dav", return_value={"cards": []}) as summarize:
            self.assertEqual(slice_payload({"section": "dav", "filters": {}}), stored)
            read.assert_called_once_with("dav")
            search.assert_not_called()
            self.assertEqual(stored["cards"][0]["subtitle"], "Theo bộ lọc hiện tại")
            slice_payload({"section": "dav", "filters": {"hoatChat": "Ambroxol"}})
            search.assert_called_once_with({"hoatChat": "Ambroxol"}, all_rows=True)
            summarize.assert_called_once_with([])

    def test_unfiltered_dav_computes_when_stored_metrics_missing(self):
        with patch("server.stored_metrics.read_metrics", return_value=None), \
             patch("server.dav.search_drugs", return_value={"items": []}) as search:
            self.assertEqual(slice_payload({"section": "dav"})["total"], 0)
            search.assert_called_once_with({}, all_rows=True)

    def test_sql_aggregate_retains_date_formats_source_scope_and_excel_deduplication(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "msc.sqlite3"
            con = sqlite3.connect(path)
            con.executescript("CREATE TABLE records(kind TEXT,source_id TEXT,normalized TEXT,search_text TEXT,collected_at TEXT);"
                              "CREATE TABLE excel_matches(excel_id TEXT PRIMARY KEY);"
                              "CREATE INDEX idx_registration ON records(kind,json_extract(normalized,'$.registration'));"
                              "CREATE INDEX idx_records_kind_cursor ON records(kind,coalesce(json_extract(normalized,'$.published'),json_extract(normalized,'$.close_date'),collected_at) DESC,source_id DESC);")
            for identity, published, source in [("iso", "2026-10-01T10:00:00", "API Mua sắm công"),
                                                ("locale", "02/10/2026", "API Mua sắm công"),
                                                ("excel", "2026-10-03", "API Mua sắm công"),
                                                ("other", "2026-10-04", "Excel"),
                                                ("older", "2026-09-30", "API Mua sắm công")]:
                row = dict(published=published, source_label=source, quantity="2,5", unit_price="1.200,5", unit="Viên")
                con.execute("INSERT INTO records VALUES('prices',?,?, '', '2026-10-09')", (identity, json.dumps(row)))
            con.execute("INSERT INTO excel_matches VALUES('excel')")
            con.commit()
            con.close()
            with patch("server.metric_slice.MSC_DB", path):
                rows = _price_aggregates({"metricMonths": 12}, datetime(2026, 10, 1), datetime(2026, 10, 9))
        self.assertEqual([row["published"] for row in rows], ["2026-10-01", "2026-10-02"])
        self.assertEqual(sum(row["cnt"] for row in rows), 2)
        self.assertEqual(sum(row["qty"] for row in rows), 5)
        self.assertEqual(sum(row["revenue"] for row in rows), 6002.5)

    def test_same_published_period_and_day_cutoff_as_cloud(self):
        rows = [dict(published='2026-10-01', qty=10, revenue=200, cnt=1, province='A', group_name='N1', unit='Viên'),
                dict(published='2025-10-01', qty=10, revenue=100, cnt=1, province='A', group_name='N1', unit='Viên'),
                dict(published='2025-10-10', qty=10, revenue=999, cnt=1, province='A', group_name='N1', unit='Viên')]
        result = _shape_price_rows(rows, WINDOW)
        self.assertEqual(result['coverage']['previousRecords'], 1)
        self.assertEqual(result['yoy'], 100)
        self.assertEqual(result['revenue'], 200)
        self.assertEqual(len(result['series']), 12)
        self.assertEqual(result['series'][0]['key'], '2025-11')
        self.assertEqual(result['series'][-1]['key'], '2026-10')
        self.assertEqual(result['groupViews']['1']['revenue'], 200)

    def test_units_and_unknown_groups_not_lost(self):
        rows = [dict(published='2026-10-01', qty=10, revenue=100, cnt=1, group_name='N1', unit='Viên', minPrice=10,maxPrice=10),
                dict(published='2026-10-01', qty=3, revenue=90, cnt=1, group_name='N1', unit='Ống', minPrice=30,maxPrice=30),
                dict(published='2026-10-01', qty=2, revenue=10, cnt=1, group_name='', unit='Viên', minPrice=5,maxPrice=5)]
        result = _shape_price_rows(rows, WINDOW)
        self.assertIsNone(result['yoy'])
        self.assertEqual(result['revenue'], 200)
        self.assertEqual(result['groupViews']['1']['revenue'], 190)
        self.assertEqual(len(result['series'][-1]['breakdown']), 3)

if __name__ == '__main__': unittest.main()
