from __future__ import annotations

import asyncio

from app.services.analysis_service import AnalysisService


def test_optimizer_preserves_constraints_and_reduces_exposure() -> None:
    service = AnalysisService()
    result = asyncio.run(service.run_demo())
    original = {item.task_id: item for item in result.baseline_schedule}
    optimized = {item.task_id: item for item in result.optimized_schedule}
    tasks = {task.task_id: task for task in result.tasks}

    for task_id, baseline in original.items():
        if not baseline.movable:
            assert optimized[task_id].start == baseline.start

    for task in tasks.values():
        for dependency_id in task.dependencies:
            assert optimized[task.task_id].start >= optimized[dependency_id].end

    items = list(optimized.values())
    for index, left in enumerate(items):
        for right in items[index + 1 :]:
            if left.crew_id == right.crew_id:
                assert left.end <= right.start or right.end <= left.start

    assert result.metrics.baseline_exposed_worker_minutes == 1230
    assert result.metrics.optimized_exposed_worker_minutes == 270
    assert result.metrics.exposure_reduction_percent == 78.0
    assert result.metrics.productivity_retained_percent == 100.0

