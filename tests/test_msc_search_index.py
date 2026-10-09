import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from server import map_view, msc


class MscSearchIndexTest(unittest.TestCase):
    def test_native_fts_stays_in_parity_through_insert_update_and_delete(self):
        core = msc._import_core()
        with tempfile.TemporaryDirectory() as folder:
            db = Path(folder) / "procurement.sqlite3"
            with core.connect(db) as con:
                accepted, skipped = core.save_records(con, "tenders", [{
                    "id": "source-1", "isMedicine": 1,
                    "bidName": "Cung cấp Paracetamol 500mg",
                    "notifyNo": "IB-2026-01", "publicDate": "2026-05-01",
                }])
                self.assertEqual((accepted, skipped), (1, 0))

                def find(term):
                    clauses, args = msc.search_where("tenders", {"q": term}, indexed=True)
                    return [row[0] for row in con.execute(
                        "SELECT source_id FROM records WHERE " + " AND ".join(clauses), args
                    )]

                self.assertEqual(find("Paracetamol"), ["source-1"])
                self.assertEqual(find("Ibuprofen"), [])

                accepted, _ = core.save_records(con, "tenders", [{
                    "id": "source-1", "isMedicine": 1,
                    "bidName": "Cung cấp Ibuprofen 200mg",
                    "notifyNo": "IB-2026-01", "publicDate": "2026-05-01",
                }])
                self.assertEqual(accepted, 1)
                self.assertEqual(find("Paracetamol"), [])
                self.assertEqual(find("Ibuprofen"), ["source-1"])

                con.execute("DELETE FROM records WHERE kind='tenders' AND source_id='source-1'")
                self.assertEqual(find("Ibuprofen"), [])

    def test_vss_map_where_contains_applied_table_filter_fields(self):
        start = datetime(2025, 11, 1)
        end = datetime(2026, 10, 5)
        where, args = map_view._vss_where({
            "hoatchat": "Paracetamol", "sodk": "VD-123", "ten": "Hapacol",
            "nhasx": ["Nhà máy A", "Nhà máy B"], "ma_cskcb": "01001",
            "ten_cskcb": "Bệnh viện", "tennhathau": "Nhà thầu", "loai": "Tân dược",
            "loai_thau": "Tập trung", "duongdung": "Uống", "nuocsx": "Việt Nam",
            "hamluong": "500mg", "donvitinh": "Viên", "tuNgay": "2025-12-01",
            "denNgay": "2026-09-30", "nam": [2025, 2026],
        }, start, end)
        for field in ("sodk", "ten", "nhasx", "ma_cskcb", "ten_cskcb", "tennhathau", "loai", "loai_thau", "duongdung", "nuocsx", "hamluong", "donvitinh"):
            self.assertIn(field, where)
        self.assertIn("tungay_hd >= ?", where)
        self.assertIn("coalesce(denngay_hd,'') <= ?", where)
        self.assertIn("json_extract(raw,'$.congbo')", where)
        self.assertIn("%nha may a%", args)
        self.assertIn("%nha may b%", args)
        self.assertIn("2025-12-01", args)
        self.assertIn("2026-09-30 23:59:59", args)


if __name__ == "__main__":
    unittest.main()
