#!/bin/bash
# Binary search helper for finding the file causing Kotlin FIR crash
# Usage: ./scripts/binary-search-build.sh [round] [group]
#   round: 1, 2a, 2b, 3a, 3b, etc.
#   group: "A" or "B" (which half to test)
#
# This script modifies pages.json to exclude/include pages for binary search.
# It creates a backup before modifying.

PAGES_JSON="pages.json"
BACKUP_FILE="pages.json.backup"

if [ ! -f "$BACKUP_FILE" ]; then
  cp "$PAGES_JSON" "$BACKUP_FILE"
  echo "Created backup: $BACKUP_FILE"
fi

restore() {
  cp "$BACKUP_FILE" "$PAGES_JSON"
  echo "Restored pages.json from backup"
}

case "$1" in
  restore)
    restore
    ;;
  # Round 1: Only keep index page (minimal build)
  r1)
    echo '{"pages":[{"path":"pages/index/index","style":{"enableShareAppMessage":true}}],"subPackages":[],"tabBar":{"list":[{"pagePath":"pages/index/index","text":"test"}]},"globalStyle":{"navigationStyle":"custom"},"easycom":{"autoscan":true}}' > "$PAGES_JSON"
    echo "Round 1: Minimal build (index page only, no subpackages)"
    ;;
  # Round 2A: Index + subpackage pages (first half)
  r2a)
    echo "Round 2A: Not implemented - manual edit needed"
    ;;
  *)
    echo "Binary Search Helper"
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  restore  - Restore original pages.json"
    echo "  r1       - Round 1: Minimal build (index page only)"
    echo ""
    echo "Binary Search Steps:"
    echo "  1. Run: $0 r1  → build → if CRASH, problem is in shared .uts code (index.kt)"
    echo "     → if NO CRASH, problem is in a page/component .kt file"
    echo "  2. If problem in shared code, comment out imports in App.uvue one by one"
    echo "  3. If problem in pages, add back pages in halves to narrow down"
    echo ""
    echo "  Run: $0 restore  to restore original pages.json when done"
    ;;
esac
