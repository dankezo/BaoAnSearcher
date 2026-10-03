import unittest
from unittest.mock import patch

from server import baoan_match


class BaoanMatchTest(unittest.TestCase):
    def test_inn_only_is_not_exact(self):
        fake = (
            {
                "stems": ["paracetamol"],
                "form": "vien nen",
                "strength": baoan_match._strengths("500 mg"),
                "group": "",
                "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"},
            },
        )
        lot = {"tenHoatChat": "Paracetamol", "nongDo": "", "dangBaoChe": ""}
        with patch.object(baoan_match, "catalog", return_value=fake):
            level, hits = baoan_match.classify_lot(lot)
        self.assertNotEqual(level, "exact")
        self.assertEqual(baoan_match.exact_hits(lot), [])

    def test_full_line_exact(self):
        fake = (
            {
                "stems": ["paracetamol"],
                "form": "vien nen",
                "route": "uong",
                "strength": baoan_match._strengths("500 mg"),
                "group": "",
                "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"},
            },
        )
        lot = {"tenHoatChat": "Paracetamol", "nongDo": "500mg", "dangBaoChe": "Viên nén", "duongDung": "Uống"}
        with patch.object(baoan_match, "catalog", return_value=fake):
            level, hits = baoan_match.classify_lot(lot)
        self.assertEqual(level, "exact")
        self.assertEqual(hits[0]["brand"], "Hapacol")

    def test_appendix_i_form_compatibility_is_near_not_exact(self):
        fake = (
            {
                "stems": ["paracetamol"],
                "form": "vien nen bao phim",
                "strength": baoan_match._strengths("500 mg"),
                "group": "",
                "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén bao phim", "reg": "VD-111"},
            },
        )
        lot = {"tenHoatChat": "Paracetamol", "nongDo": "500mg", "dangBaoChe": "Viên"}
        with patch.object(baoan_match, "catalog", return_value=fake):
            level, _hits = baoan_match.classify_lot(lot)
        self.assertEqual(level, "near")
        self.assertFalse(baoan_match.exact_hits(lot))

    def test_ingredient_must_not_match_another_ingredient_as_a_substring(self):
        fake = ({
            "stems": ["ofloxacin"],
            "form": "vien nen",
            "route": "uong",
            "strength": baoan_match._strengths("200 mg"),
            "group": "",
            "card": {"brand": "Oflo", "strength": "200 mg", "form": "Viên nén", "reg": "VD-222"},
        },)
        lot = {"tenHoatChat": "Ciprofloxacin", "nongDo": "200 mg", "dangBaoChe": "Viên nén", "duongDung": "Uống"}
        with patch.object(baoan_match, "catalog", return_value=fake):
            level, hits = baoan_match.classify_lot(lot)
        self.assertIsNone(level)
        self.assertEqual(hits, [])

    def test_strength_normalizes_ratio_microgram_and_ui(self):
        self.assertEqual(baoan_match._strengths("500 mg / 5 ml"), {(100.0, "mg/ml")})
        self.assertEqual(baoan_match._strengths("500 mcg"), {(0.5, "mg")})
        self.assertEqual(baoan_match._strengths("100 UI"), {(100.0, "iu")})


if __name__ == "__main__":
    unittest.main()
