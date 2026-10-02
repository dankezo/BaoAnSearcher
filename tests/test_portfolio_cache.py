# -*- coding: utf-8 -*-
"""Portfolio cache must survive WAL touches and serve award history without a second scan."""
import json
import time
import unittest
from unittest.mock import patch

from server import portfolio
from server.dav import search_drugs


class PortfolioCacheTest(unittest.TestCase):
    def setUp(self):
        portfolio._CACHE["stamp"] = None
        portfolio._CACHE["payload"] = None

    def test_stamp_ignores_wal_sidecars(self):
        self.assertNotIn("wal", repr(portfolio._stamp()).lower())

    def test_history_and_row_reuse_one_assemble(self):
        calls = {"n": 0}
        real = portfolio._assemble

        def counting():
            calls["n"] += 1
            return real()

        with patch.object(portfolio, "_assemble", counting):
            full = portfolio.build_portfolio()
            row = next(item for item in full["rows"] if item.get("regNumber"))
            started = time.perf_counter()
            selected = portfolio.build_portfolio(row["id"])
            history = portfolio.build_portfolio(row["id"], row["regNumber"])
            again = portfolio.build_portfolio(row["id"], row["regNumber"])
            elapsed = time.perf_counter() - started

        self.assertEqual(calls["n"], 1)
        self.assertIn("provinces", selected)
        self.assertIn("facilities", selected)
        self.assertEqual(history["productId"], row["id"])
        self.assertEqual(history["registration"], row["regNumber"])
        self.assertIsInstance(history["items"], list)
        self.assertEqual(again["items"], history["items"])
        self.assertLess(elapsed, 0.75)
        detail = full["details"][row["id"]]
        self.assertEqual(detail["histories"][row["regNumber"]], history["items"])
        self.assertLess(len(json.dumps(full["details"], ensure_ascii=False)), 8_000_000)


class DavBrowseTest(unittest.TestCase):
    def test_unfiltered_first_page_does_not_sort_json_dates(self):
        started = time.perf_counter()
        page = search_drugs({}, page=0, size=50)
        elapsed = time.perf_counter() - started
        self.assertEqual(page["page"], 0)
        self.assertEqual(len(page["items"]), 50)
        self.assertGreater(page["total"], 1000)
        self.assertLess(elapsed, 1.5)


if __name__ == "__main__":
    unittest.main()
