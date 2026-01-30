#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional, Tuple

PATCH_START_RE = re.compile(r"^diff --git ", re.M)

def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        if (cur / ".git").exists() or ((cur / "README.md").exists() and (cur / "specs").exists()):
            return cur
        cur = cur.parent
    return start.resolve()

def now_stamp() -> str:
    return time.strftime("%Y%m%d_%H%M%S", time.localtime())

def run(cmd: str, cwd: Path, timeout_sec: int = 300) -> Tuple[int, str, str]:
    p = subprocess.run(cmd, cwd=str(cwd), shell=True, capture_output=True, text=True, timeout=timeout_sec)
    return p.returncode, p.stdout, p.stderr

def latest_self_check_report(repo: Path) -> Optional[Path]:
    root = repo / "runs" / "self_check"
    if not root.exists():
        return None
    reports = sorted(root.glob("*/report.md"), key=lambda p: p.parent.name, reverse=True)
    return reports[0] if reports else None

def extract_patch(stdout_text: str) -> Optional[str]:
    m = PATCH_START_RE.search(stdout_text)
    if not m:
        return None
    return stdout_text[m.start():].strip() + "\n"

def make_prompt(report_md: Path, out_dir: Path) -> Path:
    report_text = report_md.read_text(encoding="utf-8", errors="ignore")
    prompt = []
    prompt.append("# SDDAI Self-Improve Patch Request\n\n")
    prompt.append("目标：让 `python scripts/self_check.py` PASS。\n\n")
    prompt.append("强约束：\n")
    prompt.append("- 只能输出 unified diff patch（必须从 `diff --git` 开始）\n")
    prompt.append("- 不要输出解释文字、不要包代码块、不要输出多余内容\n")
    prompt.append("- 优先最小修改；不要大范围重构\n\n")

    # 最近 5 次 error_set 摘要，避免重复踩坑
    repo = find_repo_root(Path("."))
    idx = repo / "issue_memory" / "errors" / "index.jsonl"
    recent = load_recent_errors(idx, limit=5)
    if recent:
        prompt.append("## Recent Error Memory (last 5)\n\n")
        for es in recent:
            prompt.append(f"- `{es.get('timestamp','')}` failures={len(es.get('failures',[]))}\n")
            for f in es.get("failures", [])[:2]:
                prompt.append(f"  - {f.get('suite_id','')}::{f.get('check_name','')} | quick_fix: {f.get('quick_fix','')}\n")
        prompt.append("\n")

    prompt.append("## 当前 report.md\n\n")
    prompt.append(report_text)
    p = out_dir / "fix_prompt.md"
    p.write_text("".join(prompt), encoding="utf-8")
    return p

def git_apply(repo: Path, patch_path: Path) -> bool:
    rc, out, err = run(f'git apply "{patch_path}"', repo, timeout_sec=120)
    if rc == 0:
        return True
    sys.stderr.write("[git apply failed]\n" + out + "\n" + err + "\n")
    return False

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--patch-cmd", default="", help="override SDDAI_PATCH_CMD. supports {PROMPT_PATH} {REPO_ROOT}")
    ap.add_argument("--no-apply", action="store_true", help="do not git apply (only generate prompts/patches)")
    args = ap.parse_args()

    repo = find_repo_root(Path(args.repo))
    ts = now_stamp()
    out_root = repo / "runs" / "self_improve" / ts
    out_root.mkdir(parents=True, exist_ok=True)

    patch_cmd_tpl = (args.patch_cmd or os.environ.get("SDDAI_PATCH_CMD", "")).strip()

    for i in range(1, args.max_rounds + 1):
        rc, out, err = run("python scripts/self_check.py", repo, timeout_sec=900)
        sys.stdout.write(out)
        sys.stderr.write(err)

        if rc == 0:
            print(f"[self_improve] PASS at round {i}")
            return 0

        report = latest_self_check_report(repo)
        if not report:
            print("[self_improve] report.md not found; stop")
            return 2

        round_dir = out_root / f"round_{i:02d}"
        round_dir.mkdir(parents=True, exist_ok=True)

        prompt_path = make_prompt(report, round_dir)
        print(f"[self_improve] prompt: {prompt_path}")

        if not patch_cmd_tpl:
            print("[self_improve] SDDAI_PATCH_CMD not set; stop after generating prompt")
            return 3

        cmd = patch_cmd_tpl.format(PROMPT_PATH=str(prompt_path), REPO_ROOT=str(repo))
        print(f"[self_improve] running: {cmd}")
        prc, pout, perr = run(cmd, repo, timeout_sec=1800)
        (round_dir / "patch_cmd.stdout.txt").write_text(pout, encoding="utf-8")
        (round_dir / "patch_cmd.stderr.txt").write_text(perr, encoding="utf-8")

        patch_text = extract_patch(pout)
        if not patch_text:
            print("[self_improve] no patch found in stdout; stop")
            return 4

        patch_path = round_dir / f"round_{i:02d}.patch"
        patch_path.write_text(patch_text, encoding="utf-8")
        print(f"[self_improve] patch saved: {patch_path}")

        if args.no_apply:
            continue

        if not git_apply(repo, patch_path):
            print("[self_improve] patch apply failed; stop")
            return 5

    print(f"[self_improve] reached max rounds: {args.max_rounds}")
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
