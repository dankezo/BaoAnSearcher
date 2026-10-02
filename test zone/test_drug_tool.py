import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import xml.etree.ElementTree as ET
import drug_tool as app


class FakeServer:
    def __init__(self, records, stop=None):
        self.records = records
        self.offsets = []
        self.stop = stop

    def open(self, request, timeout=60):
        offset = json.loads(request.data)['skipCount']
        self.offsets.append(offset)
        # Deliberately return fewer records than the requested 200.
        items = self.records[offset:offset+2]
        if self.stop: self.stop.set()
        return io.BytesIO(json.dumps({'result': {'items':items,'totalCount':len(self.records)}}).encode())


class ToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dbpatch = patch.object(app, 'DB', Path(self.temp.name)/'data'/'test.db')
        self.dbpatch.start()
        self.records = [{'id': i, 'tenThuoc':'Thuốc Đặc Biệt '+str(i), 'soDangKy':f'VN-{i}', 'thongTinThuocCoBan':{'hoatChatChinh':'Acetylcystein'}, 'congTySanXuat':{'nuocSanXuat':'Việt Nam'}} for i in range(5)]

    def tearDown(self):
        self.dbpatch.stop(); self.temp.cleanup()

    def test_resume_capped_pages_and_export(self):
        first = app.Downloader(lambda _:None)
        server = FakeServer(self.records, first.stop)
        with patch.object(first,'session',return_value=(server,{})):
            first.run(delay=0)
        with app.connect() as con:
            self.assertEqual(app.meta(con,'skip'),2)
            self.assertFalse(app.meta(con,'complete'))
        second=app.Downloader(lambda _:None); server=FakeServer(self.records)
        with patch.object(second,'session',return_value=(server,{})):
            second.run(delay=0)
        self.assertEqual(server.offsets,[2,4])
        total,rows=app.search({'all':'thuoc dac','congTySanXuat.nuocSanXuat':'viet nam'})
        self.assertEqual(total,5)
        self.assertEqual(app.search({'all':'%notwildcard'})[0],0)
        third=app.Downloader(lambda _:None); server=FakeServer(self.records)
        with patch.object(third,'session',return_value=(server,{})):
            third.run(restart=True,delay=0)
        self.assertEqual(app.search({})[0],5)
        path=Path(self.temp.name)/'test.xlsx'; app.export_file(path,{})
        with zipfile.ZipFile(path) as z:
            for name in z.namelist(): ET.fromstring(z.read(name))
            sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
            self.assertEqual(len(sheet.find('{*}sheetData')),6)
        path=Path(self.temp.name)/'test.json'; app.export_file(path,{'soDangKy':'VN-3'})
        self.assertEqual(len(json.loads(path.read_text(encoding='utf-8'))),1)

    def test_empty_page_does_not_advance(self):
        down=app.Downloader(lambda _:None)
        server=FakeServer([])
        def bad(*a,**kw): return io.BytesIO(b'{"result":{"totalCount":10,"items":[]}}')
        server.open=bad
        with patch.object(down,'session',return_value=(server,{})):
            with self.assertRaisesRegex(RuntimeError,'rỗng'): down.run(delay=0)
        with app.connect() as con: self.assertEqual(app.meta(con,'skip',0),0)

    def test_more_than_2000_pages(self):
        down=app.Downloader(lambda _:None)
        server=FakeServer([{'id':i,'tenThuoc':str(i)} for i in range(4002)])
        with patch.object(down,'session',return_value=(server,{})):
            down.run(delay=0)
        self.assertEqual(len(server.offsets),2001)
        self.assertEqual(app.search({})[0],4002)
        with app.connect() as con: self.assertTrue(app.meta(con,'complete'))


if __name__=='__main__': unittest.main()
