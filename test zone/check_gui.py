"""Smoke test for a Windows desktop session: python check_gui.py."""
import tkinter as tk
from tkinter import ttk
import drug_tool

def check(root):
    root.update()
    def walk(widget):
        for child in widget.winfo_children():
            yield child
            yield from walk(child)
    widgets = list(walk(root))
    entries = [w for w in widgets if isinstance(w, ttk.Entry)]
    entries[0].insert(0, 'paracetamol')
    buttons = {w.cget('text'): w for w in widgets if isinstance(w, ttk.Button)}
    buttons['Tìm kiếm'].invoke()
    tree = next(w for w in widgets if isinstance(w, ttk.Treeview))
    assert len(tree.get_children()) > 0
    print('GUI search:', len(tree.get_children()), 'rows')
    buttons['Xóa bộ lọc'].invoke()
    assert len(tree.get_children()) == 100
    tree.selection_set(tree.get_children()[0])
    buttons['Xem chi tiết'].invoke()
    root.update()
    assert any(isinstance(w, tk.Toplevel) for w in root.winfo_children())
    print('GUI reset and detail: OK')
    root.destroy()

if __name__ == '__main__':
    tk.Tk.mainloop = check
    drug_tool.gui()
