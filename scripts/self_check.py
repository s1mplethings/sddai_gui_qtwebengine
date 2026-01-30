#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from _issue_memory import tail_text, guess_quick_fix, write_latest, append_index

def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        if (cur / ".git").exists():
            return cur
        if (cur / "README.md").exists() and (cur / "specs").exists():
            return cur
        cur = cur.parent
    return start.resolve()

def now_stamp() -> str:
    return time.strftime("%Y%m%d_%H%M%S", time.localtime())

def run_cmd(cmd: str, cwd: Path, timeout_sec: int) -> Tuple[int, str, str, float]:
    t0 = time.time()
    try:
        p = subprocess.run(
            cmd,
            cwd=str(cwd),
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        return p.returncode, p.stdout, p.stderr, (time.time() - t0)
    except subprocess.TimeoutExpired as e:
        out = e.stdout or ""
        err = (e.stderr or "") + "\n[TIMEOUT]"
        return 124, out, err, (time.time() - t0)

def load_suites(repo: Path) -> List[Dict[str, Any]]:
    suites: List[Dict[str, Any]] = []
    specs = repo / "specs"
    if not specs.exists():
        return suites
    for p in specs.rglob("*.checks.json"):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            checks = data.get("checks", [])
            if isinstance(checks, list):
                suites.append({
                    "id": data.get("id", p.stem),
                    "file": str(p.relative_to(repo)),
                    "checks": checks,
                })
        except Exception:
            continue
    return suites

def write_report_md(path: Path, report: Dict[str, Any]) -> None:
    lines: List[str] = []
    lines.append("# Self Check Report\n\n")
    lines.append(f"- timestamp: `{report['timestamp']}`\n")
    lines.append(f"- repo: `{report['repo_root']}`\n")
    lines.append(f"- pass: **{report['pass']}**\n")
    lines.append("\n---\n\n")
    if report.get("error"):
        lines.append(f"**error:** {report['error']}\n\n")
    for suite in report.get("suites", []):
        lines.append(f"## {suite['id']} ({suite['file']})\n\n")
        for r in suite.get("results", []):
            ok = "PASS" if r["pass"] else "FAIL"
            lines.append(f"- **{ok}** `{r['name']}` ({r['seconds']:.2f}s)\n")
            if not r["pass"]:
                if r.get("stdout"):
                    tail = "\n".join(r["stdout"].splitlines()[-30:])
                    lines.append("  - stdout (tail):\n```\n" + tail + "\n```\n")
                if r.get("stderr"):
                    tail = "\n".join(r["stderr"].splitlines()[-30:])
                    lines.append("  - stderr (tail):\n```\n" + tail + "\n```\n")
        lines.append("\n")
    path.write_text("".join(lines), encoding="utf-8")

def write_error_set(out_dir: Path, repo: Path, ts: str, report: Dict[str, Any]) -> Dict[str, Any]:
    failures: List[Dict[str, Any]] = []
    artifacts_dir = out_dir / "artifacts"
    report_path = out_dir / "report.md"

    for suite in report.get("suites", []):
        for r in suite.get("results", []):
            if r.get("pass"):
                continue
            stdout = r.get("stdout", "") or ""
            stderr = r.get("stderr", "") or ""
            symptoms = ""
            if stdout.strip():
                symptoms += "[stdout tail]\n" + tail_text(stdout, 30) + "\n"
            if stderr.strip():
                symptoms += "[stderr tail]\n" + tail_text(stderr, 30) + "\n"
            quick_fix = guess_quick_fix(stdout, stderr)
            failures.append({
                "suite_id": suite.get("id"),
                "suite_file": suite.get("file"),
                "check_name": r.get("name"),
                "cmd": r.get("cmd"),
                "returncode": r.get("returncode"),
                "symptoms": symptoms.strip(),
                "quick_fix": quick_fix,
                "artifacts_dir": str(artifacts_dir),
                "report_path": str(report_path),
            })

    error_set = {"timestamp": ts, "repo_root": str(repo), "pass": report.get("pass", False), "failures": failures}
    (out_dir / "error_set.json").write_text(json.dumps(error_set, ensure_ascii=False, indent=2), encoding="utf-8")

    md = []
    md.append("# Error Set\n\n")
    md.append(f"- timestamp: `{ts}`\n")
    md.append(f"- pass: **{error_set['pass']}**\n\n")
    for f in failures:
        md.append(f"## {f.get('suite_id','')} :: {f.get('check_name','')}\n\n")
        md.append(f"- rc: `{f.get('returncode','')}`\n")
        md.append(f"- cmd: `{f.get('cmd','')}`\n")
        md.append(f"- quick_fix: {f.get('quick_fix','')}\n\n")
        md.append("**symptoms (tail)**\n\n```\n")
        md.append((f.get("symptoms","") or "").strip() + "\n")
        md.append("```\n\n")
    (out_dir / "error_set.md").write_text("".join(md), encoding="utf-8")
    return error_set

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".", help="repo root (auto detect upward)")
    ap.add_argument("--out", default="", help="output dir (default runs/self_check/<ts>)")
    ap.add_argument("--no-error-set", action="store_true", help="do not emit error_set / issue_memory")
    args = ap.parse_args()

    repo = find_repo_root(Path(args.repo))
    ts = now_stamp()
    out_dir = Path(args.out) if args.out else (repo / "runs" / "self_check" / ts)
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    suites = load_suites(repo)
    if not suites:
        report = {"timestamp": ts, "repo_root": str(repo), "pass": False, "suites": [], "error": "No checks found. Add specs/*.checks.json"}
        (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        write_report_md(out_dir / "report.md", report)
        print(report["error"])
        return 2

    os.environ["SDDAI_SELF_CHECK_OUT"] = str(out_dir)
    os.environ["SDDAI_SELF_CHECK_ARTIFACTS"] = str(artifacts_dir)

    all_pass = True
    report_suites: List[Dict[str, Any]] = []

    for suite in suites:
        results = []
        for chk in suite["checks"]:
            name = chk.get("name", "unnamed")
            cmd = chk.get("cmd", "")
            timeout_sec = int(chk.get("timeout_sec", 120))
            if not cmd:
                all_pass = False
                results.append({"name": name, "pass": False, "returncode": 2, "stdout": "", "stderr": "missing cmd", "seconds": 0.0, "cmd": cmd})
                continue

            rc, out, err, sec = run_cmd(cmd, repo, timeout_sec)
            ok = (rc == 0)
            if not ok:
                all_pass = False
            results.append({"name": name, "pass": ok, "returncode": rc, "stdout": out, "stderr": err, "seconds": sec, "cmd": cmd})

        report_suites.append({"id": suite["id"], "file": suite["file"], "results": results})

    report = {"timestamp": ts, "repo_root": str(repo), "pass": all_pass, "suites": report_suites}
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report_md(out_dir / "report.md", report)

    if not args.no_error_set:
        es = write_error_set(out_dir, repo, ts, report)
        if not report.get("pass", False):
            write_latest(repo, es)
            append_index(repo, es)

    print(f"[self_check] report: {out_dir / 'report.md'}")
    return 0 if all_pass else 1

if __name__ == "__main__":
    raise SystemExit(main())
