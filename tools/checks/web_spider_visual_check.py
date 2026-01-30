#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import contextlib
import io
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from PIL import Image, ImageChops

def find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(12):
        if (cur / ".git").exists() or ((cur / "README.md").exists() and (cur / "specs").exists()):
            return cur
        cur = cur.parent
    return start.resolve()

def choose_entry(repo: Path) -> Path:
    candidates = [
        repo / "web" / "graph_spider" / "index.html",
        repo / "web" / "graph_spider_v2" / "index.html",
        repo / "web" / "graph_spider_v4" / "index.html",
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError("No graph spider entry found (tried web/graph_spider*, web/graph_spider_v2, web/graph_spider_v4).")

def hist_std_and_bright(img_gray: Image.Image):
    hist = img_gray.histogram()
    total = sum(hist) or 1
    mean = sum(i * hist[i] for i in range(256)) / total
    var = sum(((i - mean) ** 2) * hist[i] for i in range(256)) / total
    std = var ** 0.5
    bright = sum(hist[i] for i in range(70, 256))
    return std, bright

def mean_abs_diff(img_a: Image.Image, img_b: Image.Image) -> float:
    if img_a.size != img_b.size:
        img_b = img_b.resize(img_a.size)
    diff = ImageChops.difference(img_a, img_b).convert("L")
    hist = diff.histogram()
    total = sum(hist) or 1
    mean = sum(i * hist[i] for i in range(256)) / total
    return float(mean)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

@contextlib.contextmanager
def run_http_server(root: Path):
    # Bind to random port
    host = "127.0.0.1"
    # Use cwd changing for handler directory
    old_cwd = Path.cwd()
    os.chdir(root)

    httpd = ThreadingHTTPServer((host, 0), QuietHandler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        yield host, port
    finally:
        httpd.shutdown()
        os.chdir(old_cwd)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entry", default="", help="relative path to entry html from repo root")
    ap.add_argument("--auto-entry", action="store_true")
    ap.add_argument("--save-artifacts", action="store_true")
    ap.add_argument("--timeout-sec", type=int, default=90)
    ap.add_argument("--min-std", type=float, default=10.0)
    ap.add_argument("--min-bright", type=int, default=1800)
    ap.add_argument("--min-diff", type=float, default=1.5)
    args = ap.parse_args()

    repo = find_repo_root(Path("."))
    entry = choose_entry(repo) if args.auto_entry else (repo / args.entry)
    if not entry.exists():
        print(f"[FAIL] entry not found: {entry}")
        return 2

    # Playwright import check
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print("Playwright missing. Install: pip install -r requirements-dev.txt && python -m playwright install")
        return 2

    artifacts_dir = Path(os.environ.get("SDDAI_SELF_CHECK_ARTIFACTS", str(repo / "runs" / "self_check_artifacts")))
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    rel = entry.relative_to(repo).as_posix()

    def launch_browser(play):
        """
        Try multiple strategies to avoid downloading Playwright browsers on locked-down machines:
        1) env PLAYWRIGHT_BROWSER_CHANNEL (e.g., 'msedge' or 'chrome')
        2) system Edge / Chrome channels
        3) executable_path from common install locations
        4) fallback to bundled Playwright Chromium (requires playwright install)
        """
        launch_attempts = []

        env_chan = os.environ.get("PLAYWRIGHT_BROWSER_CHANNEL", "").strip()
        if env_chan:
            launch_attempts.append({"channel": env_chan})
        launch_attempts.append({"channel": "msedge"})
        launch_attempts.append({"channel": "chrome"})

        common_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ]
        env_path = os.environ.get("PLAYWRIGHT_CHROMIUM_PATH")
        if env_path:
            common_paths.insert(0, env_path)
        for pth in common_paths:
            if Path(pth).exists():
                launch_attempts.append({"executable_path": pth})

        # final fallback: bundled browser (requires playwright install)
        launch_attempts.append({})

        last_err = None
        for opts in launch_attempts:
            try:
                browser = play.chromium.launch(headless=True, **opts)
                used = opts.get("channel") or opts.get("executable_path") or "bundled"
                print(f"[self_check] playwright chromium launched via {used}")
                return browser
            except Exception as e:
                last_err = e
                continue
        print(f"[FAIL] playwright could not launch any browser: {last_err}")
        return None

    with run_http_server(repo) as (host, port):
        url = f"http://{host}:{port}/{rel}"

        with sync_playwright() as p:
            browser = launch_browser(p)
            if browser is None:
                print("Playwright browser not available. Set PLAYWRIGHT_CHROMIUM_PATH to an existing Chrome/Edge executable, or run: python -m playwright install chromium")
                return 2

            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.goto(url, wait_until="load", timeout=args.timeout_sec * 1000)
            page.wait_for_timeout(800)

            # If debug is available, prefer deterministic assertions
            debug = None
            try:
                debug = page.evaluate("window.__SPIDER_DEBUG__ || null")
            except Exception:
                debug = None

            base_png = page.screenshot(full_page=True)
            base_img = Image.open(io.BytesIO(base_png)).convert("RGB")
            base_gray = base_img.convert("L")
            std0, bright0 = hist_std_and_bright(base_gray)

            # hover sweep to trigger highlight
            w, h = 1400, 900
            for x, y in [(w//2, h//2), (w//2+140, h//2), (w//2-140, h//2), (w//2, h//2+120), (w//2, h//2-120)]:
                page.mouse.move(x, y)
                page.wait_for_timeout(120)

            # try also small click select to create highlight if logic exists
            page.mouse.click(w//2, h//2)
            page.wait_for_timeout(200)

            hover_png = page.screenshot(full_page=True)
            hover_img = Image.open(io.BytesIO(hover_png)).convert("RGB")

            if args.save_artifacts:
                (artifacts_dir / "spider_base.png").write_bytes(base_png)
                (artifacts_dir / "spider_hover.png").write_bytes(hover_png)

            browser.close()

    # If debug exists, do deterministic checks
    if debug and isinstance(debug, dict):
        nodes = debug.get("nodesVisible") or debug.get("nodes") or 0
        edges = debug.get("edgesVisible") or debug.get("edges") or 0
        if int(nodes) <= 0:
            print(f"[FAIL] debug nodesVisible={nodes}")
            return 1
        if int(edges) <= 0:
            print(f"[FAIL] debug edgesVisible={edges}")
            return 1
        # If hover info available, check it
        hi = debug.get("highlightEdgeCount")
        if hi is not None and int(hi) <= 0:
            print(f"[FAIL] debug highlightEdgeCount={hi}")
            return 1
        print(f"[PASS] debug ok: nodes={nodes} edges={edges}")
        return 0

    # Otherwise use image heuristics
    diff_mean = mean_abs_diff(base_img, hover_img)
    ok = True
    if std0 < args.min_std:
        ok = False
        print(f"[FAIL] blank-like: std={std0:.2f} < {args.min_std}")
    if bright0 < args.min_bright:
        ok = False
        print(f"[FAIL] too few bright pixels: bright={bright0} < {args.min_bright}")
    if diff_mean < args.min_diff:
        ok = False
        print(f"[FAIL] hover interaction not detected (img diff): diff={diff_mean:.2f} < {args.min_diff}")

    if ok:
        print(f"[PASS] render+hover ok | std={std0:.2f} bright={bright0} diff={diff_mean:.2f}")
        return 0

    print(f"[INFO] artifacts: {artifacts_dir}")
    return 1

if __name__ == "__main__":
    import io
    raise SystemExit(main())
