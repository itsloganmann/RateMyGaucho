"""OpenTelemetry tracing bootstrap – instruments FastAPI, SQLAlchemy, Redis, ES."""

import logging
from app.config import get_settings

logger = logging.getLogger(__name__)


def setup_tracing():
    """Initialise OpenTelemetry with OTLP exporter pointed at Jaeger."""
    settings = get_settings()
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

        resource = Resource.create({"service.name": settings.service_name})
        provider = TracerProvider(resource=resource)

        exporter = OTLPSpanExporter(endpoint=settings.otlp_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        # Auto-instrument libraries
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.instrumentation.redis import RedisInstrumentor
        from opentelemetry.instrumentation.elasticsearch import ElasticsearchInstrumentor

        SQLAlchemyInstrumentor().instrument()
        RedisInstrumentor().instrument()
        ElasticsearchInstrumentor().instrument()

        logger.info("OpenTelemetry tracing initialised → %s", settings.otlp_endpoint)
        return FastAPIInstrumentor
    except Exception as exc:
        logger.warning("Tracing setup failed (non-fatal): %s", exc)
        return None
