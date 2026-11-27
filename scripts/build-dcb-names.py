"""Build the name vocabulary from ANVISA's July 2026 consolidated DCB XLSX."""
import argparse
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('workbook', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
with ZipFile(args.workbook) as workbook:
    strings = [
        ''.join(text.text or '' for text in cell.iter(ns + 't'))
        for cell in ET.fromstring(workbook.read('xl/sharedStrings.xml'))
    ]
    sheet = ET.fromstring(workbook.read('xl/worksheets/sheet1.xml'))

names = set()
records = 0
for row in sheet.iter(ns + 'row'):
    fields = {}
    for cell in row.iter(ns + 'c'):
        column = re.sub(r'\d+', '', cell.get('r'))
        value = cell.findtext(ns + 'v', '')
        if column in ('A', 'B') and value:
            fields[column] = strings[int(value)] if cell.get('t') == 's' else value
    if fields.get('A', '').strip().isdigit() and fields.get('B', '').strip():
        records += 1
        name = unicodedata.normalize('NFD', fields['B'].lower())
        names.add(' '.join(''.join(c for c in name if not unicodedata.combining(c)).split()))
if not names:
    raise ValueError('No DCB identifiers and names in the first two columns')
args.output.write_text('\n'.join(sorted(names)) + '\n', encoding='utf-8')
print(f'{records} DCB records, {len(names)} distinct normalized names')
