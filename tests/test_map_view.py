import unittest
from datetime import datetime
from unittest.mock import patch

from server import metric_slice
from server.map_view import (
    classify_package, keep_for_status, rank_ingredients, read_location, region_of, resolve_province, text_name,
)
from server.metric_slice import PROVINCES


class MapViewTest(unittest.TestCase):
    def test_regions_cover_every_province(self):
        for code, name in PROVINCES.items():
            self.assertTrue(region_of(code), name)
        self.assertEqual(region_of("15"), "Đông Bắc")
        self.assertEqual(region_of("06"), "Đông Bắc")
        self.assertEqual(region_of("33"), "Đồng bằng sông Hồng")
        self.assertEqual(region_of("75"), "Đông Nam Bộ")

    def test_province_name_beats_unrelated_msc_code(self):
        code, name = resolve_province("Tỉnh Bến Tre", "811")
        self.assertEqual(code, "83")
        self.assertEqual(name, "Bến Tre")
        code, name = resolve_province("TP. Hồ Chí Minh", "")
        self.assertEqual(code, "79")

    def test_location_reads_district_and_does_not_invent_a_point(self):
        loc = read_location([{
            "provCode": "811",
            "provName": "Tỉnh Bến Tre",
            "districtCode": "123",
            "districtName": "Huyện Mỏ Cày",
        }])
        self.assertEqual(loc["district"], "Huyện Mỏ Cày")
        self.assertEqual(loc["precision"], "province")
        self.assertNotIn("lat", loc)
        self.assertNotIn("lng", loc)

    def test_status_color_buckets(self):
        now = datetime(2026, 9, 29, 12)
        start = datetime(2026, 4, 1)
        self.assertEqual(classify_package("", "2026-10-01T00:00:00", now, start, ""), "open")
        self.assertEqual(classify_package("OPEN", "2026-10-01T00:00:00", now, start, ""), "open")
        self.assertEqual(classify_package("OPEN", "2026-08-01T00:00:00", now, start, ""), "open")
        for label in ("open", "OPEN", "Đang mời thầu", "đang lựa chọn nhà thầu"):
            self.assertTrue(keep_for_status("open", label), label)
        self.assertFalse(keep_for_status("review", "Đang mời thầu"))
        self.assertTrue(keep_for_status("open", ""))
        self.assertEqual(classify_package("DXT", "2026-08-01T00:00:00", now, start, ""), "review")
        self.assertEqual(classify_package("CNTTT", "2026-08-01T00:00:00", now, start, "Công ty A"), "closed")
        self.assertIsNone(classify_package("CNTTT", "2020-01-01T00:00:00", now, start, "Công ty A"))
        self.assertIsNone(classify_package("DHTBMT", "2026-08-01T00:00:00", now, start, ""))
        self.assertIsNone(classify_package("CNTTT", "2026-08-01T00:00:00", now, start, ""))
        self.assertEqual(text_name('["Công ty A", "Công ty B"]'), "Công ty A; Công ty B")
        self.assertEqual(text_name("Công ty C"), "Công ty C")

    def test_ingredient_rank_orders_by_value_then_keeps_quantity(self):
        ranked = rank_ingredients([
            ("Paracetamol", 10, 5),
            ("Amoxicillin", 30, 1),
            ("paracetamol", 5, 2),
            ("", 99, 99),
            ("Vitamin C", 20, 9),
        ])
        self.assertEqual([row["name"] for row in ranked], ["Amoxicillin", "Vitamin C", "Paracetamol"])
        self.assertEqual(ranked[2]["value"], 15)
        self.assertEqual(ranked[2]["quantity"], 7)

    def test_area_ingredients_follow_province_and_region(self):
        from server.map_view import area_ingredient_lists
        lists = area_ingredient_lists([
            ("01", "Paracetamol", 100, 2),
            ("01", "Amoxicillin", 40, 1),
            ("79", "Paracetamol", 10, 1),
        ])
        self.assertEqual(lists["national"][0]["name"], "Paracetamol")
        self.assertEqual(lists["areas"]["01"][0]["name"], "Paracetamol")
        self.assertEqual(lists["areas"]["79"][0]["value"], 10)
        self.assertTrue(lists["areas"]["Đồng bằng sông Hồng"])
        self.assertTrue(lists["areas"]["Đông Nam Bộ"])

    def test_price_strip_reports_yoy_groups_and_top_provinces(self):
        # Keep the fixture inside the current clock day.  A noon timestamp can
        # be in the future when this test runs in the morning and is rightly
        # excluded by the production time-window query.
        now = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        previous = now.replace(year=now.year - 1)
        rows = [
            {"ingredient": "Paracetamol", "province": "Hà Nội", "quantity": 10, "unit_price": 1000,
             "published": now.isoformat(), "group_name": "N1"},
            {"ingredient": "Paracetamol", "province": "Hà Nội", "quantity": 4, "unit_price": 1000,
             "published": previous.isoformat(), "group_name": "N1"},
            {"ingredient": "Paracetamol", "province": "Đà Nẵng", "quantity": 3, "unit_price": 1000,
             "published": now.isoformat(), "group_name": "N2"},
            {"ingredient": "Khác", "province": "Huế", "quantity": 99, "unit_price": 1000,
             "published": now.isoformat(), "group_name": "N5"},
        ]
        with patch.object(metric_slice, "_msc_rows", return_value=rows):
            payload = metric_slice._msc_prices({"ingredient": "paracetamol"}, 12)
        self.assertEqual(payload["revenue"], 13000)
        self.assertEqual(payload["prevRevenue"], 4000)
        self.assertAlmostEqual(payload["yoy"], 225.0)
        self.assertEqual(payload["groups"][0], 10000)
        self.assertEqual(payload["groups"][1], 3000)
        self.assertEqual([row["name"] for row in payload["topProvinces"][:2]], ["Hà Nội", "Đà Nẵng"])
        self.assertEqual(payload["topGrowth"][0]["name"], "Hà Nội")
        self.assertAlmostEqual(payload["topGrowth"][0]["growth"], 150.0)
        by_month = {row["key"]: row["revenue"] for row in payload["series"]}
        _months, current_now, current_from, _prev_from, _prev_end = metric_slice._window(12)
        self.assertEqual(payload["series"][0]["key"], current_from.strftime("%Y-%m"))
        self.assertEqual(payload["series"][-1]["key"], current_now.strftime("%Y-%m"))
        self.assertEqual(by_month[now.strftime("%Y-%m")], 13000)

    def test_msc_open_trend_counts_packages_opened_each_month(self):
        from server.map_view import _package_provinces, _rollup, msc_trend_label
        named = [{
            "code": "01",
            "name": "Hà Nội",
            "region": "Đồng bằng sông Hồng",
            "value": 999,
            "prev": 0,
            "yoy": None,
            "lots": 0,
            "facilities": 0,
            "activeMonths": 0,
            "trend": [{"key": "2026-08", "value": 5000}],
            "groups": [0, 0, 0, 0, 0],
        }, {
            "code": "79",
            "name": "Hồ Chí Minh",
            "region": "Đông Nam Bộ",
            "value": 1,
            "prev": 0,
            "yoy": None,
            "lots": 0,
            "facilities": 0,
            "activeMonths": 0,
            "trend": [],
            "groups": [0, 0, 0, 0, 0],
        }]
        keys = [f"2026-{month:02d}" for month in range(1, 13)]
        rows = _package_provinces(named, {
            "IB1": {"code": "01", "value": 1000, "buyer": "BV A", "published": "2026-08-03T08:00:00"},
            "IB2": {"code": "01", "value": 2500, "buyer": "BV B", "published": "2026-08-21"},
            "IB3": {"code": "01", "value": 400, "buyer": "BV A", "published": "2026-09-01"},
            "OLD": {"code": "01", "value": 80, "buyer": "BV C", "published": "2025-01-01"},
            "HCM": {"code": "79", "value": 9000, "buyer": "BV D", "published": "2026-09-02"},
        }, keys)
        self.assertEqual(len(rows[0]["trend"]), 12)
        trend = {point["key"]: point["value"] for point in rows[0]["trend"]}
        self.assertEqual(trend["2026-08"], 3500)
        self.assertEqual(trend["2026-09"], 400)
        self.assertEqual(trend["2026-01"], 0)
        self.assertNotEqual(trend["2026-08"], 2)
        self.assertEqual(rows[0]["value"], 3980)
        hcm = {point["key"]: point["value"] for point in rows[1]["trend"]}
        self.assertEqual(hcm["2026-09"], 9000)
        summary = _rollup(rows, keys, code="", name="Bộ lọc hiện tại", region="")
        rolled = {point["key"]: point["value"] for point in summary["trend"]}
        self.assertEqual(rolled["2026-08"], 3500)
        self.assertEqual(rolled["2026-09"], 9400)
        self.assertEqual(len(summary["trend"]), 12)
        self.assertEqual(msc_trend_label("open"), "Giá trị gói mỗi tháng")
        self.assertEqual(msc_trend_label("Đang mời thầu"), "Giá trị gói mỗi tháng")

    def test_ingredient_rows_only_exact_catalog_hits(self):
        from server import baoan_match
        fake = (
            {
                "stems": ["paracetamol"],
                "form": "vien nen",
                "route": "uong",
                "strength": baoan_match._strengths("500 mg"),
                "group": "",
                "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"},
            },
            {
                "stems": ["paracetamol"],
                "form": "vien nen",
                "route": "",
                "strength": baoan_match._strengths("80 mg"),
                "group": "",
                "card": {"brand": "Efferalgan", "strength": "80 mg", "form": "Viên sủi", "reg": "VD-222"},
            },
        )
        with patch.object(baoan_match, "catalog", return_value=fake):
            inn_only = rank_ingredients([("Paracetamol", 10, 1)])
            self.assertEqual(inn_only[0]["baoanHits"], [])
            lot = {"tenHoatChat": "Paracetamol", "nongDo": "500mg", "dangBaoChe": "Viên nén", "duongDung": "Uống"}
            exact = rank_ingredients([("Paracetamol", 10, 1, lot)])
        self.assertEqual(exact[0]["baoanHits"][0]["reg"], "VD-111")
        self.assertEqual(len(exact[0]["baoanHits"]), 1)

    def test_exact_package_keeps_catalog_matches_past_the_value_cap(self):
        from server import baoan_match
        fake = (
            {
                "stems": ["ofloxacin"],
                "form": "vien nen bao phim",
                "route": "",
                "strength": baoan_match._strengths("300 mg"),
                "group": "",
                "card": {"brand": "Oflozylkab", "strength": "300 mg", "form": "Viên nén bao phim", "reg": "VD-893"},
            },
        )
        oflo_lot = {"tenHoatChat": "Ofloxacin", "nongDo": "300 mg", "dangBaoChe": "Viên nén bao phim"}
        pairs = [(f"Line {index}", 100 - index, 1) for index in range(15)]
        pairs.append(("Ofloxacin", 1, 1, oflo_lot))
        pairs.append(("Vitamin Z", 0.5, 1))
        with patch.object(baoan_match, "catalog", return_value=fake):
            kept = rank_ingredients(pairs, 15, keep_matches=True)
            capped = rank_ingredients(pairs, 15)
        names = [row["name"] for row in kept]
        self.assertIn("Ofloxacin", names)
        self.assertNotIn("Vitamin Z", names)
        hit = next(row for row in kept if row["name"] == "Ofloxacin")
        self.assertEqual(hit["baoanHits"][0]["brand"], "Oflozylkab")
        self.assertEqual(hit["baoanHits"][0]["reg"], "VD-893")
        self.assertNotIn("Ofloxacin", [row["name"] for row in capped])

    def test_ingredient_rows_keep_near_catalog_hits_for_the_map(self):
        from server import baoan_match
        fake = ({
            "stems": ["paracetamol"],
            "form": "vien nen",
            "route": "uong",
            "strength": baoan_match._strengths("500 mg"),
            "group": "",
            "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"},
        },)
        lot = {"tenHoatChat": "Paracetamol", "nongDo": "400 mg", "dangBaoChe": "Viên nén", "duongDung": "Uống"}
        with patch.object(baoan_match, "catalog", return_value=fake):
            ranked = rank_ingredients([("Paracetamol", 10, 1, lot)])
        self.assertEqual(ranked[0]["match"], "near")
        self.assertEqual(ranked[0]["baoanHits"][0]["reg"], "VD-111")

    def test_scope_line_maps_to_full_ingredient_row(self):
        from server.map_view import _ingredient_from_scope_line
        row = {
            "name": "Paracetamol",
            "strength": "500 mg",
            "form": "Viên nén",
            "qty": 100,
            "price": 1200,
            "match": "exact",
            "hits": [{"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"}],
        }
        mapped = _ingredient_from_scope_line(row)
        self.assertEqual(mapped["name"], "Paracetamol")
        self.assertEqual(mapped["strength"], "500 mg")
        self.assertEqual(mapped["match"], "exact")
        self.assertEqual(mapped["value"], 120000)
        self.assertEqual(mapped["baoanHits"][0]["reg"], "VD-111")


if __name__ == "__main__":
    unittest.main()
