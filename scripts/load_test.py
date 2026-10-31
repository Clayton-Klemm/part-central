"""Bounded concurrent inspection workload for a local Part Central Docker stack.

This creates labeled synthetic jobs and completed inspections, retaining them for
review. It never deletes or resets data. By default it only targets loopback;
use --allow-remote only for a server you are authorized to load test.

Run from the repository root using the backend environment:
    api/.venv/Scripts/python.exe scripts/load_test.py --users 100
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import platform
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    lower = math.floor(index)
    upper = math.ceil(index)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower), 2)


def arguments():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # Match Compose's IPv4 loopback binding and avoid platform-specific ::1 fallback.
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--users", type=int, default=100, metavar="1..500")
    parser.add_argument("--iterations", type=int, default=1, metavar="1..5")
    parser.add_argument("--part", default="DG-1042")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--allow-remote", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("docs/load-test-shifts-results.json"))
    parser.add_argument("--max-p95-ms", type=float, default=1000, help="Fail if overall or measurement-save p95 exceeds this local regression budget")
    args = parser.parse_args()
    if not 1 <= args.users <= 500:
        parser.error("users must be between 1 and 500")
    if not 1 <= args.iterations <= 5:
        parser.error("iterations must be between 1 and 5")
    target = urlsplit(args.base_url)
    if target.scheme not in {"http", "https"} or not target.hostname or target.path not in {"", "/"} or target.query or target.fragment or target.username or target.password:
        parser.error("base-url must be an HTTP(S) origin without a path, credentials, query, or fragment")
    if target.hostname.lower() not in {"localhost", "127.0.0.1", "::1"} and not args.allow_remote:
        parser.error("remote targets require explicit --allow-remote authorization")
    if not 1 <= args.timeout <= 60:
        parser.error("timeout must be between 1 and 60 seconds")
    if not 1 <= args.max_p95_ms <= 60000:
        parser.error("max-p95-ms must be between 1 and 60000")
    args.base_url = args.base_url.rstrip("/")
    return args


class Recorder:
    def __init__(self):
        self.lock = threading.Lock()
        self.samples = []
        self.failures = []

    def request(self, client, method, path, endpoint, *, expected=200, **kwargs):
        started = time.perf_counter()
        code = 0
        failure = None
        try:
            response = client.request(method, path, **kwargs)
            code = response.status_code
            if code != expected:
                # Do not include response bodies, tokens, or inspection data in reports.
                raise RuntimeError(f"expected HTTP {expected}, received {code}")
            return response.json()
        except Exception as error:
            failure = f"{type(error).__name__}: {error}"
            raise
        finally:
            elapsed = (time.perf_counter() - started) * 1000
            with self.lock:
                self.samples.append((endpoint, elapsed, code, failure is None))
                if failure:
                    self.failures.append({"endpoint": endpoint, "status": code, "error": failure[:240]})

    def report(self):
        by_endpoint = defaultdict(list)
        for endpoint, elapsed, code, passed in self.samples:
            by_endpoint[endpoint].append((elapsed, code, passed))

        def summary(values):
            timings = [entry[0] for entry in values]
            return {
                "requests": len(values),
                "errors": sum(not entry[2] for entry in values),
                "statuses": dict(sorted(Counter(str(entry[1]) for entry in values).items())),
                "p50_ms": percentile(timings, .50),
                "p95_ms": percentile(timings, .95),
                "p99_ms": percentile(timings, .99),
                "max_ms": round(max(timings), 2) if timings else None,
            }
        return {
            "overall": summary([(entry[1], entry[2], entry[3]) for entry in self.samples]),
            "endpoints": {name: summary(values) for name, values in sorted(by_endpoint.items())},
            "failures": self.failures[:50],
        }


def main():
    args = arguments()
    # Readiness and seed validation happen outside the measured concurrent phase.
    with httpx.Client(base_url=args.base_url, timeout=args.timeout, trust_env=False) as client:
        health = client.get("/api/health")
        health.raise_for_status()
        identified = client.post("/api/auth/login", json={"employeeNumber": "9999"})
        identified.raise_for_status()
        if identified.json().get("employeeNumber") != "9999" or identified.json().get("role") != "operator":
            raise SystemExit("Preflight employee identification failed.")
        definition = client.get(f"/api/parts/{args.part}")
        definition.raise_for_status()
        part = definition.json()
    if not part.get("features"):
        raise SystemExit("The selected part must have inspection characteristics.")

    recorder = Recorder()
    gate = threading.Barrier(args.users)
    batch = "LOAD-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid4().hex[:6].upper()
    failures = []
    completed_runs = []
    measured_start = [None]
    start_lock = threading.Lock()

    def workstation(index):
        local_runs = []
        employee_number = f"{1000 + index:04d}"
        with httpx.Client(base_url=args.base_url, timeout=args.timeout, trust_env=False,
                          limits=httpx.Limits(max_connections=2, max_keepalive_connections=2)) as client:
            # Establish each workstation's own server session before starting
            # the measured burst. One failed login releases all waiting peers.
            try:
                identified = client.post("/api/auth/login", json={"employeeNumber": employee_number})
                if identified.status_code != 200 or identified.json().get("employeeNumber") != employee_number or identified.json().get("role") != "operator":
                    raise RuntimeError("Workstation employee identification failed")
                gate.wait(timeout=60)
            except Exception:
                gate.abort()
                raise
            with start_lock:
                if measured_start[0] is None:
                    measured_start[0] = time.perf_counter()
            for iteration in range(args.iterations):
                call = lambda method, path, endpoint, **kwargs: recorder.request(client, method, path, endpoint, **kwargs)
                call("GET", "/api/parts", "GET catalog", params={"q": args.part, "limit": 20})
                detail = call("GET", f"/api/parts/{args.part}", "GET part requirements")
                # Reuse a job across samples to exercise a multi-shift history.
                job = f"{batch}-{index + 1:03d}"
                shift = ("1", "2", "71")[(index + iteration) % 3]
                created = call("POST", "/api/runs", "POST start sheet", expected=201, json={
                    "partRevisionId": detail["revision"]["id"], "operationId": detail["operation"]["id"],
                    "jobNumber": job, "lotNumber": batch, "sampleNumber": f"{iteration + 1:02d}",
                    "inspector": f"Simulated workstation {index + 1:03d}",
                })
                run_id = created["id"]
                if created.get("employeeNumber") != employee_number:
                    raise RuntimeError("Created sheet did not retain the signed-in employee identity")
                for sequence, feature in enumerate(detail["features"]):
                    measurement = call("POST", f"/api/runs/{run_id}/measurements", "POST measurement", expected=201,
                                       json={"featureId": feature["id"], "value": feature["nominal"], "expectedSequence": sequence, "shift": shift})
                    if measurement["status"] != "pass":
                        raise RuntimeError("A nominal reading did not pass")
                    if measurement.get("employeeNumber") != employee_number:
                        raise RuntimeError("Measurement did not retain the signed-in employee identity")
                    if measurement.get("shift") != shift:
                        raise RuntimeError("Measurement did not retain its selected shift")
                finished = call("POST", f"/api/runs/{run_id}/complete", "POST complete sheet", json={"expectedSequence": len(detail["features"]), "shift": shift})
                if finished["status"] != "completed" or finished["overallStatus"] != "pass":
                    raise RuntimeError("Nominal inspection did not complete with a pass")
                if finished.get("completedByEmployeeNumber") != employee_number or finished.get("completedShift") != shift:
                    raise RuntimeError("Completion provenance does not match the signed-in employee and selected shift")
                history = call("GET", "/api/runs", "GET job history summaries", params={"jobNumber": job, "summary": "true", "limit": 20})
                if not isinstance(history, list) or not any(item["id"] == run_id for item in history):
                    raise RuntimeError("Completed inspection missing from job search")
                if len(history) != iteration + 1 or any(item.get("jobNumber") != job for item in history):
                    raise RuntimeError("Exact job history returned an unrelated or missing sample")
                if any("measurements" in item for item in history):
                    raise RuntimeError("History summary unexpectedly contains full measurement events")
                restored = call("GET", f"/api/runs/{run_id}", "GET archived sheet")
                if len(restored["measurements"]) != len(detail["features"]):
                    raise RuntimeError("Restored sheet has an unexpected measurement count")
                if restored.get("employeeNumber") != employee_number or any(value.get("employeeNumber") != employee_number or value.get("shift") != shift for value in restored["measurements"]):
                    raise RuntimeError("Archived sheet lost employee audit identity")
                local_runs.append(run_id)
        return local_runs

    started_at = datetime.now(timezone.utc).isoformat()
    print(f"Running {args.users} simultaneous clients × {args.iterations} inspection cycle(s). Synthetic job prefix: {batch}")
    wall_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.users) as workers:
        futures = {workers.submit(workstation, index): index for index in range(args.users)}
        for future in as_completed(futures):
            try:
                completed_runs.extend(future.result())
            except Exception as error:
                failures.append({"workstation": futures[future] + 1, "error": f"{type(error).__name__}: {error}"[:240]})
    elapsed = time.perf_counter() - (measured_start[0] or wall_start)
    result = {
        "startedAt": started_at,
        "target": args.base_url,
        "scenario": "Authenticated synchronized burst: catalog + part + job samples across shifts + all nominal readings with employee/shift/expectedSequence + guarded completion + exact job history + archive read",
        "users": args.users,
        "iterationsPerUser": args.iterations,
        "selectedShiftCodes": ["1", "2", "71"],
        "part": args.part,
        "characteristicsPerSheet": len(part["features"]),
        "expectedCompletedSheets": args.users * args.iterations,
        "completedSheets": len(completed_runs),
        "jobPrefix": batch,
        "elapsedSeconds": round(elapsed, 3),
        "requestsPerSecond": round(len(recorder.samples) / elapsed, 2),
        "authentication": {"mode": "local employee session cookie", "employeeRange": f"1000–{999 + args.users:04d}", "loginRequests": args.users + 1, "loginOutsideMeasuredPhase": True, "serverIdentityVerified": len(completed_runs) == args.users * args.iterations and not failures},
        "clientHost": {"system": platform.system(), "release": platform.release(), "python": platform.python_version(), "logicalCpus": os.cpu_count()},
        "limitations": [
            "Clients and Docker may share one host; network, browser rendering, CAD files, and production hardware are not simulated.",
            "This is a bounded synchronized request burst, not an endurance test, capacity guarantee, or service-level agreement.",
            "Uses the current synthetic catalog and retained database size; repeat with representative data and assets before deployment.",
            "Request timings include client-observed queueing, server employee-session checks, and network time. Client creation, readiness checks, and employee sign-in are excluded.",
        ],
        **recorder.report(),
        "workstationFailures": failures[:50],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    summary = result["overall"]
    save_p95 = result["endpoints"].get("POST measurement", {}).get("p95_ms")
    result["regressionBudget"] = {"maxP95Ms": args.max_p95_ms, "maxUnexpectedErrors": 0,
        "passed": not failures and not summary["errors"] and len(completed_runs) == args.users * args.iterations
        and summary["p95_ms"] is not None and summary["p95_ms"] <= args.max_p95_ms
        and save_p95 is not None and save_p95 <= args.max_p95_ms,
        "scope": "A reproducible local regression gate, not a production SLA or capacity proof."}
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Completed sheets: {len(completed_runs)}/{args.users * args.iterations}; requests: {summary['requests']}; request errors: {summary['errors']}; failed clients: {len(failures)}")
    print(f"Latency p50/p95/p99: {summary['p50_ms']} / {summary['p95_ms']} / {summary['p99_ms']} ms; throughput: {result['requestsPerSecond']} requests/s")
    print(f"Report: {args.output}")
    print(f"Regression budget: {'PASS' if result['regressionBudget']['passed'] else 'FAIL'} (p95 <= {args.max_p95_ms:g} ms; zero unexpected errors)")
    return 0 if result["regressionBudget"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
