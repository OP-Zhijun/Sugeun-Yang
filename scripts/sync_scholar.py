"""
Sync Google Scholar metrics into index.html via SerpAPI.

SerpAPI handles captcha/proxy/throttling against Google Scholar so the
GitHub Actions runner gets clean results every time. Free tier covers
weekly runs comfortably (~5/month vs 100/month limit).

Set env var SERPAPI_KEY (stored as GitHub secret).
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCHOLAR_AUTHOR_ID = "X1B7JX8AAAAJ"
ROOT = Path(__file__).resolve().parent.parent
HTML_PATH = ROOT / "index.html"
DATA_DIR = ROOT / "data"
START_YEAR = 2009


def fetch_scholar():
    """Fetch metrics via SerpAPI's google_scholar_author endpoint."""
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        print("[sync] SERPAPI_KEY not set; skipping update.", file=sys.stderr)
        return None

    params = {
        "engine":    "google_scholar_author",
        "author_id": SCHOLAR_AUTHOR_ID,
        "hl":        "en",
        "api_key":   api_key,
    }
    url = "https://serpapi.com/search.json?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except Exception as exc:
        print(f"[sync] SerpAPI fetch failed: {exc}", file=sys.stderr)
        return None

    if "error" in payload:
        print(f"[sync] SerpAPI error: {payload['error']}", file=sys.stderr)
        return None

    cited = payload.get("cited_by") or {}
    table = cited.get("table") or []
    graph = cited.get("graph") or []
    articles = payload.get("articles") or []

    # table is a list of single-key dicts: citations / h_index / i10_index
    metrics = {}
    for row in table:
        for k, v in row.items():
            metrics[k] = v  # {"all": N, "since_YYYY": N}

    cites_per_year = {int(g["year"]): int(g["citations"]) for g in graph if "year" in g}

    return {
        "total_citations": int(metrics.get("citations", {}).get("all", 0)),
        "y5_citations":    int(metrics.get("citations", {}).get("since_2021", 0)),
        "h_index":         int(metrics.get("h_index", {}).get("all", 0)),
        "y5_h_index":      int(metrics.get("h_index", {}).get("since_2021", 0)),
        "i10_index":       int(metrics.get("i10_index", {}).get("all", 0)),
        "y5_i10_index":    int(metrics.get("i10_index", {}).get("since_2021", 0)),
        "cites_per_year":  cites_per_year,
        "articles":        articles,
        "fetched_at":      datetime.now(timezone.utc).isoformat(),
        "source":          "SerpAPI · google_scholar_author",
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


_YANG_PATTERN = re.compile(
    r'\b(?:S\.?\s*G\.?\s*Yang|SG\s*Yang|Yang\s*S\.?\s*G\.?)\b',
    flags=re.IGNORECASE,
)


def highlight_yang(authors):
    """Wrap Yang's name with <span class="self">…</span> in an author string."""
    return _YANG_PATTERN.sub(lambda m: f'<span class="self">{m.group(0)}</span>',
                             html.escape(authors))


def build_top_cited_html(articles, n=5):
    """Build the <li class='pub'>…</li> blocks for the top-N cited papers."""
    def cite_count(a):
        return int(((a.get("cited_by") or {}).get("value")) or 0)

    top = sorted(articles, key=cite_count, reverse=True)[:n]

    items = []
    for art in top:
        title = html.escape(art.get("title") or "")
        link = art.get("link") or ""
        authors_html = highlight_yang(art.get("authors") or "")
        publication = html.escape(art.get("publication") or "")
        year = html.escape(str(art.get("year") or ""))
        cites = cite_count(art)

        title_html = (
            f'<a href="{html.escape(link)}" target="_blank" rel="noopener">{title}</a>'
            if link else title
        )

        items.append(f'''        <li class="pub">
          <div class="num">★</div>
          <div class="body">
            <div class="title">{title_html}</div>
            <div class="authors">{authors_html}</div>
            <div class="meta"><span class="journal">{publication}</span><span class="yr">{year}</span></div>
          </div>
          <div class="stats">
            <span class="cites">{cites:,}</span>
            <span class="cites-l">Citations</span>
          </div>
        </li>''')

    return "\n\n".join(items)


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

    html = replace_pill(html, "Citations", fmt(data["total_citations"]))
    html = replace_pill(html, "h-index",   str(data["h_index"]))
    html = replace_pill(html, "i10-index", str(data["i10_index"]))

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
    html = re.sub(
        r'<span>peak &middot; \d+ \(\d+\)</span>',
        f'<span>peak &middot; {peak_val} ({peak_year})</span>',
        html,
    )

    if data.get("articles"):
        top_block = build_top_cited_html(data["articles"], n=5)
        html = re.sub(
            r'(<section class="section" id="highly-cited">.*?<ol class="pubs">)'
            r'(.*?)'
            r'(\s*</ol>\s*</section>)',
            lambda m: f'{m.group(1)}\n\n{top_block}\n\n      {m.group(3).lstrip()}',
            html,
            count=1,
            flags=re.DOTALL,
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
