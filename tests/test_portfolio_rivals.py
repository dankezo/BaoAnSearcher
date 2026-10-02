import json
import unittest

from server.portfolio import (
    _cell_key,
    _competitor_entries,
    _is_bao_an,
    _remember_cell_sdk,
    _year_label,
    status_color,
)
from server.portfolio_bids import enrich
from server.portfolio_store import _dav_from_raw


def _row(**kwargs):
    base = {
        "so_dang_ky": "",
        "ten_thuoc": "",
        "hoat_chat": "Paracetamol",
        "ham_luong": "500 mg",
        "dang_bao_che": "Viên nén",
        "cty_san_xuat": "",
        "cty_dang_ky": "",
        "so_quyet_dinh": "",
        "ngay_cap": "",
        "ngay_het_han": "",
    }
    base.update(kwargs)
    return base


class PortfolioRivalTest(unittest.TestCase):
    def test_bao_an_is_not_a_rival_and_dav_fields_stay_on_the_other_sdk(self):
        cells = {}
        samples = [
            _row(so_dang_ky="VD-OWN", ten_thuoc="Mine", cty_san_xuat="Plant A", cty_dang_ky="Công ty Bảo An",
                 so_quyet_dinh="1/QĐ", ngay_cap="2020-01-01", ngay_het_han="2025-01-01"),
            _row(so_dang_ky="VD-SIB", ten_thuoc="Sibling", cty_san_xuat="Overseas", cty_dang_ky="Other"),
            _row(so_dang_ky="VD-NAME", ten_thuoc="Named", cty_san_xuat="Cty TNHH Dược Bảo An", cty_dang_ky="Foreign"),
            _row(so_dang_ky="VD-RIVAL", ten_thuoc="Rival Brand", ham_luong="500mg", dang_bao_che="vien nen",
                 cty_san_xuat="Other Plant", cty_dang_ky="Registrar Co", so_quyet_dinh="99/QĐ-QLD",
                 ngay_cap="15/03/2024", ngay_het_han="2029-03-15"),
            _row(so_dang_ky="VD-BLANK", ten_thuoc="No Dates", cty_san_xuat="Plain Co", cty_dang_ky="Plain DK",
                 ngay_cap="", ngay_het_han="not-a-date"),
        ]
        key = None
        for sample in samples:
            key = _cell_key(sample["hoat_chat"], sample["ham_luong"], sample["dang_bao_che"])
            _remember_cell_sdk(cells, key, sample)
        self.assertEqual(len(cells[key]), 5)
        catalog = {"vdown", "vdsib"}
        entries = _competitor_entries(cells[key], "VD-OWN", catalog)
        regs = [item["regNumber"] for item in entries]
        self.assertEqual(regs, ["VD-BLANK", "VD-RIVAL"])
        self.assertTrue(all("own" not in item for item in entries))
        rival = next(item for item in entries if item["regNumber"] == "VD-RIVAL")
        self.assertEqual(rival["strength"], "500mg")
        self.assertEqual(rival["dosageForm"], "vien nen")
        self.assertEqual(rival["ctyDangKy"], "Registrar Co")
        self.assertEqual(rival["soQuyetDinh"], "99/QĐ-QLD")
        self.assertEqual(rival["grantYear"], "2024")
        self.assertEqual(rival["expDate"], "2029-03-15")
        blank = next(item for item in entries if item["regNumber"] == "VD-BLANK")
        self.assertEqual(blank["grantYear"], "")
        self.assertEqual(blank["expDate"], "")
        self.assertEqual(len(entries), 2)
        self.assertEqual(status_color(len(entries)), "GREEN")
        self.assertLessEqual(len(entries), 2)
        self.assertTrue(_is_bao_an("Công ty cổ phần Dược phẩm Bảo An"))

    def test_enrich_keeps_each_rivals_strength_and_form(self):
        row = {
            "regNumber": "VD-1",
            "inn": "Paracetamol",
            "strength": "500mg",
            "dosageForm": "Viên nén",
            "competitors": [
                {"regNumber": "VD-2", "inn": "", "strength": "650 mg", "dosageForm": "Viên sủi"},
                {"regNumber": "VD-3", "inn": "Ibuprofen", "strength": "200 mg", "dosageForm": "Viên nang"},
            ],
        }
        enrich(row, {})
        first, second = row["competitors"]
        self.assertEqual(first["inn"], "Paracetamol")
        self.assertEqual(first["strength"], "650 mg")
        self.assertEqual(first["dosageForm"], "Viên sủi")
        self.assertEqual(second["inn"], "Ibuprofen")
        self.assertEqual(second["strength"], "200 mg")
        self.assertEqual(second["dosageForm"], "Viên nang")
        self.assertEqual(row["strength"], "500mg")

    def test_dav_projection_keeps_decision_dates_and_registrant(self):
        raw = json.dumps({
            "soDangKy": "VD-9",
            "tenThuoc": "Test",
            "isActive": True,
            "thongTinThuocCoBan": {"hoatChatChinh": "Paracetamol", "hamLuong": "500mg", "dangBaoChe": "Viên nén"},
            "thongTinDangKyThuoc": {
                "soQuyetDinh": "12/QĐ-QLD",
                "ngayCapSoDangKy": "2024-06-01T00:00:00+07:00",
                "ngayHetHanSoDangKy": "2029-06-01T00:00:00+07:00",
            },
            "congTySanXuat": {"tenCongTySanXuat": "Maker"},
            "congTyDangKy": {"tenCongTyDangKy": "Registrar Co"},
        })
        item = _dav_from_raw(raw)
        self.assertEqual(item["ham_luong"], "500mg")
        self.assertEqual(item["dang_bao_che"], "Viên nén")
        self.assertEqual(item["so_quyet_dinh"], "12/QĐ-QLD")
        self.assertEqual(item["ngay_cap"], "2024-06-01T00:00:00+07:00")
        self.assertEqual(item["ngay_het_han"], "2029-06-01T00:00:00+07:00")
        self.assertEqual(item["cty_dang_ky"], "Registrar Co")
        self.assertEqual(_year_label(item["ngay_cap"]), "2024")
        self.assertEqual(_year_label(""), "")
        self.assertEqual(_year_label("not-a-date"), "")


if __name__ == "__main__":
    unittest.main()
