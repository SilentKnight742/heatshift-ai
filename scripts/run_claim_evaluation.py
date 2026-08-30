#!/usr/bin/env python3
"""Run the independent HeatShift claim audit locally and optionally remotely."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from claim_evaluation.suite import (  # noqa: E402
    audit_public_api,
    audit_repository,
    merge_audits,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Independently recompute HeatShift's operational and HEAT-SHIELD empirical claims."
        )
    )
    parser.add_argument(
        "--remote",
        nargs="?",
        const="https://heatshift-ai-api.vercel.app",
        help="Also audit a public API (default: the documented production URL).",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=3,
        help="Number of complete remote analyses used for determinism checks (default: 3).",
    )
    parser.add_argument(
        "--verify-provider",
        action="store_true",
        help=(
            "Read-only re-fetch all six activity IDs from FortyGuard. Requires "
            "FORTYGUARD_API_KEY and does not submit new activities."
        ),
    )
    parser.add_argument(
        "--json-out",
        type=Path,
        help="Optionally write the complete machine-readable report to this path.",
    )
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be at least 1")

    audits = [audit_repository(ROOT, verify_provider=args.verify_provider)]
    if args.remote:
        audits.append(audit_public_api(ROOT, args.remote, args.repeat))
    report = merge_audits(*audits).report()
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json_out:
        args.json_out.write_text(rendered + "\n")
    return 1 if report["counts"]["FAIL"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
