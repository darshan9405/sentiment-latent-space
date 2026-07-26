"""Fetch trending search keywords from Google Trends for a given country."""

import logging
import re
from typing import List

from app.config import COUNTRY_CODE

logger = logging.getLogger(__name__)


_CLEAN_RE = re.compile(r"[^a-zA-Z0-9_\s\-\'\(\)\.]+")


def _clean_keyword(raw: str) -> str:
    """Strip URL encoding, excessive whitespace, and odd characters."""
    # URL-decode common replacements
    text = raw.replace("+", " ")
    text = text.replace("%20", " ")
    text = _CLEAN_RE.sub("", text)
    text = " ".join(text.split())
    return text.strip()


def _fetch_with_trendspyg(country_code: str, max_results: int) -> List[str]:
    try:
        from trendspyg import download_google_trends_rss
        logger.info("Fetching trends via trendspyg RSS path ...")
        trends = download_google_trends_rss(geo=country_code, output_format="dict", cache=False)
        titles = []
        for item in trends:
            title = item.get("trend")
            if title:
                titles.append(_clean_keyword(str(title)))
        return titles[:max_results]
    except Exception as exc:  # pragma: no cover
        logger.warning("trendspyg failed: %s", exc)
        return []


def fetch_trending_keywords(country_code: str = COUNTRY_CODE, max_results: int = 20) -> List[str]:
    """Return a list of trending keywords for the country."""
    keywords = _fetch_with_trendspyg(country_code, max_results)
    if not keywords:
        logger.warning("No trending keywords found for %s", country_code)
        return []
    seen = set()
    unique = []
    for kw in keywords:
        if kw and kw.lower() not in seen and len(kw) > 2:
            seen.add(kw.lower())
            unique.append(kw)
    return unique[:max_results]
