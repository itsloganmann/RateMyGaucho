# RateMyGaucho (Chrome Extension)

RateMyGaucho enhances UCSB GOLD to 1,200+ students per month by showing professor ratings and course data directly on course result pages. It works offline and preserves your privacy by using a local dataset.

**Demo Video**: https://www.youtube.com/watch?v=fl7-icSAves

## Novel Features

*   **Offline & Private**: Works without an internet connection and never sends your data to external servers. All data lives in a single packaged CSV (`courses_final_enrollment.csv`).
*   **Gaucho-Themed Ratings**: Displays professor ratings with custom, partially-filled Gaucho star icons for at-a-glance assessments.
*   **In-Depth Course Data**: Goes beyond professor ratings to show course-specific details like grading trends, enrollment history, and recent student reviews.
*   **Visual Summaries**: Inline bar charts translate grade distributions and historic enrollment snapshots into easy-to-interpret visuals.
*   **Smart Review Filtering**: Intelligently filters reviews to show only those relevant to the specific instructor, providing more accurate insights.
*   **UCSB Plat Integration**: Provides direct links to professor profiles and curriculum pages on UCSB Plat.

## Installation

1.  Download the latest release from the [Releases page](https://github.com/itsloganmann/RateMyGaucho/releases).
2.  Extract the ZIP file.
3.  Open Chrome, go to `chrome://extensions`, and enable "Developer mode".
4.  Click "Load unpacked" and select the extracted folder.

## Building

To create a distributable ZIP file, run the appropriate script for your OS:
*   **Windows**: `./scripts/package.ps1`
*   **macOS/Linux**: `bash ./scripts/package.sh`

The build script bundles the unified dataset and content script into `dist/RateMyGaucho.zip`, which is ready to upload to the Chrome Web Store.

## Data Source

The extension ships with `courses_final_enrollment.csv` as its only data source. Every rating, review, and course record comes from this file, ensuring consistent results across the UI. When updating data, replace this CSV and rebuild the package.

---

## Backend Architecture

The `backend/` directory contains a production-grade Python API that powers search, analytics, and data ingestion.

### Tech Stack

| Layer | Technology |
|---|---|
| **API** | Python 3.12 · FastAPI · Pydantic v2 |
| **Database** | PostgreSQL 16 (SQLAlchemy ORM, connection pooling) |
| **Search** | Elasticsearch 8.17 (full-text, fuzzy matching, filters) |
| **Cache** | Redis 7 (cache-aside, 300 s TTL, 128 MB LRU) |
| **Messaging** | Apache Kafka 3.8 KRaft (no ZooKeeper) |
| **Observability** | OpenTelemetry → Jaeger (distributed tracing) |
| **Orchestration** | Docker Compose (all services with health checks) |

### Key Components

- **ETL Pipeline** (`app/etl.py`) — Reads the CSV, normalises into `Department → Professor → Course → Review` tables in Postgres, bulk-indexes into Elasticsearch, and publishes Kafka events.
- **Elasticsearch Service** (`app/es_service.py`) — Index management, multi-match search with fuzziness, department/GPA/professor filters.
- **Redis Cache** (`app/cache.py`) — JSON cache-aside pattern reducing median latency from ~650 ms to ~180 ms.
- **Kafka Producer / Consumer** (`app/kafka_producer.py`, `app/kafka_consumer.py`) — Event-driven pipeline; the consumer upserts into Postgres + ES on `course.created` / `course.updated` events.
- **REST API** (`app/routes.py`) — `/search/courses`, `/search/reviews`, `/courses`, `/analytics`, `/health`
- **Tracing** (`app/tracing.py`) — Auto-instruments FastAPI, SQLAlchemy, Redis, and Elasticsearch via OTLP → Jaeger.

### Quick Start

```bash
# From the repo root
docker compose up --build -d

# API at http://localhost:8000
# Jaeger UI at http://localhost:16686
# Elasticsearch at http://localhost:9200
```

### API Examples

```bash
# Health check
curl http://localhost:8000/api/v1/health

# Search courses
curl -X POST http://localhost:8000/api/v1/search/courses \
  -H 'Content-Type: application/json' \
  -d '{"query": "machine learning", "department": "CMPSC"}'

# Analytics
curl http://localhost:8000/api/v1/analytics
```

### Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest
```

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request.

## License

MIT © 2025
