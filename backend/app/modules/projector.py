"""Project high-dimensional embeddings into 3D and assign cluster labels."""

import logging
from typing import List, Dict, Any

import numpy as np
import umap
from sklearn.preprocessing import StandardScaler

from app.config import UMAP_MIN_DIST, UMAP_NEIGHBORS, UMAP_RANDOM_STATE

logger = logging.getLogger(__name__)


def project_3d(embeddings: np.ndarray) -> np.ndarray:
    """Reduce embeddings to 3D coordinates."""
    n_samples = embeddings.shape[0]
    if n_samples == 0:
        return np.zeros((0, 3))
    if n_samples < 3:
        # Pad with zeros if too few samples for UMAP
        return np.zeros((n_samples, 3))

    n_neighbors = min(UMAP_NEIGHBORS, n_samples - 1)
    min_dist = max(UMAP_MIN_DIST, 0.01)

    logger.info("Running UMAP projection: n_samples=%d, n_neighbors=%d", n_samples, n_neighbors)
    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        n_components=3,
        random_state=UMAP_RANDOM_STATE,
        metric="cosine",
    )
    scaled = StandardScaler().fit_transform(embeddings)
    coords = reducer.fit_transform(scaled)
    return coords


def _cluster(coords: np.ndarray, min_cluster_size: int = 5) -> np.ndarray:
    """Assign HDBSCAN cluster labels."""
    try:
        import hdbscan
        n_samples = coords.shape[0]
        if n_samples < min_cluster_size:
            return np.full(n_samples, -1)
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=min(min_cluster_size, n_samples),
            metric="euclidean",
        )
        return clusterer.fit_predict(coords)
    except Exception as exc:
        logger.warning("HDBSCAN clustering failed: %s", exc)
        return np.full(coords.shape[0], -1)


def build_snapshot(
    pages: List[Dict[str, Any]],
    coords: np.ndarray,
    country: str,
    country_code: str,
) -> Dict[str, Any]:
    """Create the JSON snapshot used by the frontend."""
    labels = _cluster(coords)
    points = []
    for i, page in enumerate(pages):
        x, y, z = coords[i].tolist()
        points.append({
            "id": i,
            "keyword": page.get("keyword", ""),
            "title": page.get("title", ""),
            "url": page.get("url", ""),
            "summary": page.get("summary", ""),
            "source": page.get("source", ""),
            "x": float(x),
            "y": float(y),
            "z": float(z),
            "cluster": int(labels[i]),
        })

    # Center the cloud at origin
    if points:
        xs = [p["x"] for p in points]
        ys = [p["y"] for p in points]
        zs = [p["z"] for p in points]
        cx, cy, cz = sum(xs) / len(xs), sum(ys) / len(ys), sum(zs) / len(zs)
        for p in points:
            p["x"] -= cx
            p["y"] -= cy
            p["z"] -= cz

    return {
        "country": country,
        "country_code": country_code,
        "point_count": len(points),
        "points": points,
    }
