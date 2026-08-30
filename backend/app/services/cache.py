from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from ..models.analysis import AnalysisJob, AnalysisResult, AnalysisStatus


class AnalysisStore:
    """Small in-memory job store; demo analyses are reproducible after restarts."""

    def __init__(self):
        self._jobs: dict[str, AnalysisJob] = {}
        self._lock = asyncio.Lock()

    async def create(self, analysis_id: str) -> AnalysisJob:
        async with self._lock:
            job = AnalysisJob(
                analysis_id=analysis_id,
                status=AnalysisStatus.QUEUED,
                created_at=datetime.now(timezone.utc),
            )
            self._jobs[analysis_id] = job
            return job

    async def update_status(self, analysis_id: str, status: AnalysisStatus) -> None:
        async with self._lock:
            self._jobs[analysis_id].status = status

    async def complete(self, analysis_id: str, result: AnalysisResult) -> None:
        async with self._lock:
            job = self._jobs[analysis_id]
            job.status = AnalysisStatus.COMPLETED
            job.result = result

    async def fail(self, analysis_id: str, error: str) -> None:
        async with self._lock:
            job = self._jobs[analysis_id]
            job.status = AnalysisStatus.FAILED
            job.error = error

    async def get(self, analysis_id: str) -> AnalysisJob | None:
        return self._jobs.get(analysis_id)


analysis_store = AnalysisStore()

