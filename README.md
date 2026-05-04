# GitHub Activity Analytics

A full-stack GitHub activity analytics dashboard built with FastAPI, Next.js, PostgreSQL, Docker, and Azure Container Apps.

It ingests live GitHub repository data, stores commit history, and provides interactive analytics including time-series charts, repo management actions such as pin, pause, and delete, and repository search.

## What It Does

- Ingests GitHub repository data via the GitHub REST API
- Stores repositories, users, and commits in PostgreSQL
- Computes commit metrics, including total commits, 7-day activity, and 30-day activity
- Generates time-series commit analytics
- Supports interactive repository management:
  - Pin repositories
  - Pause repositories
  - Delete repositories
- Provides search and filtering for tracked repositories
- Includes adjustable ingestion controls such as `per_page` and `max_pages`

## Architecture

### Frontend

- Next.js 16 with App Router
- Recharts for data visualization
- Tailwind CSS for styling

### Backend

- FastAPI
- SQLAlchemy Core
- PostgreSQL with Azure Flexible Server
- GitHub API integration
- RESTful API design

### Infrastructure

- Docker with multi-stage builds
- Azure Container Apps
- Azure Container Registry

## Core API Endpoints

### Ingestion

POST /ingest/repo?full_name=owner/repo&per_page=30&max_pages=1

### Analytics

GET /api/summary  
GET /api/timeseries?days=30  
GET /api/repos?search=...

### Repository Management

PATCH /api/repos/{full_name}/pin?is_pinned=true|false  
PATCH /api/repos/{full_name}/active?is_active=true|false  
DELETE /api/repos/{full_name}

## Project Highlights

This project demonstrates full-stack system design, API architecture, database modeling and indexing, external API ingestion, production cloud deployment, and DevOps workflow using Docker and Azure.

## Future Improvements

- GitHub OAuth authentication
- Background job queue for large ingestions
- Rate-limit aware batching
- Redis caching layer
- CI/CD pipeline
- Custom domain with HTTPS certificate


