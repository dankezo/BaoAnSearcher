# -*- coding: utf-8 -*-
"""Parse TT 20/2022 Phụ lục I from scraped text into tt20_bhyt.json."""
from __future__ import annotations
import json
import re
from pathlib import Path

SRC = Path(r"C:\Users\AD\.cursor\projects\d-BaoAnSearcher\agent-tools\de82fc0f-95d0-4b19-8451-906e04fb80b2.txt")
OUT = Path(r"D:\BaoAnSearcher\web\public\data\tt20_bhyt.json")

text = SRC.read_text(encoding="utf-8", errors="replace")
start = text.find("PHỤ LỤC I")
# Prefer stop before phụ lục II if present
end_markers = ["PHỤ LỤC II", "PHỤ LỤC 2", "Điều 2.", "Nơi nhận"]
end = len(text)
for m in end_markers:
    i = text.find(m, start + 100)
    if i != -1:
        end = min(end, i)
body = text[start:end]

# Split into lines, drop empties
lines = [re.sub(r"\s+", " ", ln).strip() for ln in body.splitlines()]
lines = [ln for ln in lines if ln]

rows = []
# State machine: stt number, then name, then route, then up to 4 + marks, then note
i = 0
current_name = None
pending = None  # dict being built

def is_plus(s):
    return s in ("+", "×", "x", "X", "–", "-", "−")

def normalize_mark(s):
    if s == "+":
        return "+"
    if s in ("×", "x", "X", "–", "-", "−", ""):
        return ""
    return s

while i < len(lines):
    ln = lines[i]
    # section headers like "1. THUỐC..." or "1.1. ..."
    if re.match(r"^\d+(\.\d+)*\.\s+\S", ln) and not re.match(r"^\d+$", ln):
        i += 1
        continue
    if ln in ("STT", "Tên hoạt chất", "Đường dùng, dạng dùng", "Hạng bệnh viện", "Ghi chú",
              "(1)", "(2)", "(3)", "(4)", "(5)", "(6)", "(7)", "(8)",
              "PHỤ LỤC I") or ln.startswith("DANH MỤC THUỐC"):
        i += 1
        continue
    # New STT
    if re.fullmatch(r"\d+", ln):
        stt = int(ln)
        # next non-empty is name
        i += 1
        while i < len(lines) and not lines[i]:
            i += 1
        if i >= len(lines):
            break
        name = lines[i]
        i += 1
        # Collect route lines until we hit + or another STT
        # Pattern after name: route, then +, +, +, + (up to 4), optional note
        # Some entries have multiple route blocks under same STT/name
        while i < len(lines):
            # peek
            if re.fullmatch(r"\d+", lines[i]):
                break  # next STT
            if re.match(r"^\d+(\.\d+)*\.\s+\S", lines[i]) and not re.fullmatch(r"\d+", lines[i]):
                break
            route = lines[i]
            i += 1
            marks = []
            while i < len(lines) and len(marks) < 4 and is_plus(lines[i]):
                marks.append(normalize_mark(lines[i]))
                i += 1
            # pad marks
            while len(marks) < 4:
                marks.append("")
            note = ""
            # note if next line is not STT / section / plus / looks like prose
            if i < len(lines):
                nxt = lines[i]
                if (
                    not re.fullmatch(r"\d+", nxt)
                    and not is_plus(nxt)
                    and not re.match(r"^\d+(\.\d+)*\.\s+\S", nxt)
                    and nxt not in ("STT", "Tên hoạt chất")
                    # Heuristic: note often long Vietnamese sentence
                    and (len(nxt) > 40 or nxt.startswith("Đối với") or nxt.startswith("Quỹ")
                         or "thanh toán" in nxt.lower() or "điều trị" in nxt.lower()
                         or nxt.startswith("Khi") or nxt.startswith("Chỉ"))
                ):
                    # Might actually be another route if short medical term
                    note_parts = [nxt]
                    i += 1
                    while i < len(lines):
                        n2 = lines[i]
                        if re.fullmatch(r"\d+", n2) or is_plus(n2) or re.match(r"^\d+(\.\d+)*\.\s+\S", n2):
                            break
                        # another route under same drug? if short and next is +
                        if i + 1 < len(lines) and is_plus(lines[i + 1]) and len(n2) < 60:
                            break
                        note_parts.append(n2)
                        i += 1
                    note = " ".join(note_parts)
            rows.append({
                "stt": stt,
                "hoatChat": name,
                "duongDung": route,
                "hangDB_I": marks[0],
                "hangII": marks[1],
                "hangIII_IV": marks[2],
                "tramYT": marks[3],
                "ghiChu": note,
            })
            # continue for more routes same STT
        continue
    i += 1

# Deduplicate exact rows
seen = set()
uniq = []
for r in rows:
    key = (r["stt"], r["hoatChat"], r["duongDung"], r["hangDB_I"], r["hangII"], r["hangIII_IV"], r["tramYT"], r["ghiChu"])
    if key in seen:
        continue
    seen.add(key)
    uniq.append(r)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(uniq, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {len(uniq)} rows to {OUT}")
print("sample:", json.dumps(uniq[:3], ensure_ascii=False, indent=2))
print("paracetamol:", [r for r in uniq if "paracetamol" in r["hoatChat"].lower()][:5])
