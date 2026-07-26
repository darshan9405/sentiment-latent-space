"""Async fetch and extract readable text from discovered URLs."""

import asyncio
import hashlib
import json
import logging
import os
from typing import Dict, Any, List
from urllib.parse import urlparse

import aiofiles
import httpx
from trafilatura import extract

from app.config import (
    CACHE_DIR,
    FETCH_TIMEOUT,
    MAX_CONCURRENT_FETCHES,
    SUMMARY_MIN_CHARS,
    USER_AGENT,
)

logger = logging.getLogger(__name__)


def _cache_path(url: str) -> str:
    digest = hashlib.sha256(url.encode()).hexdigest()
    return str(CACHE_DIR / f"{digest}.json")


async def _load_cache(url: str) -> Dict[str, Any] | None:
    path = _cache_path(url)
    if not os.path.exists(path):
        return None
    try:
        async with aiofiles.open(path, "r", encoding="utf-8") as f:
            content = await f.read()
        return json.loads(content)
    except Exception as exc:
        logger.debug("Cache read failed for %s: %s", url, exc)
        return None


async def _save_cache(url: str, payload: Dict[str, Any]) -> None:
    path = _cache_path(url)
    try:
        async with aiofiles.open(path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(payload, ensure_ascii=False))
    except Exception as exc:
        logger.debug("Cache write failed for %s: %s", url, exc)


async def _fetch_one(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    result: Dict[str, Any],
) -> Dict[str, Any]:
    url = result["url"]
    title = result.get("title", "")
    snippet = result.get("snippet", "")
    keyword = result.get("keyword", "")

    # Try cache first
    cached = await _load_cache(url)
    if cached:
        cached["keyword"] = keyword
        cached["source"] = "cache"
        return cached

    async with semaphore:
        try:
            resp = await client.get(
                url,
                follow_redirects=True,
                timeout=FETCH_TIMEOUT,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
            )
            resp.raise_for_status()
            html = resp.text
        except Exception as exc:
            logger.debug("Fetch failed for %s: %s", url, exc)
            # Fallback to snippet if fetch fails
            return {
                "keyword": keyword,
                "title": title,
                "url": url,
                "text": snippet,
                "source": "snippet",
                "status": "fetch_failed",
            }

    try:
        text = extract(html, include_comments=False, include_tables=False, deduplicate=True)
        if not text:
            text = snippet
    except Exception as exc:
        logger.debug("Extraction failed for %s: %s", url, exc)
        text = snippet

    payload = {
        "keyword": keyword,
        "title": title,
        "url": url,
        "text": text or snippet,
        "source": "page" if text else "snippet",
        "status": "ok" if text else "extraction_failed",
    }
    await _save_cache(url, payload)
    return payload


async def fetch_pages(
    search_results: List[Dict[str, Any]],
    max_concurrent: int = MAX_CONCURRENT_FETCHES,
) -> List[Dict[str, Any]]:
    """Fetch and extract content for each search result concurrently."""
    if not search_results:
        return []

    # Remove duplicate URLs
    seen_urls = set()
    unique = []
    for item in search_results:
        url = item.get("url")
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique.append(item)

    semaphore = asyncio.Semaphore(max_concurrent)
    limits = httpx.Limits(max_connections=max_concurrent * 2, max_keepalive_connections=max_concurrent)
    async with httpx.AsyncClient(limits=limits) as client:
        tasks = [_fetch_one(client, semaphore, item) for item in unique]
        pages = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    for page in pages:
        if isinstance(page, Exception):
            logger.warning("Page fetch task raised exception: %s", page)
            continue
        text = page.get("text", "")
        if text and len(text) >= SUMMARY_MIN_CHARS:
            results.append(page)
        elif text:
            results.append(page)
    return results
