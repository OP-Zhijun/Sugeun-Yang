"""
Build network.json for the Network tab — co-authors, institutions, country roll-ups.
Pulls from OpenAlex (free, no API key, ORCID-clean data).
Runs weekly via GitHub Actions alongside sync_scholar.py.
"""
import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

OPENALEX_AUTHOR_ID = "A5042254280"  # Su-Geun Yang
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"


def fetch_works():
    """Fetch all works for the author. Paginated via cursor."""
    works = []
    cursor = "*"
    select = ",".join([
        "id", "title", "doi", "publication_year",
        "authorships", "concepts", "primary_location",
    ])
    base = "https://api.openalex.org/works"
    while True:
        params = {
            "filter": f"author.id:{OPENALEX_AUTHOR_ID}",
            "per-page": 200,
            "cursor": cursor,
            "select": select,
            "mailto": "sugeun.yang@inha.ac.kr",  # polite-pool
        }
        url = base + "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=45) as r:
                payload = json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            print(f"[network] OpenAlex fetch failed: {exc}", file=sys.stderr)
            return None

        page = payload.get("results", [])
        works.extend(page)
        cursor = payload.get("meta", {}).get("next_cursor")
        if not cursor or not page:
            break
    return works


def aggregate(works):
    """Roll up co-authors and institutions."""
    target = OPENALEX_AUTHOR_ID
    co_authors = {}
    institutions = {}
    countries = defaultdict(int)

    paper_meta = []

    for w in works:
        wid = w.get("id", "")
        year = w.get("publication_year")
        title = w.get("title") or ""
        doi = w.get("doi")
        primary = w.get("primary_location") or {}
        source  = primary.get("source") or {}
        venue   = source.get("display_name") or ""

        authorships = w.get("authorships") or []
        co_ids_in_paper = []

        for a in authorships:
            au = a.get("author") or {}
            au_id = au.get("id") or ""
            if not au_id:
                continue
            if target in au_id:
                continue  # skip Yang himself
            co_ids_in_paper.append(au_id)

            entry = co_authors.setdefault(au_id, {
                "id": au_id,
                "name": au.get("display_name") or "",
                "orcid": au.get("orcid"),
                "papers": 0,
                "years": set(),
                "institution_ids": set(),
                "is_external": True,  # default
            })
            entry["papers"] += 1
            if year:
                entry["years"].add(year)

            for inst in (a.get("institutions") or []):
                inst_id = inst.get("id")
                if not inst_id:
                    continue
                inst_country = inst.get("country_code") or ""
                inst_name    = inst.get("display_name") or ""
                inst_type    = inst.get("type") or ""
                inst_entry = institutions.setdefault(inst_id, {
                    "id": inst_id,
                    "name": inst_name,
                    "country": inst_country,
                    "type": inst_type,
                    "papers": 0,
                    "is_external": "Inha" not in inst_name,
                })
                inst_entry["papers"] += 1
                entry["institution_ids"].add(inst_id)
                if "Inha" in inst_name:
                    entry["is_external"] = False
                if inst_country:
                    countries[inst_country] += 1

        paper_meta.append({
            "id": wid,
            "year": year,
            "title": title,
            "doi": doi,
            "venue": venue,
            "co_author_ids": co_ids_in_paper,
        })

    # finalize co-authors
    co_list = []
    for c in co_authors.values():
        years = sorted(c["years"])
        co_list.append({
            "id": c["id"],
            "name": c["name"],
            "orcid": c["orcid"],
            "papers": c["papers"],
            "first_year": years[0] if years else None,
            "last_year": years[-1] if years else None,
            "institution_ids": sorted(c["institution_ids"]),
            "is_external": c["is_external"],
        })
    co_list.sort(key=lambda x: (-x["papers"], x["name"]))

    inst_list = sorted(institutions.values(), key=lambda x: -x["papers"])

    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "person": {
            "openalex_id": OPENALEX_AUTHOR_ID,
            "name": "Su-Geun Yang",
            "orcid": "0000-0001-5278-8723",
        },
        "totals": {
            "works": len(paper_meta),
            "co_authors": len(co_list),
            "institutions": len(inst_list),
            "countries": len(countries),
        },
        "co_authors": co_list,
        "institutions": inst_list,
        "country_counts": dict(sorted(countries.items(), key=lambda x: -x[1])),
        "papers": paper_meta,
    }


def main():
    works = fetch_works()
    if not works:
        print("[network] No works fetched; leaving network.json unchanged.")
        return 0

    print(f"[network] Fetched {len(works)} works.")
    data = aggregate(works)
    print(f"[network] Co-authors: {data['totals']['co_authors']}")
    print(f"[network] Institutions: {data['totals']['institutions']}")
    print(f"[network] Countries: {data['totals']['countries']}")

    DATA_DIR.mkdir(exist_ok=True)
    out = DATA_DIR / "network.json"
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[network] Wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
