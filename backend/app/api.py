"""FastAPI app serving the latent-space snapshot and frontend."""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Dict, Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import API_PORT, BASE_DIR, COUNTRY_CODE, COUNTRY_NAME, PIPELINE_INTERVAL_HOURS, SNAPSHOT_FILE
from app.pipeline import load_snapshot, run_pipeline

logger = logging.getLogger(__name__)


# Scheduler is intentionally lazy; the real production scheduler is cron/Cloud Scheduler.
# We include a simple background task for local dev.
_pipeline_task = None


async def _scheduled_pipeline():
    """Background loop that refreshes the snapshot every N hours."""
    import asyncio
    while True:
        try:
            logger.info("[scheduler] Running scheduled pipeline")
            await run_pipeline()
        except Exception as exc:
            logger.exception("[scheduler] Pipeline failed: %s", exc)
        await asyncio.sleep(PIPELINE_INTERVAL_HOURS * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _pipeline_task
    _pipeline_task = None
    logger.info("FastAPI starting up")
    # Optionally run immediately if no snapshot exists
    if not os.path.exists(str(SNAPSHOT_FILE)):
        try:
            await run_pipeline()
        except Exception as exc:
            logger.exception("Initial pipeline run failed: %s", exc)
    yield
    logger.info("FastAPI shutting down")


app = FastAPI(
    title="Internet Sentiment Latent Space",
    description="3D visualization of trending internet topics projected into latent space.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files from project root
frontend_dir = BASE_DIR.parent.parent / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")


@app.get("/")
async def root():
    if frontend_dir.exists():
        return FileResponse(str(frontend_dir / "index.html"))
    return {"message": "Internet Sentiment Latent Space API", "docs": "/docs"}


@app.get("/api/snapshot")
async def get_snapshot(country: str = Query(default=COUNTRY_CODE, description="ISO country code")):
    """Return the latest precomputed snapshot for the requested country."""
    snapshot = load_snapshot()
    if snapshot.get("country_code", COUNTRY_CODE).upper() != country.upper():
        raise HTTPException(
            status_code=404,
            detail=f"No snapshot available for country={country}. Currently serving {COUNTRY_NAME}.",
        )
    return JSONResponse(content=snapshot)


@app.post("/api/run-pipeline")
async def trigger_pipeline() -> Dict[str, Any]:
    """Manually trigger the pipeline. Useful for demo/development."""
    try:
        snapshot = await run_pipeline()
        return {"status": "ok", "generated_at": snapshot.get("generated_at"), "point_count": snapshot.get("point_count")}
    except Exception as exc:
        logger.exception("Manual pipeline trigger failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/health")
async def health():
    snapshot = load_snapshot()
    generated_at = snapshot.get("generated_at")
    age_hours = None
    if generated_at:
        try:
            then = datetime.fromisoformat(generated_at)
            age_hours = (datetime.now(timezone.utc) - then).total_seconds() / 3600
        except Exception:
            pass
    return {
        "status": "ok",
        "country": COUNTRY_NAME,
        "country_code": COUNTRY_CODE,
        "point_count": snapshot.get("point_count", 0),
        "generated_at": generated_at,
        "age_hours": age_hours,
    }


@app.get("/api/countries")
async def countries():
    """List currently supported countries. India only for MVP."""
    return {
        "countries": [
            {"code": "IN", "name": "India"},
        ],
        "selected": COUNTRY_CODE,
    }
