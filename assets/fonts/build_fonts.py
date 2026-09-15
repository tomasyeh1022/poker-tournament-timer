"""Rebuild offline UI font subsets from downloaded Google Fonts source files.

Requires fontTools and Brotli. Source files are not shipped with this project;
see SOURCES.md for their official download locations and licenses.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
import json

font_dir = Path(__file__).resolve().parent
repo_dir = font_dir.parent.parent
extra = '升盲表、基準級別、後續盲注逐級翻倍、直接修改每一級、設定自動儲存、Poker Tournament Timer、OFF、移開欄位後自動儲存、翻倍的基準級別、從基準級別往後計算、保留各級時間與休息、其他級別的時間可以各自設定、修改目前級別的分鐘會重新倒數、啟用 Ante；：，。！？「」『』（）【】－—–…•·＋×÷→←↑↓↗％'
text = extra + ''.join(chr(n) for n in range(0x20, 0x100))
for file in ('index.html', 'app.js', 'prizes.js', 'README.md'):
    text += (repo_dir / file).read_text(encoding='utf-8')
requested = set(map(ord, text))
report = {}
for family in ('Manrope', 'NotoSansTC'):
    source = font_dir / f'{family}-source.ttf'
    font = TTFont(source, recalcTimestamp=False)
    coverage = set(font.getBestCmap())
    # Keep the original Latin coverage. Noto is limited to current UI/copy,
    # with system fallback covering future strings outside this subset.
    unicodes = coverage if family == 'Manrope' else requested & coverage
    options = subset.Options()
    options.flavor = 'woff2'
    options.desubroutinize = True
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)
    font.flavor = 'woff2'
    output = font_dir / f'{family}-UI.woff2'
    font.save(output)
    check = TTFont(output)
    axes = {axis.axisTag: [axis.minValue, axis.maxValue] for axis in check['fvar'].axes}
    report[family] = {'file': output.name, 'bytes': output.stat().st_size,
                      'unicode_count': len(check.getBestCmap()), 'axes': axes}

(font_dir / 'font-metadata.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
