"""Discover top result URLs for a keyword using DuckDuckGo HTML search."""

import logging
import time
from typing import Dict, Any, List
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests

from app.config import FETCH_TIMEOUT, USER_AGENT

logger = logging.getLogger(__name__)


BLOCKED_DOMAINS = {
    "youtube.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "instagram.com",
    "tiktok.com",
    "pinterest.com",
    "linkedin.com",
}


def _is_blocked(url: str) -> bool:
    lower = url.lower()
    return any(domain in lower for domain in BLOCKED_DOMAINS)


def _extract_result_url(link_tag) -> str | None:
    """Extract the real URL from a DuckDuckGo result anchor."""
    if not link_tag:
        return None
    href = link_tag.get("href", "")
    if href.startswith("http://") or href.startswith("https://"):
        return href
    # DDG wraps results in /duckduckgo.com/l/?uddg=...
    if "uddg=" in href:
        for part in href.split("&"):
            if part.startswith("uddg="):
                return unquote(part[5:])
        # handle uddg= right after ?
        if href.startswith("//duckduckgo.com/l/?uddg="):
            return unquote(href.split("uddg=")[1].split("&")[0])
    return None


def _discover_ddg_html(keyword: str, max_results: int) -> List[Dict[str, Any]]:
    """Scrape DuckDuckGo HTML search results using curl-impersonate."""
    results = []
    url = f"https://html.duckduckgo.com/html/?q={keyword.replace(' ', '+')}"
    try:
        resp = curl_requests.get(
            url,
            impersonate="chrome",
            timeout=FETCH_TIMEOUT,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("DuckDuckGo HTML request failed for '%s': %s", keyword, exc)
        return results

    soup = BeautifulSoup(resp.text, "html.parser")
    # DDG HTML results are in .result containers
    for result in soup.select(".result"):
        if len(results) >= max_results:
            break
        a = result.select_one(".result__a") or result.select_one("a")
        if not a:
            continue
        href = _extract_result_url(a)
        if not href or _is_blocked(href):
            continue
        title = a.get_text(strip=True)
        snippet = ""
        snippet_tag = result.select_one(".result__snippet")
        if snippet_tag:
            snippet = snippet_tag.get_text(strip=True)
        results.append({
            "keyword": keyword,
            "title": title,
            "url": href,
            "snippet": snippet,
        })

    return results


def discover_urls(keyword: str, max_results: int = 12) -> List[Dict[str, Any]]:
    """Return a list of result dicts with title, href, and body snippet."""
    results = _discover_ddg_html(keyword, max_results)
    if not results:
        # Retry once with a small delay
        time.sleep(1.5)
        results = _discover_ddg_html(keyword, max_results)
    return results
