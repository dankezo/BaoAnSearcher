import unittest

from scripts.tidb.rows import build_msc_price_row, build_msc_tender_row


class TidbRowsTest(unittest.TestCase):
    def test_opening_date_stays_distinct_from_publication_and_closing(self):
        row = build_msc_tender_row({'published': '2026-08-01', 'open_date': '2026-09-01T08:00:00', 'close_date': '2026-09-02'}, 'source', None, None)
        self.assertEqual(row['open_date'], '2026-09-01')
        self.assertEqual(row['published'], '2026-08-01')
        self.assertEqual(row['close_date'], '2026-09-02')

    def test_msc_price_key_is_stable_for_duplicate_source_rows(self):
        payload = {
            "name": "Hasanlovas 20",
            "ingredient": "Lovastatin",
            "strength": "20mg",
            "registration": "893110397725",
            "unit_price": "3.150",
            "quantity": "236.400",
            "unit": "Viên",
            "route": "Uống",
            "dosage_form": "Viên nén",
            "group_name": "2",
            "manufacturer": "Hasan - Dermapharm",
            "country": "Việt Nam",
            "buyer": "Bệnh viện Đa khoa Hòa Bình",
            "province": "Tỉnh Phú Thọ",
            "tender_no": "IB2600065356",
            "published": "24/07/2026",
            "winner": "Công ty A",
        }
        first = build_msc_price_row(payload, "crawler-random-a", None, "2026-10-02")
        second = build_msc_price_row(payload, "crawler-random-b", None, "2026-10-02")
        self.assertEqual(first["source_id"], second["source_id"])

    def test_msc_price_key_keeps_a_real_price_change(self):
        payload = {"name": "A", "ingredient": "B", "unit_price": "100", "quantity": "1", "tender_no": "IB1"}
        changed = {**payload, "unit_price": "101"}
        self.assertNotEqual(
            build_msc_price_row(payload, "source-a", None, None)["source_id"],
            build_msc_price_row(changed, "source-b", None, None)["source_id"],
        )


if __name__ == "__main__":
    unittest.main()
