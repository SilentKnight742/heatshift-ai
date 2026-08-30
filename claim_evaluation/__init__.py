"""Independent claim-evaluation tools for HeatShift AI.

This package deliberately does not import the production ``app`` package.  It
is an evaluator-owned implementation of the published policy and scheduling
rules, suitable for differential and black-box checks.
"""

from .oracle import (
    assess_schedule,
    calculate_metrics,
    normalize_capture,
    optimize_greedy,
    score_segment,
    validate_schedule,
)

__all__ = [
    "assess_schedule",
    "calculate_metrics",
    "normalize_capture",
    "optimize_greedy",
    "score_segment",
    "validate_schedule",
]
