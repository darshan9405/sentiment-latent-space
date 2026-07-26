# Internet Sentiment Latent Space

A 3D visualization of trending internet topics projected into semantic latent space. The pipeline fetches real-time trending keywords from Google Trends, discovers related web content, summarizes it using LLM, generates sentence embeddings, and projects them into a 3D interactive visualization using UMAP + HDBSCAN.

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌────────────┐    ┌──────────┐    ┌──────────┐
│   Google    │    │  DuckDuckGo  │    │   HTTP      │    │   LLM      │    │  384-dim  │    │  3D +    │
│   Trends    │───▶│  Search      │───▶│   Fetch     │───▶│  Summarize  │───▶│  Embed    │───▶│  Cluster │
│  (trendspyg)│    │  (scraper)   │    │  (trafilatura)│   │ (Zen API)  │    │(MiniLM-L6)│    │(UMAP+HDB)│
└─────────────┘    └──────────────┘    └─────────────┘    └────────────┘    └──────────┘    └──────────┘
                                                                                              │
                                                                                              ▼
                                                                                     ┌─────────────────┐
                                                                                     │   Three.js 3D   │
                                                                                     │   Frontend      │
                                                                                     └─────────────────┘
```

### Pipeline Steps

1. **Trends Fetcher** (`trends_fetcher.py`) — Fetches real-time trending keywords from Google Trends RSS feed via `trendspyg`
2. **Discovery** (`discovery.py`) — Searches each keyword on DuckDuckGo HTML search and returns top result URLs
3. **Page Fetcher** (`page_fetcher.py`) — Concurrently fetches pages with `httpx` and extracts readable content using `trafilatura`
4. **Summarizer** (`summarizer.py`) — Summarizes each page via OpenCode Zen LLM API (falls back to extractive summary)
5. **Embedder** (`embedder.py`) — Converts summaries into 384-dimensional vectors using `all-MiniLM-L6-v2`
6. **Projector** (`projector.py`) — Reduces embeddings to 3D with UMAP (cosine distance), clusters with HDBSCAN, assembles JSON snapshot
7. **Frontend** — Three.js interactive 3D scatter plot with hover tooltips, orbit controls, and pipeline trigger

## Setup

### Prerequisites

- Python 3.10+
- [OpenCode Zen API key](https://opencode.ai/zen) (for LLM summarization)

### Installation

```bash
# Clone the repository
cd sentiment-latent-space

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your OpenCode Zen API key
```

### Configuration

| Variable | Default | Description |
|---|---|---|
| `ZEN_API_KEY` | — | OpenCode Zen API key for LLM summarization |
| `ZEN_MODEL` | `gpt-5.4-nano` | LLM model for summarization |
| `ZEN_BASE_URL` | `https://opencode.ai/zen/v1` | Zen API base URL |
| `COUNTRY_CODE` | `IN` | ISO country code for trending topics |
| `COUNTRY_NAME` | `India` | Display name for the country |
| `MAX_TRENDS` | `20` | Number of trending keywords to process |
| `MAX_PAGES_PER_KEYWORD` | `12` | URLs to fetch per keyword |
| `PIPELINE_INTERVAL_HOURS` | `6` | Auto-refresh interval (applied on restart) |

## Usage

### Start the server

```bash
./start.sh
```

Or manually:

```bash
source venv/bin/activate
python backend/main.py
```

The server starts at `http://localhost:8000`.

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Frontend 3D visualization |
| `GET` | `/api/snapshot?country=IN` | Latest snapshot data (JSON) |
| `POST` | `/api/run-pipeline` | Manually trigger the pipeline |
| `GET` | `/api/health` | Health check with snapshot metadata |
| `GET` | `/api/countries` | List supported countries |
| `GET` | `/docs` | Swagger UI |

### Frontend Controls

- **Drag** — Rotate the 3D scene
- **Scroll** — Zoom in/out
- **Hover** — View keyword, title, summary, and URL
- **Click** — Open the source URL
- **Refresh Snapshot** — Triggers a full pipeline run

## Snapshot Format

```json
{
  "country": "India",
  "country_code": "IN",
  "point_count": 127,
  "generated_at": "2026-07-26T08:25:52.708868+00:00",
  "keywords": ["cricket", "monsoon", "budget 2026", ...],
  "points": [
    {
      "id": 0,
      "keyword": "cricket world cup",
      "title": "ICC World Cup 2026 Schedule",
      "url": "https://example.com/article",
      "summary": "The ICC Cricket World Cup 2026...",
      "source": "page",
      "x": -2.34, "y": 1.56, "z": 0.78,
      "cluster": 2
    }
  ]
}
```

Points with `cluster: -1` are considered noise/outliers by HDBSCAN.

## Tech Stack

| Component | Technology |
|---|---|
| Framework | FastAPI + Uvicorn |
| Embeddings | sentence-transformers (`all-MiniLM-L6-v2`) |
| Dimensionality Reduction | UMAP (cosine metric) |
| Clustering | HDBSCAN |
| Web Scraping | curl_cffi + BeautifulSoup |
| Text Extraction | trafilatura |
| LLM | OpenCode Zen API |
| Trends | trendspyg (Google Trends RSS) |
| Visualization | Three.js + OrbitControls |
| Async HTTP | httpx + aiohttp |
