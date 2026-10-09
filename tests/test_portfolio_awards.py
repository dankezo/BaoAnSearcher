import unittest
from unittest.mock import patch
from server import portfolio
from server.portfolio_bids import index_awards, enrich, compare_price, summarize


class PortfolioAwardsTest(unittest.TestCase):
    def bid(self, **overrides):
        return dict(registration='VD-12345-20', name='Thuốc A', ingredient='Paracetamol',
                    strength='500mg', dosage_form='Viên nén', group_name='Nhóm 4', unit='Viên',
                    quantity=100, unit_price=1000, decision_date='2026-09-01', manufacturer='Công ty A',
                    tender_no='IB260001', **overrides)

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_old_registration_and_combined_registration_match_without_double_count(self, _):
        bid = self.bid(); bid['registration'] = 'VD-12345-20; 893100123456'
        index = index_awards([bid, bid], [], [{'so_dang_ky':'893100123456','so_dang_ky_cu':'VD-12345-20'}])
        self.assertEqual(len(index['893100123456']), 1)
        self.assertEqual(len(index['vd1234520']), 1)

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_different_groups_stay_separate_and_exact_copies_collapse(self, _):
        first, second, copy = self.bid(), self.bid(), self.bid()
        first['group_name'] = 'N4'
        second['group_name'] = 'N5'
        copy['group_name'] = 'N4'
        history = index_awards([first, second, copy], [])['vd1234520']
        self.assertEqual(sorted(item['group'] for item in history), ['N4', 'N5'])
        self.assertEqual(summarize(history)['totalQuantity'], 200)

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_latest_exact_registration_not_lowest_other_strength(self, _):
        first = self.bid(); last = {**first, 'unit_price':1200, 'decision_date':'2026-09-02'}
        foreign = {**first, 'registration':'VD-99999-20', 'unit_price':10}
        row = {'regNumber':'VD-12345-20','inn':'Paracetamol','strength':'500mg','dosageForm':'Viên nén','competitors':[]}
        enrich(row, index_awards([first,last,foreign], []))
        self.assertEqual(row['mscPrice'],1200)
        self.assertEqual(row['totalQuantity'],200)

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_quantity_does_not_add_vss_to_msc(self, _):
        index = index_awards([self.bid()], [{'sodk':'VD-12345-20','gia':1000,'soluong':100,'donvitinh':'Viên','tungay_hd':'2026-09-01'}])
        result = summarize(index['vd1234520'])
        self.assertEqual(result['totalQuantity'],100)
        self.assertEqual(result['quantitySource'],'MSC')

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_price_delta_and_incomparable_group(self, _):
        a = summarize(index_awards([self.bid()], [])['vd1234520'])
        b = {**a, 'latestAward': {**a['latestAward'], 'price': 1100}}
        self.assertAlmostEqual(compare_price(a,b)[0],10)
        b['latestAward']['group']='Nhóm 3'
        self.assertIsNone(compare_price(a,b)[0])

    @patch('server.portfolio_bids.tender_links', return_value={})
    def test_assemble_loads_exact_dav_cell_rival_awards_without_market_scan(self, _):
        catalog = [{
            'id': 1, 'brand_name': 'Bao An Paracetamol', 'reg_number': 'BA-111-20',
            'inn': 'Paracetamol', 'strength': '500mg', 'dosage_form': 'Viên nén',
            'manufacturer': 'Bao An Pharma',
        }]
        dav = [{
            'so_dang_ky': 'BA-111-20', 'so_dang_ky_cu': '', 'ten_thuoc': 'Bao An Paracetamol',
            'hoat_chat': 'Paracetamol', 'ham_luong': '500mg', 'dang_bao_che': 'Viên nén',
            'cty_san_xuat': 'Bao An Pharma', 'cty_dang_ky': 'Bao An Pharma',
            'con_hieu_luc': 1, 'ngay_het_han': '', 'ngay_cap': '',
        }]
        cell_rows = [
            {**dav[0]},
            {
                'so_dang_ky': 'VD-222-20', 'ten_thuoc': 'Competitor Para', 'hoat_chat': 'Paracetamol',
                'ham_luong': '500mg', 'dang_bao_che': 'Viên nén', 'cty_san_xuat': 'Acme Pharma',
                'cty_dang_ky': 'Acme Pharma', 'con_hieu_luc': 1, 'ngay_het_han': '', 'ngay_cap': '',
            },
        ]
        award_rows = [
            {'registration': 'BA-111-20', 'name': 'Bao An Paracetamol', 'ingredient': 'Paracetamol', 'strength': '500mg', 'dosage_form': 'Viên nén', 'group_name': 'Nhóm 4', 'unit': 'Viên', 'quantity': 100, 'unit_price': 1000, 'decision_date': '2026-08-01', 'manufacturer': 'Bao An Pharma', 'tender_no': 'IB260001'},
            {'registration': 'VD-222-20', 'name': 'Competitor Para', 'ingredient': 'Paracetamol', 'strength': '500mg', 'dosage_form': 'Viên nén', 'group_name': 'Nhóm 4', 'unit': 'Viên', 'quantity': 100, 'unit_price': 800, 'decision_date': '2026-09-01', 'manufacturer': 'Acme Pharma', 'tender_no': 'IB260002'},
        ]

        with patch.object(portfolio, 'load_catalog', return_value=catalog), \
             patch.object(portfolio, 'dav_by_registration', return_value=dav), \
             patch.object(portfolio, 'dav_cell_candidates', return_value=cell_rows), \
             patch.object(portfolio, 'vss_candidates', return_value=[]) as vss_lookup, \
             patch.object(portfolio, 'msc_candidates', side_effect=lambda _tokens, regs: [r for r in award_rows if r['registration'] in regs]) as msc_lookup:
            rows, heatmaps = portfolio._assemble()

        queried = set(msc_lookup.call_args.args[1])
        self.assertIn('BA-111-20', queried)
        self.assertIn('VD-222-20', queried)
        self.assertEqual(vss_lookup.call_args.args[1], list(msc_lookup.call_args.args[1]))
        rival = rows[0]['competitors'][0]
        self.assertEqual(rival['regNumber'], 'VD-222-20')
        self.assertEqual(rival['awardCount'], 1)
        self.assertEqual(rival['latestAward']['price'], 800)
        self.assertLess(rival['priceDeltaPct'], 0)
        self.assertEqual(heatmaps[1]['histories']['VD-222-20'][0]['price'], 800)


if __name__ == '__main__':
    unittest.main()
