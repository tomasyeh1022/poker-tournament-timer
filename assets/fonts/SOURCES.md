# Offline UI fonts

Downloaded from the official [Google Fonts repository](https://github.com/google/fonts) on 2026-09-15.

| Shipped file | Original font | Variable weight range | Purpose |
| --- | --- | --- | --- |
| `Manrope-UI.woff2` | Manrope | 200–800 | Latin interface labels, buttons and headings |
| `NotoSansTC-UI.woff2` | Noto Sans TC | 100–900 | Traditional Chinese interface labels and help text |

The display countdown and primary numeric figures continue using the timer's existing font. Both bundled font files work offline and require no request to Google Fonts at runtime. Use a system sans-serif fallback for glyphs outside the bundled subset.

## Sources and licenses

- Manrope: [official source folder](https://github.com/google/fonts/tree/main/ofl/manrope), [variable TrueType source](https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/Manrope%5Bwght%5D.ttf), [original OFL](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt). Copyright 2018 The Manrope Project Authors. The complete license is included in `Manrope-LICENSE.txt`.
- Noto Sans TC: [official source folder](https://github.com/google/fonts/tree/main/ofl/notosanstc), [variable TrueType source](https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf), [original OFL](https://github.com/google/fonts/blob/main/ofl/notosanstc/OFL.txt). Copyright 2014–2021 Adobe, with Reserved Font Name “Source”. The complete license is included in `NotoSansTC-LICENSE.txt`.

Both fonts are distributed under the SIL Open Font License 1.1. Their full original license text accompanies these derivatives. The modifications here are conversion to WOFF2 and glyph subsetting; glyph designs and variable axes are unchanged.

Downloaded source SHA-256 checksums:

- `Manrope-source.ttf`: `D0639BE45D0AF36E798172419D7BD173C4BD4F29E2B76CBB69DB1D11BF8B0A40`
- `NotoSansTC-source.ttf`: `864727D210D54F2537BBE23B3A839436C3992AF72DE9322AF5270897246BD44F`

## Rebuilding the subset

1. Download the source TrueType files above to this directory as `Manrope-source.ttf` and `NotoSansTC-source.ttf`.
2. With Python, fontTools and Brotli available, run `python assets/fonts/build_fonts.py` from the repository root.
3. The script keeps all Manrope Unicode coverage and subsets Noto Sans TC to characters from `index.html`, `app.js`, `prizes.js`, `README.md`, ASCII/Latin-1, common punctuation and the planned interface labels in the script. It writes the two WOFF2 files and `font-metadata.json`.
4. Remove the downloaded `*-source.ttf` files before packaging. Keep the two license files with the bundled fonts.

Rebuild Noto Sans TC after introducing interface text with additional Chinese characters. Unsupported new text remains legible through the configured system fallback.
