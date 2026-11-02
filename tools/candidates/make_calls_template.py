import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
C = json.load(open(sys.argv[1]))["candidates"]; tax = json.load(open(sys.argv[2])); out = sys.argv[3]
SL = {s[0]: s[1] for s in tax["states"]}
wb = Workbook(); ws = wb.active; ws.title = "Calls"
H = ["id", "name", "state", "office", "party", "call", "time", "link", "note"]
ws.append(H)
for c in C: ws.append([c["id"], c["n"], SL[c["s"]], c["o"], c["p"].split(" (")[0], "pending", "", "", ""])
hdr = PatternFill("solid", fgColor="111525"); 
for i, h in enumerate(H, 1):
    x = ws.cell(1, i); x.font = Font(bold=True, color="FFFFFF"); x.fill = hdr; x.alignment = Alignment(vertical="center")
inp = PatternFill("solid", fgColor="FFF6D6")
for r in range(2, len(C) + 2):
    for col in (6, 7, 8, 9): ws.cell(r, col).fill = inp
    ws.cell(r, 7).number_format = "@"   # keep the time as typed
for col, w in zip("ABCDEFGHI", (24, 26, 16, 28, 11, 11, 20, 46, 30)): ws.column_dimensions[col].width = w
ws.freeze_panes = "C2"; ws.auto_filter.ref = f"A1:I{len(C)+1}"
dv = DataValidation(type="list", formula1='"pending,won,lost,runoff,recount"', allow_blank=True, showErrorMessage=True, errorTitle="Call", error="Choose pending, won, lost, runoff or recount")
ws.add_data_validation(dv); dv.add(f"F2:F{len(C)+1}")
g = wb.create_sheet("How to use")
for line in [
 ("Election results: Associated Press race calls",),
 ("",),
 ("1. Do not change columns A to E (id, name, state, office, party). They match the candidates on the site.",),
 ("2. When AP calls a race, set column F to won, lost, runoff or recount for each tracked candidate in it. Leave it as pending until AP calls it.",),
 ("3. Column G: when AP called it, as 2026-11-03 21:41 (Eastern time by default). Add CT, MT, PT, AKT, HT or UTC after the time for another zone. Optional but recommended.",),
 ("4. Column H: the AP address for that race (an apnews.com link). Optional.",),
 ("5. Column I is for your own notes and is ignored.",),
 ("",),
 ("In a race with one seat, only one candidate can be marked won. Marking a second winner makes the site skip the later one and report it.",),
 ("Unopposed candidates stay unopposed on the site until you mark them won.",),
 ("",),
 ("Publishing: File, Share, Publish to web, choose the Calls sheet and Comma-separated values (.csv), then Publish. Send that address to be added to the site (or save it as the repository variable RESULTS_CSV_URL). The site reads it about every 10 minutes.",),
 ("Only people you share the sheet with can edit it; the published CSV is read-only.",),
]: g.append(list(line))
g["A1"].font = Font(bold=True, size=14); g.column_dimensions["A"].width = 150
for r in g.iter_rows(): 
    for c in r: c.alignment = Alignment(wrap_text=True, vertical="top")
wb.save(out); print("saved", out, len(C), "rows")
