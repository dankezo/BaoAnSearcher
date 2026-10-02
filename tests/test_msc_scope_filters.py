import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from server import baoan_match, msc, msc_scope
from server.msc_filters import matches_quick


class TenderFiltersTest(unittest.TestCase):
    def test_new_and_closing_are_overlapping(self):
        now = datetime(2026, 9, 29, 12)
        row = {'published': (now - timedelta(hours=12)).isoformat(),
               'close_date': (now + timedelta(days=2)).isoformat()}
        for quick in ('open_all', 'new_72h', 'closing_7d'):
            self.assertTrue(matches_quick(row, {'metricQuick': quick}, now))
        self.assertFalse(matches_quick(row, {'metricQuick': 'reviewing'}, now))

    def test_same_lot_and_accent_insensitive(self):
        row = {'scope_lots': [
            {'lotName': 'Paracetamol', 'dangBaoChe': 'Viên nén'},
            {'lotName': 'Ceftriaxon', 'dangBaoChe': 'Bột pha tiêm'},
        ]}
        self.assertTrue(msc_scope.matches_scope(row, {'ingredient': 'paracetamol', 'dosage_form': 'vien nen'}))
        self.assertFalse(msc_scope.matches_scope(row, {'ingredient': 'paracetamol', 'dosage_form': 'tiêm'}))

    def test_lots_finder_reads_nested_list_and_ignores_empty_notice(self):
        self.assertEqual(msc_scope._lots_in({"body": {"bidNotification": {}}}), [])
        lots = [{"lotNo": "PP1", "lotName": "A"}]
        self.assertEqual(msc_scope._lots_in({"body": {"bidNotification": {"lotDTOList": lots}}}), lots)

    def test_empty_source_is_retryable_and_does_not_mean_no_match(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(msc_scope, 'DATA_DIR', Path(tempfile.gettempdir())):
            path = Path(folder) / 'msc.db'
            with patch.object(msc_scope, 'MSC_DB', path):
                con = msc_scope._connect()
                with patch.object(msc_scope, '_fetch_lots', return_value=[]):
                    with self.assertRaises(ValueError):
                        msc_scope._save_scope(con, 'test', 'IB1')
                self.assertEqual(con.execute('SELECT count(*) FROM scope_match').fetchone()[0], 0)
                con.close()

    def test_scope_cache_recomputes_a_stale_package_label_from_its_lots(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'msc.db'
            with patch.object(msc_scope, 'MSC_DB', path):
                con = msc_scope._connect()
                con.execute("INSERT INTO scope_match VALUES (?,?,?,?)", ('n1', 'IB1', 'exact', '2026-01-01'))
                con.execute("INSERT INTO scope_lots VALUES (?,?,?)", ('n1', json.dumps([{'lotName': 'Paracetamol'}]), '2026-01-01'))
                con.commit()
                con.close()
                with patch.object(msc_scope, 'match_lots', return_value='near'):
                    cache = msc_scope.load_cache()
        self.assertEqual(cache['id:n1'], 'near')
        self.assertEqual(cache['no:IB1'], 'near')

    def test_quick_filter_applies_before_pagination(self):
        now = datetime.now()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'msc.db'
            with msc._import_core().connect(path) as con:
                for i in range(6):
                    row = {'tender_no': str(i), 'published': (now - timedelta(days=i)).isoformat(),
                           'status_code': 'KQLCNT' if i < 4 else '', 'close_date': (now + timedelta(days=10)).isoformat()}
                    con.execute('INSERT INTO records (kind, source_id, tender_no, raw, normalized, collected_at, search_text) VALUES (?,?,?,?,?,?,?)', ('tenders', str(i), str(i), '{}', json.dumps(row), now.isoformat(), ''))
            with patch.object(msc, 'MSC_DB', path), patch.object(msc_scope, 'MSC_DB', path):
                result = msc.search('tenders', {'metricQuick': 'open_all'}, page=0, size=1)
                self.assertEqual(result['items'][0]['tender_no'], '4')
                self.assertTrue(result['hasMore'])
                result = msc.search('tenders', {'metricQuick': 'open_all'}, page=1, size=1)
                self.assertEqual(result['items'][0]['tender_no'], '5')
                self.assertFalse(result['hasMore'])

    def test_public_line_names_the_baoan_hit(self):
        fake = ({
            'stems': ['paracetamol'],
            'form': 'vien',
            'strength': {(500.0, 'mg')},
            'card': {'brand': 'ParaBA', 'inn': 'Paracetamol', 'strength': '500mg', 'form': 'Viên nén', 'reg': 'VD-1'},
        },)
        with patch.object(baoan_match, 'catalog', return_value=fake):
            rows = baoan_match.public_lines([
                {'medicineCode': 'G1', 'lotName': 'Paracetamol', 'nongDo': '500mg', 'dangBaoChe': 'Viên nén', 'quantity': 10},
                {'lotName': 'Ceftriaxon', 'dangBaoChe': 'Bột pha tiêm'},
            ])
            shown = msc_scope.present([{'baoan_match': 'exact', 'scope_lots': [{'lotName': 'Paracetamol', 'nongDo': '500mg', 'dangBaoChe': 'Viên nén'}]}])
        self.assertEqual(rows[0]['match'], 'exact')
        self.assertEqual(rows[0]['hits'][0]['brand'], 'ParaBA')
        self.assertEqual(rows[1]['match'], '')
        self.assertNotIn('scope_lots', shown[0])
        self.assertEqual(shown[0]['scope_lines'][0]['hits'][0]['brand'], 'ParaBA')

    def test_mcg_equals_mg_for_abbreviated_vitamin_combo(self):
        self.assertEqual(baoan_match._strengths('500mcg'), baoan_match._strengths('0,5mg'))
        self.assertEqual(baoan_match._strengths('500 µg'), {(0.5, 'mg')})
        self.assertNotEqual(baoan_match._strengths('500mg'), baoan_match._strengths('500mcg'))
        fake = ({
            'stems': ['vitamin b1', 'vitamin b12', 'vitamin b6'],
            'form': 'vien nang',
            'strength': {(110.0, 'mg'), (200.0, 'mg'), (0.5, 'mg')},
            'card': {
                'brand': 'B1B6B12 Ansba',
                'inn': 'Vitamin B1; Vitamin B6; Vitamin B12',
                'strength': '110mg; 0,5mg; 200mg',
                'form': 'Viên nang cứng',
                'reg': '893100137000',
            },
        },)
        lot = {
            'medicineCode': '2628KD441',
            'lotName': 'Vitamin B1 + B6 + B12',
            'nongDo': '110mg + 200mg + 500mcg',
            'dangBaoChe': 'Viên nang',
        }
        with patch.object(baoan_match, 'catalog', return_value=fake):
            level, hits = baoan_match.classify_lot(lot)
        self.assertEqual(level, 'exact')
        self.assertEqual(hits[0]['reg'], '893100137000')


if __name__ == '__main__':
    unittest.main()
