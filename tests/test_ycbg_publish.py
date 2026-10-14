from contextlib import closing
from datetime import datetime
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock,patch
from scripts.crawl_ycbg import restore,publish
from server import ycbg

class YcbgPublishTest(unittest.TestCase):
    def test_cold_restore_never_overwrites_newer_local_detail_or_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(ycbg,'DB',Path(folder)/'ycbg.sqlite3'):
            norm=json.dumps({'id':'a','name':'new'})
            with closing(ycbg.connect()) as local:
                local.execute('INSERT INTO quotes VALUES (?,?,?,?,?)',('a',norm,'{"new":true}','2026-10-14T12:00:00+07:00',None))
                local.execute("INSERT INTO crawl_meta VALUES ('completed_at','2026-10-14T12:00:00+07:00')");local.commit()
            conn=MagicMock();cur=conn.cursor.return_value.__enter__.return_value
            cur.fetchone.side_effect=[('msc_ycbg',),(1,),(datetime(2026,10,10,1),)]
            cur.fetchall.return_value=[('a','{"id":"a","name":"old"}','{"old":true}','2026-10-10T12:00:00+07:00',None)]
            restore(conn)
            with closing(ycbg.connect()) as local:
                self.assertEqual(local.execute('SELECT normalized,detail FROM quotes').fetchone(),(norm,'{"new":true}'))
                self.assertEqual(local.execute("SELECT value FROM crawl_meta WHERE key='completed_at'").fetchone()[0],'2026-10-14T12:00:00+07:00')

    def test_partial_publish_does_not_advance_success_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(ycbg,'DB',Path(folder)/'ycbg.sqlite3'):
            with closing(ycbg.connect()) as local:
                local.execute('INSERT INTO quotes VALUES (?,?,?,?,?)',('a','{"id":"a"}',None,None,None));local.commit()
            conn=MagicMock();cur=conn.cursor.return_value.__enter__.return_value;cur.fetchone.return_value=(1,)
            publish(conn,completed_run=False)
            sql,args=next(call.args for call in cur.execute.call_args_list if call.args[0].startswith('UPDATE data_registry_meta'))
            self.assertIn('IF(%s,UTC_TIMESTAMP(),last_synced_at)',sql)
            self.assertEqual(args,(1,False,'warning'))

if __name__=='__main__':unittest.main()
