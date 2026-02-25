A full-stack GitHub activity analytics dashboard built with FastAPI, Next.js, PostgreSQL, Docker, and Azure Container Apps. It ingests live GitHub repository data, stores commit history, and provides interactive analytics including time-series charts, repo management (pin/pause/delete), and search.

Live Demo
Frontend: https://udp-frontend.kindmoss-b31d02e6.centralus.azurecontainerapps.io/dashboard

What It Does
•	Ingests GitHub repository data via GitHub REST API
•	Stores repos, users, and commits in PostgreSQL
•	Computes commit metrics (total, 7d, 30d)
•	Generates time-series commit analytics
•	Interactive repo management (Pin, Pause, Delete)
•	Search and filter tracked repositories
•	Adjustable ingestion controls (per_page, max_pages)

Architecture
Frontend
•	Next.js 16 (App Router)
•	Recharts for visualization
•	Tailwind CSS for styling
Backend
•	FastAPI
•	SQLAlchemy (Core)
•	PostgreSQL (Azure Flexible Server)
•	GitHub API integration
•	RESTful API design
Infrastructure
•	Docker (multi-stage builds)
•	Azure Container Apps
•	Azure Container Registry

Core API Endpoints
Ingestion:
POST /ingest/repo?full_name=owner/repo&per_page=30&max_pages=1
Analytics:
GET /api/summary
GET /api/timeseries?days=30
GET /api/repos?search=...
Repo Management:
PATCH /api/repos/{full_name}/pin?is_pinned=true|false
PATCH /api/repos/{full_name}/active?is_active=true|false
DELETE /api/repos/{full_name}

This project demonstrates full-stack system design, API architecture, database modeling and indexing, external API ingestion, production cloud deployment, and DevOps workflow using Docker and Azure.

Future Improvements
•	GitHub OAuth authentication
•	Background job queue for large ingestions
•	Rate-limit aware batching
•	Redis caching layer
•	CI/CD pipeline
•	Custom domain with HTTPS certificate


