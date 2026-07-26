#!/usr/bin/env python3
"""Entry point for the FastAPI backend."""

import logging
import sys
from pathlib import Path

# Load environment variables from project root .env file
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=str(env_path))

# Ensure backend/app is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn
from app.config import API_HOST, API_PORT

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

if __name__ == "__main__":
    uvicorn.run("app.api:app", host=API_HOST, port=API_PORT, reload=False)
