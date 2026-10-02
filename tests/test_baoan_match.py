import unittest
from unittest.mock import patch

from server import baoan_match


class BaoanMatchTest(unittest.TestCase):
    def test_inn_only_is_not_exact(self):
        fake = (
            {
                "stems": ["paracetamol"],
                "form": "vien",
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
                "form": "vien",
                "strength": baoan_match._strengths("500 mg"),
                "group": "",
                "card": {"brand": "Hapacol", "strength": "500 mg", "form": "Viên nén", "reg": "VD-111"},
            },
        )
        lot = {"tenHoatChat": "Paracetamol", "nongDo": "500mg", "dangBaoChe": "Viên nén"}
        with patch.object(baoan_match, "catalog", return_value=fake):
            level, hits = baoan_match.classify_lot(lot)
        self.assertEqual(level, "exact")
        self.assertEqual(hits[0]["brand"], "Hapacol")


if __name__ == "__main__":
    unittest.main()
