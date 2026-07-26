"""Summarization of page content using the OpenCode Zen cloud API."""

import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx

from app.config import ZEN_API_KEY, ZEN_BASE_URL, ZEN_MODEL

logger = logging.getLogger(__name__)

MAX_CHARS = 4000


def _first_sentence(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return parts[0] if parts else text.strip()


def _extractive_summary(page: Dict[str, Any]) -> str:
    title = page.get("title", "")
    text = page.get("text", "") or page.get("snippet", "")
    keyword = page.get("keyword", "")
    first = _first_sentence(text)
    if title and first:
        return f"{title}: {first}"
    if title:
        return title
    if first:
        return first
    return f"Trending topic: {keyword}."


def _truncate(text: str, limit: int = MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0]


def _call_zen(prompt: str) -> str:
    if not ZEN_API_KEY:
        raise RuntimeError("ZEN_API_KEY is not set")

    client = httpx.Client(
        base_url=ZEN_BASE_URL,
        timeout=120.0,
        headers={"Authorization": f"Bearer {ZEN_API_KEY}", "Content-Type": "application/json"},
    )
    response = client.post(
        "/chat/completions",
        json={
            "model": ZEN_MODEL,
            "messages": [
                {"role": "system", "content": "You are a helpful summarizer."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 80,
        },
    )
    response.raise_for_status()
    data = response.json()

    # Standard OpenAI chat-completion response format
    choices = data.get("choices", [])
    if choices and "message" in choices[0]:
        return choices[0]["message"].get("content", "").strip()
    if choices and "text" in choices[0]:
        return choices[0]["text"].strip()
    return ""


def summarize_page(page: Dict[str, Any]) -> Dict[str, Any]:
    """Return a page dict enriched with a cloud-generated summary."""
    keyword = page.get("keyword", "")
    title = page.get("title", "")
    text = page.get("text", "") or page.get("snippet", "")

    if not text.strip() or not ZEN_API_KEY:
        return {**page, "summary": _extractive_summary(page)}

    prompt = (
        "Summarize the following web page in one short sentence, "
        "including the sentiment if it is clearly positive or negative.\n\n"
        f"Topic: {keyword}\n"
        f"Title: {title}\n"
        f"Text: {_truncate(text)}\n\n"
        "Summary:"
    )

    try:
        summary = _call_zen(prompt)
        if len(summary) < 20:
            summary = _extractive_summary(page)
        return {**page, "summary": summary}
    except Exception as exc:
        logger.warning("Zen summarization failed for %s: %s", page.get("url", ""), exc)
        return {**page, "summary": _extractive_summary(page)}


def summarize_pages(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [summarize_page(p) for p in pages]
