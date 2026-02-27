"""FastAPI application factory and startup hooks."""

import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.es_service import ensure_indexes
from app.etl import run_etl
from app.routes import router
from app.tracing import setup_tracing

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks before the app begins serving requests."""
    settings = get_settings()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    # 1. Initialise database tables
    logger.info("Initialising database …")
    init_db()

    # 2. Ensure Elasticsearch indexes exist
    logger.info("Ensuring Elasticsearch indexes …")
    try:
        ensure_indexes()
    except Exception as exc:
        logger.warning("ES index setup deferred: %s", exc)

    # 3. Run ETL pipeline (CSV → Postgres + ES + Kafka)
    logger.info("Running ETL pipeline …")
    try:
        stats = run_etl()
        if stats:
            logger.info("ETL stats: %s", stats)
    except Exception as exc:
        logger.warning("ETL deferred: %s", exc)

    # 4. Set up OpenTelemetry tracing
    logger.info("Configuring tracing …")
    try:
        fastapi_instrumentor = setup_tracing()
        fastapi_instrumentor.instrument_app(app)
    except Exception as exc:
        logger.warning("Tracing setup deferred: %s", exc)

    logger.info("🚀 RateMyGaucho API ready")
    yield

    # Shutdown
    from app.kafka_producer import flush as kafka_flush
    try:
        kafka_flush()
    except Exception:
        pass
    logger.info("RateMyGaucho API shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="RateMyGaucho API",
        description="Course data, professor reviews, and semantic search for UCSB students",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS – allow the Chrome extension & local dev
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api/v1")

    return app


app = create_app()
