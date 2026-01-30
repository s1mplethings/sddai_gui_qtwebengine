#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List


def tail_text(s: str, n: int = 30) -> str:
    lines = (s or "").splitlines()
    return "\n".join(lines[-n:])


def guess_quick_fix(stdout: str, stderr: str) -> str:
    t = (stdout or "") + "\n" + (stderr or "")
    tl = t.lower()

    if "playwright missing" in tl or ("playwright" in tl and "python -m playwright install" in tl):
        return "安装自检依赖：pip install -r requirements-dev.txt && python -m playwright install"
    if "modulenotfounderror" in tl and "pillow" in tl:
        return "安装 Pillow：pip install -r requirements-dev.txt"
    if "no graph spider entry found" in tl or "entry not found" in tl:
        return "检查入口文件：web/graph_spider/index.html（或 v2/v4）；如 Qt 仍指向旧路径，做一个跳转入口保持兼容。"
    if "blank-like" in tl or "looks blank" in tl:
        return "页面可能没渲染：检查 index.html 是否包含 canvas+脚本；检查 JS 控制台报错；确认 nodes/links 至少 >0。"
    if "hover interaction not detected" in tl or "hover not detected" in tl:
        return "Hover 未触发：确保 mousemove 设置 hovered 节点，并在 draw 时放大节点、加粗/变亮相邻边。"
    if "timeout" in tl:
        return "疑似卡死/过慢：减少首屏节点数量（LOD），或先渲染骨架图再增量更新。"
    if "patch does not apply" in tl:
        return "Patch 不能 apply：确认基线版本一致；优先生成更小补丁只改必要文件。"

    return "先看 report.md 的 FAIL 项 stderr/stdout tail；定位入口/报错文件，再做最小修复。"


def load_recent_errors(index_jsonl: Path, limit: int = 5) -> List[Dict]:
    if not index_jsonl.exists():
        return []
    lines = index_jsonl.read_text(encoding="utf-8", errors="ignore").splitlines()
    out: List[Dict] = []
    for ln in reversed(lines):
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except Exception:
            continue
        if len(out) >= limit:
            break
    return list(reversed(out))


def write_latest(repo: Path, error_set: Dict) -> None:
    base = repo / "issue_memory" / "errors"
    base.mkdir(parents=True, exist_ok=True)
    (base / "latest.json").write_text(json.dumps(error_set, ensure_ascii=False, indent=2), encoding="utf-8")

    md = []
    md.append(f"# Latest Error Set\n\n- timestamp: `{error_set.get('timestamp','')}`\n\n")
    for f in error_set.get("failures", []):
        md.append(f"## {f.get('suite_id','')} :: {f.get('check_name','')}\n\n")
        md.append(f"- rc: `{f.get('returncode','')}`\n")
        md.append(f"- quick_fix: {f.get('quick_fix','')}\n\n")
    (base / "latest.md").write_text("".join(md), encoding="utf-8")


def append_index(repo: Path, error_set: Dict) -> None:
    base = repo / "issue_memory" / "errors"
    base.mkdir(parents=True, exist_ok=True)
    idx = base / "index.jsonl"
    with idx.open("a", encoding="utf-8") as f:
        f.write(json.dumps(error_set, ensure_ascii=False) + "\n")
