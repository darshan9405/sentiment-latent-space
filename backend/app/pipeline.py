"""End-to-end pipeline: trends → URLs → pages → summaries → embeddings → 3D snapshot."""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, Any, List

from app.config import (
    COUNTRY_CODE,
    COUNTRY_NAME,
    MAX_PAGES_PER_KEYWORD,
    MAX_TRENDS,
    SNAPSHOT_FILE,
)
from app.modules.discovery import discover_urls
from app.modules.embedder import embed_pages
from app.modules.page_fetcher import fetch_pages
from app.modules.projector import build_snapshot, project_3d
from app.modules.summarizer import summarize_pages
from app.modules.trends_fetcher import fetch_trending_keywords

logger = logging.getLogger(__name__)


async def _process_keyword(keyword: str, max_pages: int) -> List[Dict[str, Any]]:
    """Discover URLs, fetch pages, and summarize for a single keyword."""
    logger.info("Processing keyword: %s", keyword)
    search_results = discover_urls(keyword, max_results=max_pages)
    if not search_results:
        logger.warning("No search results for keyword: %s", keyword)
        return []
    pages = await fetch_pages(search_results)
    if not pages:
        logger.warning("No fetchable pages for keyword: %s", keyword)
        return []
    return summarize_pages(pages)


async def run_pipeline() -> Dict[str, Any]:
    """Run the full pipeline and return a snapshot."""
    logger.info("Starting pipeline run at %s", datetime.now(timezone.utc).isoformat())

    keywords = fetch_trending_keywords(country_code=COUNTRY_CODE, max_results=MAX_TRENDS)
    logger.info("Fetched %d trending keywords: %s", len(keywords), keywords)

    if not keywords:
        raise RuntimeError("No trending keywords fetched.")

    # Process each keyword (sequentially is polite; could be parallelized)
    all_pages: List[Dict[str, Any]] = []
    for keyword in keywords:
        pages = await _process_keyword(keyword, MAX_PAGES_PER_KEYWORD)
        all_pages.extend(pages)
        await asyncio.sleep(0.5)

    if not all_pages:
        raise RuntimeError("No pages could be fetched or summarized.")

    logger.info("Summarized %d pages total", len(all_pages))

    embeddings = embed_pages(all_pages)
    coords = project_3d(embeddings)
    snapshot = build_snapshot(all_pages, coords, country=COUNTRY_NAME, country_code=COUNTRY_CODE)

    # Attach metadata
    snapshot["generated_at"] = datetime.now(timezone.utc).isoformat()
    snapshot["keywords"] = keywords
    snapshot["country"] = COUNTRY_NAME
    snapshot["country_code"] = COUNTRY_CODE

    # Persist
    with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2)
    logger.info("Snapshot saved to %s (%d points)", SNAPSHOT_FILE, snapshot["point_count"])

    return snapshot


def load_snapshot() -> Dict[str, Any]:
    """Load the latest snapshot from disk."""
    if not os.path.exists(SNAPSHOT_FILE):
        return {
            "country": COUNTRY_NAME,
            "country_code": COUNTRY_CODE,
            "point_count": 0,
            "points": [],
            "generated_at": None,
            "keywords": [],
        }
    with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)
