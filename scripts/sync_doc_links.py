#!/usr/bin/env python3
"""
Sync doc_links from meta/pipeline_graph.json to corresponding .md files.
Updates only controlled blocks (<!-- SDDAI:LINKS:BEGIN --> ... <!-- SDDAI:LINKS:END -->).
Idempotent: running multiple times produces the same result.

Usage:
  python scripts/sync_doc_links.py          # Write links to md files
  python scripts/sync_doc_links.py --check  # Check only, no write (for verify)
"""
import json
import os
import sys
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
META_GRAPH = ROOT / "meta" / "pipeline_graph.json"

BEGIN_MARKER = "<!-- SDDAI:LINKS:BEGIN -->"
END_MARKER = "<!-- SDDAI:LINKS:END -->"


def load_graph():
    """Load pipeline graph and extract docs_link edges."""
    if not META_GRAPH.exists():
        return []
    with open(META_GRAPH, "r", encoding="utf-8") as f:
        data = json.load(f)
    edges = data.get("edges", [])
    return [e for e in edges if e.get("type") == "docs_link"]


def resolve_node_path(node_id, graph_data):
    """Resolve node_id to .md file path."""
    # Try modules first
    for m in graph_data.get("modules", []):
        if m.get("id") == node_id:
            path = m.get("path", "")
            if path.endswith(".md"):
                return path
            # Module spec: path might be like specs/xxx.md
            return path
    
    # Try docs: doc:<name> → docs/<name>.md
    if node_id.startswith("doc:"):
        name = node_id[4:]
        return f"docs/{name}.md"
    
    # Fallback: search for basename match in workspace
    # (Not implemented for simplicity, just return empty)
    return ""


def find_md_file(rel_path):
    """Find absolute path of md file from relative path."""
    if not rel_path:
        return None
    p = ROOT / rel_path
    if p.exists() and p.suffix == ".md":
        return p
    # Try without extension if not found
    if not p.exists():
        p = ROOT / (rel_path + ".md" if not rel_path.endswith(".md") else rel_path)
    return p if p.exists() else None


def generate_links_block(target_ids, graph_data):
    """Generate markdown links block from target node IDs."""
    lines = [BEGIN_MARKER, "## Links", ""]
    for tid in target_ids:
        target_path = resolve_node_path(tid, graph_data)
        if not target_path:
            continue
        # Get label from modules or use tid
        label = tid
        for m in graph_data.get("modules", []):
            if m.get("id") == tid:
                label = m.get("label", tid)
                break
        lines.append(f"- [{label}]({target_path})")
    lines.append("")
    lines.append(END_MARKER)
    return "\n".join(lines)


def update_md_file(md_path, new_block):
    """Update controlled block in md file. Return True if changed."""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Check if markers exist
    if BEGIN_MARKER not in content or END_MARKER not in content:
        # No controlled block, append to end
        new_content = content.rstrip() + "\n\n" + new_block + "\n"
    else:
        # Replace existing block
        pattern = re.escape(BEGIN_MARKER) + r".*?" + re.escape(END_MARKER)
        new_content = re.sub(pattern, new_block, content, flags=re.DOTALL)
    
    if new_content == content:
        return False
    
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True


def main():
    check_mode = "--check" in sys.argv
    
    if not META_GRAPH.exists():
        print(f"[warn] {META_GRAPH} not found, skipping")
        return 0
    
    with open(META_GRAPH, "r", encoding="utf-8") as f:
        graph_data = json.load(f)
    
    doc_links = load_graph()
    if not doc_links:
        print("[ok] no docs_link edges found")
        return 0
    
    # Group by source
    links_by_source = {}
    for e in doc_links:
        src = e.get("source")
        tgt = e.get("target")
        if not src or not tgt:
            continue
        if src not in links_by_source:
            links_by_source[src] = []
        links_by_source[src].append(tgt)
    
    updated = []
    errors = []
    
    for src_id, targets in links_by_source.items():
        src_path = resolve_node_path(src_id, graph_data)
        if not src_path:
            errors.append(f"Cannot resolve path for {src_id}")
            continue
        
        md_file = find_md_file(src_path)
        if not md_file:
            errors.append(f"Cannot find file: {src_path}")
            continue
        
        new_block = generate_links_block(targets, graph_data)
        
        if check_mode:
            # Check mode: just verify
            with open(md_file, "r", encoding="utf-8") as f:
                content = f.read()
            if BEGIN_MARKER in content and END_MARKER in content:
                pattern = re.escape(BEGIN_MARKER) + r".*?" + re.escape(END_MARKER)
                existing = re.search(pattern, content, flags=re.DOTALL)
                if existing and existing.group(0) != new_block:
                    errors.append(f"Out of sync: {md_file.relative_to(ROOT)}")
            else:
                errors.append(f"Missing markers: {md_file.relative_to(ROOT)}")
        else:
            # Write mode
            if update_md_file(md_file, new_block):
                updated.append(md_file.relative_to(ROOT))
    
    if errors:
        for e in errors:
            print(f"[error] {e}")
        return 1
    
    if check_mode:
        print("[ok] all docs_link blocks in sync")
    else:
        if updated:
            for u in updated:
                print(f"[ok] updated: {u}")
        else:
            print("[ok] no changes needed")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
