"""Application component smoke test; uses a temporary database."""
import tempfile
from pathlib import Path
from unittest.mock import patch
import tkinter as tk
import core
from app import App
from test_core import drug

with tempfile.TemporaryDirectory() as folder, patch.object(core,'DB',Path(folder)/'test.sqlite3'):
    with core.connect() as con:
        core.save_records(con,'prices',[drug(i) for i in range(110)])
        core.save_records(con,'tenders',[{'id':'t1','notifyNo':'IB2600000001','isMedicine':1,'bidName':['Gói thầu thuốc Generic']}])
    root=tk.Tk();root.withdraw();app=App(root);root.update_idletasks()
    assert app.views['prices'].count==110
    prices=app.views['prices'];prices.vars['q'].set('paracetamol');prices.apply()
    assert prices.count==110 and len(prices.rows)==50
    prices.move(1);assert len(prices.rows)==50
    prices.move(1);assert len(prices.rows)==10
    prices.tree.selection_set('0');prices.linked()
    assert app.views['tenders'].count==1
    tender=app.views['tenders'];tender.tree.selection_set('0');tender.linked()
    assert prices.count==110
    app.sync_dialog();app.update_dialog();root.update_idletasks()
    app.close();print('App smoke: search, paging, bid-to-drug links and download dialog OK')
