import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from server import baoan_match
from server.match_report import build_rows, select_open


FAKE = ({
    "stems": ["paracetamol"],
    "form": "vien",
    "strength": {(500.0, "mg")},
    "card": {"brand": "ParaBA", "inn": "Paracetamol", "strength": "500mg", "form": "Viên nén", "reg": "VD-1"},
}, {
    "stems": ["paracetamol"],
    "form": "vien",
    "strength": {(500.0, "mg")},
    "card": {"brand": "ParaBA2", "inn": "Paracetamol", "strength": "500mg", "form": "Viên nén", "reg": "VD-2"},
})


def _lot(name, strength, form="Viên nén"):
    return {"lotName": name, "tenHoatChat": name, "nongDo": strength, "dangBaoChe": form, "duongDung": "Uống", "uom": "Viên", "pricePlan": 12000}


class MatchReportTest(unittest.TestCase):
    def setUp(self):
        self.catalog = patch.object(baoan_match, "catalog", return_value=FAKE)
        self.catalog.start()
        self.addCleanup(self.catalog.stop)

    def test_levels_and_one_row_per_hit(self):
        items = [{
            "baoan_match": "exact",
            "tender_no": "IB1",
            "name": "Gói A",
            "buyer": "BV A",
            "province": "Hà Nội",
            "close_date": "2026-10-02T08:00:00",
            "source_url": "https://muasamcong.mpi.gov.vn/goi/1",
            "scope_lots": [_lot("Paracetamol", "500mg"), _lot("Ceftriaxon", "1g", "Bột pha tiêm")],
        }, {
            "baoan_match": "near",
            "tender_no": "IB2",
            "name": "Gói B",
            "close_date": "2026-10-06T08:00:00",
            "source_url": "javascript:alert(1)",
            "scope_lots": [_lot("Paracetamol", "400mg")],
        }]
        exact = build_rows(items, "exact", lambda inn: 4 if inn == "Paracetamol" else None)
        near = build_rows(items, "near", lambda inn: 4)
        both = build_rows(items, "all", lambda inn: 4)
        self.assertEqual([row["brand"] for row in exact], ["ParaBA", "ParaBA2"])
        self.assertEqual(exact[0]["sdkDensity"], 4)
        self.assertEqual(exact[0]["price"], 12000)
        self.assertEqual(exact[0]["link"], "https://muasamcong.mpi.gov.vn/goi/1")
        self.assertEqual(exact[0]["innMt"], "Paracetamol")
        self.assertTrue(all(row["tenderNo"] == "IB2" for row in near))
        self.assertEqual(near[0]["link"], "")
        self.assertEqual([row["match"] for row in both], ["exact", "exact", "near", "near"])
        self.assertEqual([row["stt"] for row in both], [1, 2, 3, 4])

    def test_select_open_uses_the_card_window(self):
        now = datetime.now().replace(microsecond=0)
        items = [
            {"tender_no": "open", "baoan_match": "exact", "published": (now - timedelta(days=3)).isoformat(), "close_date": (now + timedelta(days=2)).isoformat(), "province": "Hà Nội", "scope_lots": [_lot("Paracetamol", "500mg")]},
            {"tender_no": "closed", "baoan_match": "exact", "published": (now - timedelta(days=3)).isoformat(), "close_date": (now - timedelta(days=1)).isoformat(), "scope_lots": [_lot("Paracetamol", "500mg")]},
            {"tender_no": "old", "baoan_match": "near", "published": (now - timedelta(days=500)).isoformat(), "close_date": (now + timedelta(days=4)).isoformat(), "scope_lots": [_lot("Paracetamol", "400mg")]},
            {"tender_no": "other", "baoan_match": "exact", "published": (now - timedelta(days=3)).isoformat(), "close_date": (now + timedelta(days=2)).isoformat(), "province": "Hà Nội", "scope_lots": [_lot("Ceftriaxon", "1g", "Bột pha tiêm")]},
        ]
        items.append(dict(items[0], name="Gói trùng"))
        chosen = select_open(items, {"province": "Hà Nội", "ingredient": "paracetamol", "metricMonths": 12}, now)
        self.assertEqual([item["tender_no"] for item in chosen], ["open"])


class DensityTest(unittest.TestCase):
    def test_counts_distinct_registration_per_ingredient(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "dav.sqlite3"
            con = sqlite3.connect(path)
            con.execute("CREATE TABLE drugs (raw TEXT)")
            rows = [
                {"soDangKy": "VD-1", "thongTinThuocCoBan": {"hoatChatChinh": "Paracetamol"}},
                {"soDangKy": "VD-2", "thongTinThuocCoBan": {"hoatChatChinh": "Paracetamol"}},
                {"soDangKy": "VD-1", "thongTinThuocCoBan": {"hoatChatChinh": "Paracetamol"}},
                {"soDangKy": "VD-3", "thongTinThuocCoBan": {"hoatChatChinh": "Ibuprofen"}},
            ]
            con.executemany("INSERT INTO drugs VALUES (?)", [(json.dumps(row),) for row in rows])
            con.commit()
            con.close()
            baoan_match._DENSITY.update(path=None, mtime=None, counts={})
            with patch.object(baoan_match, "DAV_DB", path):
                self.assertEqual(baoan_match.sdk_density("Paracetamol"), 2)
                self.assertEqual(baoan_match.sdk_density("Ibuprofen"), 1)
                self.assertIsNone(baoan_match.sdk_density(""))
            baoan_match._DENSITY.update(path=None, mtime=None, counts={})


if __name__ == "__main__":
    unittest.main()
