from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE_HTML = ROOT / "高成本预警看板.html"
XLSX_JS = ROOT / "xlsx.full.min.js"
OUT_DIR = ROOT / "github-pages-site"
OUT_HTML = OUT_DIR / "risk-alert.html"
OUT_INDEX = OUT_DIR / "index.html"
NOJEKYLL = OUT_DIR / ".nojekyll"


def main() -> None:
    if not SOURCE_HTML.exists():
        raise SystemExit(f"Missing source HTML: {SOURCE_HTML}")
    if not XLSX_JS.exists():
        raise SystemExit(f"Missing xlsx runtime: {XLSX_JS}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_HTML, OUT_HTML)
    shutil.copy2(SOURCE_HTML, OUT_INDEX)
    shutil.copy2(XLSX_JS, OUT_DIR / XLSX_JS.name)
    NOJEKYLL.write_text("", encoding="utf-8")
    print(OUT_DIR)


if __name__ == "__main__":
    main()
