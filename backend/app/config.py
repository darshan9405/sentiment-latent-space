import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

SNAPSHOT_FILE = DATA_DIR / "snapshot.json"
CACHE_DIR = DATA_DIR / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# Pipeline settings
COUNTRY_CODE = os.getenv("COUNTRY_CODE", "IN")
COUNTRY_NAME = os.getenv("COUNTRY_NAME", "India")
MAX_TRENDS = int(os.getenv("MAX_TRENDS", "20"))           # top N trending keywords
MAX_PAGES_PER_KEYWORD = int(os.getenv("MAX_PAGES_PER_KEYWORD", "12"))  # URLs to fetch per keyword
SUMMARY_MAX_TOKENS = int(os.getenv("SUMMARY_MAX_TOKENS", "80"))
SUMMARY_MIN_CHARS = int(os.getenv("SUMMARY_MIN_CHARS", "40"))
UMAP_NEIGHBORS = int(os.getenv("UMAP_NEIGHBORS", "15"))
UMAP_MIN_DIST = float(os.getenv("UMAP_MIN_DIST", "0.1"))
UMAP_RANDOM_STATE = int(os.getenv("UMAP_RANDOM_STATE", "42"))
PIPELINE_INTERVAL_HOURS = float(os.getenv("PIPELINE_INTERVAL_HOURS", "6"))

# Embedding model
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

# OpenCode Zen summarization settings
ZEN_API_KEY = os.getenv("ZEN_API_KEY", "")
ZEN_BASE_URL = os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1")
ZEN_MODEL = os.getenv("ZEN_MODEL", "gpt-5.4-nano")

# Concurrency / politeness
MAX_CONCURRENT_FETCHES = int(os.getenv("MAX_CONCURRENT_FETCHES", "5"))
FETCH_TIMEOUT = float(os.getenv("FETCH_TIMEOUT", "15"))
USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# API
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
