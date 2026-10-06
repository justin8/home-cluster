#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SKILL_DIR}/../../.." && pwd)"

REFS_DIR="${SKILL_DIR}/references"
TALOS_DIR="${REFS_DIR}/talos"
LONGHORN_DIR="${REFS_DIR}/longhorn"

is_version_string() {
    local val="$1"
    # Matches: latest, all, v1.14, 1.14, 1.14.2, v1.14.2, 0.8.0, etc.
    if [[ "$val" =~ ^(latest|all)$ ]] || [[ "$val" =~ ^v?[0-9]+(\.[0-9]+)*$ ]]; then
        return 0
    else
        return 1
    fi
}

detect_cluster_talos_version() {
    if [ -f "${REPO_ROOT}/talos/talconfig.yaml" ]; then
        grep -m1 '^talosVersion:' "${REPO_ROOT}/talos/talconfig.yaml" | awk '{print $2}' | tr -d '"' || true
    fi
}

detect_cluster_longhorn_version() {
    if [ -f "${REPO_ROOT}/kubernetes/charts/core-services/longhorn/Chart.yaml" ]; then
        grep -A1 'name: longhorn' "${REPO_ROOT}/kubernetes/charts/core-services/longhorn/Chart.yaml" | grep 'version:' | head -n1 | awk '{print $2}' | tr -d '"' || true
    fi
}

if [ "$#" -eq 0 ]; then
    echo "Usage:"
    echo "  $0 <search-term> [subpath] [options]"
    echo "  $0 talos [version] <search-term> [subpath] [options]"
    echo "  $0 longhorn [version] <search-term> [subpath] [options]"
    echo ""
    echo "Options:"
    echo "  -l, --files            List matching files only (minimal tokens)"
    echo "  -n, --limit <num>      Max files to show snippets for (default: 5)"
    echo "  -a, --all              Show all matching files and snippets"
    echo "  -C, --context <num>    Lines of context around match (default: 1)"
    echo "  -v, --version <ver>    Specify doc version (e.g. 1.14.2, 1.13, all)"
    echo ""
    echo "Examples:"
    echo "  $0 talos 1.14 ephemeral             # Normalizes 1.14 -> v1.14, compact snippets"
    echo "  $0 talos 1.14 -l ephemeral          # List only matching files (ultra token-efficient)"
    echo "  $0 longhorn 1.13 recurring-job      # Normalizes 1.13 -> latest 1.13.x patch"
    echo "  $0 'fstrim'                         # Automatically queries repo's active cluster versions"
    exit 1
fi

TECH="all"
REQ_VERSION=""
QUERY=""
SEARCH_SUBPATH=""
FORMATTER_FLAGS=()

positional=()

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version|-v)
            REQ_VERSION="$2"
            shift 2
            ;;
        --version=*)
            REQ_VERSION="${1#*=}"
            shift
            ;;
        -l|--files)
            FORMATTER_FLAGS+=("-l")
            shift
            ;;
        -a|--all)
            FORMATTER_FLAGS+=("-a")
            shift
            ;;
        -n|--limit)
            FORMATTER_FLAGS+=("-n" "$2")
            shift 2
            ;;
        -C|--context)
            FORMATTER_FLAGS+=("-C" "$2")
            shift 2
            ;;
        *)
            positional+=("$1")
            shift
            ;;
    esac
done

if [[ ${#positional[@]} -gt 0 ]]; then
    first="${positional[0]}"
    if [[ "$first" == talos@* ]]; then
        TECH="talos"
        REQ_VERSION="${first#talos@}"
        positional=("${positional[@]:1}")
    elif [[ "$first" == longhorn@* ]]; then
        TECH="longhorn"
        REQ_VERSION="${first#longhorn@}"
        positional=("${positional[@]:1}")
    elif [[ "$first" == "talos" ]] || [[ "$first" == "longhorn" ]]; then
        TECH="$first"
        positional=("${positional[@]:1}")
    fi
fi

remaining=()
for arg in "${positional[@]}"; do
    if [ -z "${REQ_VERSION}" ] && is_version_string "$arg"; then
        REQ_VERSION="$arg"
    else
        remaining+=("$arg")
    fi
done

if [[ ${#remaining[@]} -gt 0 ]]; then
    QUERY="${remaining[0]}"
fi
if [[ ${#remaining[@]} -gt 1 ]]; then
    SEARCH_SUBPATH="${remaining[1]}"
fi

if [ -z "${QUERY}" ]; then
    echo "Error: Search query cannot be empty."
    exit 1
fi

normalize_talos_target() {
    local requested="$1"
    local talos_root="${TALOS_DIR}/public/talos"

    if [ "$requested" = "all" ]; then
        echo "$talos_root"
        return
    fi

    if [ "$requested" = "latest" ]; then
        find "$talos_root" -mindepth 1 -maxdepth 1 -type d -name "v*" 2>/dev/null | sort -V | tail -n 1
        return
    fi

    local clean="${requested#v}"
    local major_minor
    major_minor="$(echo "$clean" | awk -F. '{print $1"."$2}')"
    local norm_ver="v${major_minor}"
    local target_dir="${talos_root}/${norm_ver}"

    if [ -d "$target_dir" ]; then
        echo "$target_dir"
        return
    fi

    "${SCRIPT_DIR}/update-docs.sh" talos "${norm_ver}" >&2 || true

    if [ -d "$target_dir" ]; then
        echo "$target_dir"
        return
    fi

    echo "Warning: Talos version '${requested}' (${norm_ver}) not found. Falling back to latest available." >&2
    find "$talos_root" -mindepth 1 -maxdepth 1 -type d -name "v*" 2>/dev/null | sort -V | tail -n 1
}

normalize_longhorn_target() {
    local requested="$1"
    local longhorn_root="${LONGHORN_DIR}/content/docs"

    if [ "$requested" = "all" ]; then
        echo "${LONGHORN_DIR}/content"
        return
    fi

    if [ "$requested" = "latest" ]; then
        find "$longhorn_root" -mindepth 1 -maxdepth 1 -type d -name "[0-9]*" 2>/dev/null | sort -V | tail -n 1
        return
    fi

    local clean="${requested#v}"

    if [ -d "${longhorn_root}/${clean}" ]; then
        echo "${longhorn_root}/${clean}"
        return
    fi

    if [ -d "${longhorn_root}/archives/${clean}" ]; then
        echo "${longhorn_root}/archives/${clean}"
        return
    fi

    local major_minor
    major_minor="$(echo "$clean" | awk -F. '{print $1"."$2}')"
    local match
    match="$(find "${longhorn_root}" "${longhorn_root}/archives" -mindepth 1 -maxdepth 1 -type d -name "${major_minor}.*" 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$match" ] && [ -d "$match" ]; then
        echo "$match"
        return
    fi

    echo "Warning: Longhorn version '${requested}' not found. Falling back to latest available." >&2
    find "$longhorn_root" -mindepth 1 -maxdepth 1 -type d -name "[0-9]*" 2>/dev/null | sort -V | tail -n 1
}

run_search() {
    local target_path="$1"
    python3 - "${target_path}" "${QUERY}" "${FORMATTER_FLAGS[@]}" << 'PYEOF'
import argparse
import re
import sys
from pathlib import Path

DOC_EXTENSIONS = {".md", ".mdx", ".txt", ".yaml", ".yml"}
SKIP_EXTENSIONS = {".json", ".png", ".jpg", ".svg", ".ico", ".lock", ".map"}

def search_directory(target_path, query, limit=5, max_snippets=3, context=1, files_only=False, show_all=False):
    target = Path(target_path)
    if not target.exists():
        print(f"Error: Target path '{target_path}' does not exist.", file=sys.stderr)
        return 1

    try:
        pattern = re.compile(re.escape(query), re.IGNORECASE)
    except Exception as e:
        print(f"Invalid query: {e}", file=sys.stderr)
        return 1

    matches_by_file = {}
    matched_by_name = []

    files_to_scan = []
    if target.is_file():
        files_to_scan = [target]
    else:
        for p in target.rglob("*"):
            if not p.is_file() or p.name.startswith("."):
                continue
            ext = p.suffix.lower()
            if ext in SKIP_EXTENSIONS:
                continue
            if ext in DOC_EXTENSIONS or not ext:
                files_to_scan.append(p)
            elif pattern.search(p.name):
                matched_by_name.append(p)

    for p in files_to_scan:
        try:
            lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        file_matches = [i for i, line in enumerate(lines) if pattern.search(line)]
        if file_matches:
            matches_by_file[p] = (lines, file_matches)
        elif pattern.search(p.name):
            matched_by_name.append(p)

    def get_rel_path(p):
        try:
            return str(p.relative_to(target))
        except Exception:
            return str(p)

    if not matches_by_file:
        if matched_by_name:
            print(f"No text matches, but found {len(matched_by_name)} file(s) matching '{query}' by name:")
            for p in matched_by_name[:15]:
                print(f"  • {get_rel_path(p)}")
            return 0
        print(f"No direct matches found for '{query}'.")
        return 0

    sorted_files = sorted(matches_by_file.keys(), key=lambda f: len(matches_by_file[f][1]), reverse=True)
    total_files = len(sorted_files)
    total_occurrences = sum(len(matches_by_file[f][1]) for f in sorted_files)

    effective_limit = total_files if show_all else limit

    if files_only:
        print(f"Found {total_occurrences} matches across {total_files} file(s):")
        for f in sorted_files:
            print(f"  {get_rel_path(f)} ({len(matches_by_file[f][1])} matches)")
        return 0

    print(f"Found {total_occurrences} match(es) across {total_files} file(s) (displaying top {min(total_files, effective_limit)}):")

    for f in sorted_files[:effective_limit]:
        lines, match_indices = matches_by_file[f]
        rel_name = get_rel_path(f)
        print(f"\n── {rel_name} ({len(match_indices)} matches) ──")

        shown = 0
        used_ranges = []

        for midx in match_indices:
            if shown >= max_snippets and not show_all:
                break

            start = max(0, midx - context)
            end = min(len(lines), midx + context + 1)

            overlap = False
            for rstart, rend in used_ranges:
                if not (end <= rstart or start >= rend):
                    overlap = True
                    break
            if overlap:
                continue

            used_ranges.append((start, end))

            for i in range(start, end):
                prefix = ">" if i == midx else " "
                line_content = lines[i].strip()
                if len(line_content) > 140:
                    line_content = line_content[:137] + "..."
                print(f"{prefix} L{i+1}: {line_content}")

            shown += 1
            if shown < min(len(match_indices), max_snippets) or (show_all and shown < len(match_indices)):
                print("   ---")

    if total_files > effective_limit:
        remaining = total_files - effective_limit
        print(f"\n... and {remaining} more matching file(s). Use -l to list files or -a / --limit {total_files} to see more.")

    return 0

parser = argparse.ArgumentParser(description="Token-efficient doc search")
parser.add_argument("target", help="Target directory or file")
parser.add_argument("query", help="Search query")
parser.add_argument("-n", "--limit", type=int, default=5, help="Max files to display snippets for")
parser.add_argument("-s", "--max-snippets", type=int, default=3, help="Max snippets per file")
parser.add_argument("-C", "--context", type=int, default=1, help="Context lines before/after")
parser.add_argument("-l", "--files", action="store_true", help="List matching files only")
parser.add_argument("-a", "--all", action="store_true", help="Show all matching files and snippets")

args = parser.parse_args(sys.argv[1:])
search_directory(
    args.target,
    args.query,
    limit=args.limit,
    max_snippets=args.max_snippets,
    context=args.context,
    files_only=args.files,
    show_all=args.all,
)
PYEOF
}

search_talos() {
    if [ ! -d "${TALOS_DIR}/public/talos" ]; then
        echo "Talos documentation not found. Fetching on first run..."
        "${SCRIPT_DIR}/update-docs.sh" talos
    fi

    local version_to_use="${REQ_VERSION}"
    if [ -z "${version_to_use}" ]; then
        version_to_use="$(detect_cluster_talos_version)"
        if [ -z "${version_to_use}" ]; then
            version_to_use="latest"
        fi
    fi

    local target_dir
    target_dir="$(normalize_talos_target "${version_to_use}")"

    local search_target="${target_dir}"
    if [ -n "${SEARCH_SUBPATH}" ] && [ "${SEARCH_SUBPATH}" != "all" ]; then
        if [ -d "${target_dir}/${SEARCH_SUBPATH}" ]; then
            search_target="${target_dir}/${SEARCH_SUBPATH}"
        fi
    fi

    local display_ver
    if [ "${target_dir}" = "${TALOS_DIR}/public/talos" ]; then
        display_ver="all versions"
    else
        display_ver="$(basename "${target_dir}")"
        if [ -n "${REQ_VERSION}" ] && [ "${REQ_VERSION}" != "${display_ver}" ] && [ "${REQ_VERSION}" != "latest" ]; then
            display_ver="${display_ver} (normalized from '${REQ_VERSION}')"
        fi
    fi

    echo "=== Searching Talos Documentation [${display_ver}] for '${QUERY}' ==="
    run_search "${search_target}"
}

search_longhorn() {
    if [ ! -d "${LONGHORN_DIR}/content/docs" ]; then
        echo "Longhorn documentation not found. Fetching on first run..."
        "${SCRIPT_DIR}/update-docs.sh" longhorn
    fi

    local version_to_use="${REQ_VERSION}"
    if [ -z "${version_to_use}" ]; then
        version_to_use="$(detect_cluster_longhorn_version)"
        if [ -z "${version_to_use}" ]; then
            version_to_use="latest"
        fi
    fi

    local target_dir
    target_dir="$(normalize_longhorn_target "${version_to_use}")"

    local search_target="${target_dir}"
    if [ -n "${SEARCH_SUBPATH}" ] && [ "${SEARCH_SUBPATH}" != "all" ]; then
        if [ -d "${target_dir}/${SEARCH_SUBPATH}" ]; then
            search_target="${target_dir}/${SEARCH_SUBPATH}"
        fi
    fi

    local display_ver
    if [ "${target_dir}" = "${LONGHORN_DIR}/content" ]; then
        display_ver="all versions & KB"
    else
        display_ver="$(basename "${target_dir}")"
        if [ -n "${REQ_VERSION}" ] && [ "${REQ_VERSION}" != "${display_ver}" ] && [ "${REQ_VERSION}" != "latest" ]; then
            display_ver="${display_ver} (normalized from '${REQ_VERSION}')"
        fi
    fi

    echo "=== Searching Longhorn Documentation [${display_ver}] for '${QUERY}' ==="
    run_search "${search_target}"
}

case "${TECH}" in
    talos)
        search_talos
        ;;
    longhorn)
        search_longhorn
        ;;
    all)
        search_talos
        echo ""
        search_longhorn
        ;;
esac
