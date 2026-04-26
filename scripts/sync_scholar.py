"""
Sync Google Scholar metrics into index.html.

Designed to run weekly via GitHub Actions. Fails gracefully:
- If Scholar blocks the request, exits 0 without modifying HTML.
- If the returned data looks wrong (suspiciously low values), refuses to update.
- If nothing changed, the workflow's git-diff check skips the commit.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from scholarly import scholarly

SCHOLAR_ID = "X1B7JX8AAAAJ"
ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "index.html"
DATA_DIR = ROOT / "data"
START_YEAR = 2009


def fetch_scholar():
    try:
        author = scholarly.search_author_id(SCHOLAR_ID)
        author = scholarly.fill(author, sections=["indices", "counts"])
    except Exception as exc:
        print(f"[sync] Scholar fetch failed: {exc}", file=sys.stderr)
        return None

    cpy_raw = author.get("cites_per_year", {}) or {}
    cpy = {int(k): int(v) for k, v in cpy_raw.items()}

    return {
        "total_citations": int(author.get("citedby", 0)),
        "y5_citations":    int(author.get("citedby5y", 0)),
        "h_index":         int(author.get("hindex", 0)),
        "y5_h_index":      int(author.get("hindex5y", 0)),
        "i10_index":       int(author.get("i10index", 0)),
        "y5_i10_index":    int(author.get("i10index5y", 0)),
        "cites_per_year":  cpy,
        "fetched_at":      datetime.now(timezone.utc).isoformat(),
    }


def fmt(n):
    return f"{n:,}"


def build_bars(cites_per_year):
    current = datetime.now(timezone.utc).year
    years = list(range(START_YEAR, current + 1))
    values = {y: cites_per_year.get(y, 0) for y in years}

    full_years = {y: v for y, v in values.items() if y != current}
    max_val = max(full_years.values()) if full_years else 1
    if max_val == 0:
        max_val = 1
    peak_year = max(full_years, key=full_years.get) if full_years else current
    peak_val = full_years.get(peak_year, 0)

    bars = []
    for y in years:
        v = values[y]
        height = min(round(v / max_val * 100), 100)
        is_current = (y == current)
        cls = "cites-bar partial" if is_current else "cites-bar"
        suffix = " (YTD)" if is_current else ""
        bars.append(
            f'<div class="{cls}" style="height: {height}%" data-tip="{v} · {y}{suffix}"></div>'
        )

    labels = [f"<span>'{str(y)[-2:]}</span>" for y in years]
    return bars, labels, peak_year, peak_val


def replace_pill(html, label, new_value):
    pattern = (
        r'<span class="v">[\d,]+</span>(\s*)<span class="l">'
        + re.escape(label)
        + r'</span>'
    )
    repl = f'<span class="v">{new_value}</span>\\1<span class="l">{label}</span>'
    return re.sub(pattern, repl, html, count=1)


def update_html(data):
    html = HTML_PATH.read_text(encoding="utf-8")

    # 1. Citations table (3 rows: Citations, h-index, i10-index)
    html = re.sub(
        r'<tr><th>Citations</th><td>[\d,]+</td><td>[\d,]+</td></tr>',
        f'<tr><th>Citations</th><td>{fmt(data["total_citations"])}</td><td>{fmt(data["y5_citations"])}</td></tr>',
        html,
    )
    html = re.sub(
        r'<tr><th>h-index</th><td>\d+</td><td>\d+</td></tr>',
        f'<tr><th>h-index</th><td>{data["h_index"]}</td><td>{data["y5_h_index"]}</td></tr>',
        html,
    )
    html = re.sub(
        r'<tr><th>i10-index</th><td>\d+</td><td>\d+</td></tr>',
        f'<tr><th>i10-index</th><td>{data["i10_index"]}</td><td>{data["y5_i10_index"]}</td></tr>',
        html,
    )

    # 2. Metric pills at top of profile
    html = replace_pill(html, "Citations", fmt(data["total_citations"]))
    html = replace_pill(html, "h-index",   str(data["h_index"]))
    html = replace_pill(html, "i10-index", str(data["i10_index"]))

    # 3. Bar chart — replace the .cites-bars block and .cites-years block
    bars, labels, peak_year, peak_val = build_bars(data["cites_per_year"])
    bars_block = "\n            ".join(bars)
    labels_block = "".join(labels)

    html = re.sub(
        r'(<div class="cites-bars">)(.*?)(</div>\s*<div class="cites-years">)',
        lambda m: f'{m.group(1)}\n            {bars_block}\n          {m.group(3)}',
        html,
        count=1,
        flags=re.DOTALL,
    )
    html = re.sub(
        r'(<div class="cites-years">)(.*?)(</div>)',
        lambda m: f'{m.group(1)}\n            {labels_block}\n          {m.group(3)}',
        html,
        count=1,
        flags=re.DOTALL,
    )

    # 4. Peak label in chart header
    html = re.sub(
        r'<span>peak &middot; \d+ \(\d+\)</span>',
        f'<span>peak &middot; {peak_val} ({peak_year})</span>',
        html,
    )

    HTML_PATH.write_text(html, encoding="utf-8")


def main():
    data = fetch_scholar()
    if data is None:
        print("[sync] No data fetched; HTML left unchanged.")
        return 0

    if data["total_citations"] < 1000 or data["h_index"] < 10:
        print(
            f"[sync] Returned data looks wrong "
            f"(cites={data['total_citations']}, h={data['h_index']}); refusing to update.",
            file=sys.stderr,
        )
        return 0

    print(f"[sync] Total citations:  {data['total_citations']}")
    print(f"[sync] 5-yr citations:   {data['y5_citations']}")
    print(f"[sync] h-index:          {data['h_index']} (5y: {data['y5_h_index']})")
    print(f"[sync] i10-index:        {data['i10_index']} (5y: {data['y5_i10_index']})")
    print(f"[sync] Years in chart:   {len(data['cites_per_year'])}")

    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "scholar_latest.json").write_text(
        json.dumps(data, indent=2, default=str), encoding="utf-8"
    )

    update_html(data)
    print("[sync] index.html updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
