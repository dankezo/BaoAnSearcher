import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import dav


class DavGroupsTest(unittest.TestCase):
    def test_group_parser_does_not_infer_n3_from_n13(self):
        self.assertEqual(dav._tender_group('N13'), '')
        self.assertEqual(dav._tender_group('Nhóm 3'), '3')

    def test_generator_lookup_and_old_registration_filter(self):
        with tempfile.TemporaryDirectory() as directory:
            vss = Path(directory) / 'vss.sqlite3'
            drugs = Path(directory) / 'dav.sqlite3'
            with sqlite3.connect(vss) as con:
                con.execute('CREATE TABLE bids (sodk TEXT, nhomthau TEXT)')
                con.executemany('INSERT INTO bids VALUES (?, ?)', [('VD-OLD', 'N3'), ('VD-OLD', 'N4'), ('VD-OLD', 'N13')])
            con.close()
            with sqlite3.connect(drugs) as con:
                con.execute('CREATE TABLE drugs (id INTEGER, raw TEXT, search TEXT)')
                con.execute('INSERT INTO drugs VALUES (1, ?, ?)', (json.dumps({'id': 1, 'soDangKy': 'NEW', 'soDangKyCu': 'VD-OLD', 'tenThuoc': 'Drug'}), 'drug'))
            con.close()
            with patch.object(dav, 'VSS_DB', vss), patch.object(dav, 'DAV_DB', drugs):
                self.assertEqual(dav.vss_groups_for_registrations(value for value in ['VD-OLD']), {'vdold': {'3', '4'}})
                result = dav.search_drugs({'tenderGroup': ['Nhóm 3'], 'tags': None}, 0, 10)
                self.assertEqual(result['items'][0]['tenderGroup'], 'Nhóm 3, Nhóm 4')
                self.assertEqual(dav.search_drugs({'tenderGroup': ['Nhóm 1'], 'tags': None}, 0, 10)['items'], [])
