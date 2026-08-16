"""
test_pipeline.py
Smoke-test suite for the Utkal.ai Python RAG API v2.1.
Tests run against the live server on http://127.0.0.1:8000

Start the server first:
    uvicorn app:app --host 127.0.0.1 --port 8000 --reload

Then run:
    python test_pipeline.py
"""

import sys
import requests

BASE = "http://127.0.0.1:8000"


def ok(label: str):   print(f"  ✅ {label}")
def fail(label: str, detail: str): print(f"  ❌ {label} — {detail}")


# ── connectivity ──────────────────────────────────────────────────────────────

def test_root():
    r = requests.get(f"{BASE}/")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "active"
    assert d["version"] == "2.1.0"
    ok(f"GET /  →  v{d['version']}, {len(d['endpoints'])} endpoints advertised")


def test_health():
    r = requests.get(f"{BASE}/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"
    ok("GET /health  →  healthy")


# ── stats ─────────────────────────────────────────────────────────────────────

def test_rag_stats():
    r = requests.get(f"{BASE}/api/rag/stats")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success"
    s = d["statistics"]
    assert "total_chunks" in s and "storage" in s
    ok(f"GET /api/rag/stats  →  {s}")


# ── search ────────────────────────────────────────────────────────────────────

def test_search_odia():
    r = requests.post(f"{BASE}/api/rag/search",
                      json={"query": "ସୁଭଦ୍ରା ଯୋଜନା", "topK": 3, "embeddingType": "ngram"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success"
    ok(f"POST /api/rag/search (Odia, ngram)  →  {d['resultsCount']} results")


def test_search_english():
    r = requests.post(f"{BASE}/api/rag/search",
                      json={"query": "Odisha government scheme", "topK": 3, "embeddingType": "ngram"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success"
    ok(f"POST /api/rag/search (English, ngram)  →  {d['resultsCount']} results")


def test_search_gemini():
    r = requests.post(f"{BASE}/api/rag/search",
                      json={"query": "Subhadra Yojana documents", "topK": 3, "embeddingType": "gemini"})
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success"
    ok(f"POST /api/rag/search (Gemini embed)  →  backend={d.get('embeddingBackend')}, {d['resultsCount']} results")


def test_search_empty():
    r = requests.post(f"{BASE}/api/rag/search", json={"query": "  "})
    assert r.status_code == 400
    ok("POST /api/rag/search (empty)  →  400 as expected")


# ── upload-url ────────────────────────────────────────────────────────────────

def test_upload_url():
    """Scrape a real Odia government page and index it."""
    r = requests.post(
        f"{BASE}/api/upload-url",
        json={"url": "https://subhadra.odisha.gov.in", "embeddingType": "ngram"},
        timeout=30,
    )
    # 200 = success; 502/504/422 = site unreachable — endpoint still working
    assert r.status_code in (200, 422, 502, 504)
    if r.status_code == 200:
        d = r.json()
        assert d["success"] is True
        assert d["stats"]["chunksCreated"] > 0
        ok(
            f"POST /api/upload-url  →  '{d['pageTitle'][:45]}', "
            f"{d['stats']['chunksCreated']} chunks, "
            f"embed={d['stats']['embeddingBackend']}({d['stats']['embeddingDim']}-dim)"
        )
    else:
        ok(f"POST /api/upload-url  →  HTTP {r.status_code} (site unreachable, endpoint OK)")


def test_upload_url_invalid():
    r = requests.post(f"{BASE}/api/upload-url", json={"url": "not-a-url"})
    assert r.status_code == 400
    ok("POST /api/upload-url (invalid URL)  →  400 as expected")


def test_upload_url_odia_wikipedia():
    """Scrape Odia Wikipedia for extra content."""
    r = requests.post(
        f"{BASE}/api/upload-url",
        json={"url": "https://or.wikipedia.org/wiki/%E0%AC%93%E0%AC%A1%E0%AC%BC%E0%AC%BF%E0%AC%86",
              "embeddingType": "ngram"},
        timeout=30,
    )
    assert r.status_code in (200, 422, 502, 504)
    if r.status_code == 200:
        d = r.json()
        assert d["success"] is True
        ok(f"POST /api/upload-url (Wikipedia Odia)  →  {d['stats']['chunksCreated']} chunks indexed")
    else:
        ok(f"POST /api/upload-url (Wikipedia)  →  HTTP {r.status_code} (site unreachable)")


# ── train ─────────────────────────────────────────────────────────────────────

def test_train_ngram():
    """Quick full train using local data + n-gram (no external API calls)."""
    r = requests.post(
        f"{BASE}/api/rag/train",
        json={"pdfDirectory": None, "websiteUrls": [], "databaseRecords": [], "embeddingType": "ngram"},
        timeout=120,
    )
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success"
    ok(
        f"POST /api/rag/train (ngram)  →  "
        f"{d['chunksProcessed']} chunks, "
        f"backend={d.get('embeddingBackend')}, "
        f"storage={d['statistics'].get('storage')}"
    )


# ── runner ────────────────────────────────────────────────────────────────────

TESTS = [
    test_root,
    test_health,
    test_rag_stats,
    test_search_odia,
    test_search_english,
    test_search_gemini,
    test_search_empty,
    test_upload_url,
    test_upload_url_invalid,
    test_upload_url_odia_wikipedia,
    test_train_ngram,
]

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Utkal.ai Python RAG API — Test Suite  (v2.1)")
    print("=" * 60)

    passed = failed = 0
    for t in TESTS:
        print(f"\n▶ {t.__name__}")
        try:
            t()
            passed += 1
        except Exception as exc:
            fail(t.__name__, str(exc))
            failed += 1

    print("\n" + "=" * 60)
    print(f"  {passed} passed  |  {failed} failed")
    print("=" * 60 + "\n")
    sys.exit(0 if failed == 0 else 1)
