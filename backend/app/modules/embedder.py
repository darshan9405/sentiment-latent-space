"""Compute dense embeddings for page summaries."""

import logging
from typing import List, Dict, Any, Optional

import numpy as np
from sentence_transformers import SentenceTransformer

from app.config import EMBEDDING_MODEL

logger = logging.getLogger(__name__)


class Embedder:
    """Singleton sentence-transformers embedder."""

    _instance: Optional["Embedder"] = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, model_name: Optional[str] = None):
        if self._initialized:
            return
        self.model_name = model_name or EMBEDDING_MODEL
        self._model = None
        self._initialized = True

    def _load(self):
        if self._model is not None:
            return
        logger.info("Loading embedding model: %s", self.model_name)
        self._model = SentenceTransformer(self.model_name)

    def encode(self, texts: List[str]) -> np.ndarray:
        self._load()
        if not texts:
            return np.zeros((0, self._model.get_sentence_embedding_dimension()))
        return self._model.encode(texts, convert_to_numpy=True, show_progress_bar=False)

    def embed_pages(self, pages: List[Dict[str, Any]]) -> np.ndarray:
        texts = []
        for p in pages:
            text = p.get("summary") or p.get("text") or p.get("title", "")
            if not text.strip():
                text = p.get("keyword", "")
            texts.append(text)
        return self.encode(texts)


def embed_pages(pages: List[Dict[str, Any]]) -> np.ndarray:
    return Embedder().embed_pages(pages)
