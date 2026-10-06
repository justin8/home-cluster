#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REFS_DIR="${SKILL_DIR}/references"
TALOS_DIR="${REFS_DIR}/talos"
LONGHORN_DIR="${REFS_DIR}/longhorn"

TARGET="${1:-all}"
REQUESTED_VERSION="${2:-}"

mkdir -p "${REFS_DIR}"

fetch_talos_on_demand() {
    local ver="$1" # e.g. v1.15
    local clean_ver="${ver#v}"
    local target_dir="${TALOS_DIR}/public/talos/${ver}"
    if [ -d "${target_dir}" ]; then
        echo "Talos ${ver} is already available."
        return 0
    fi

    echo "==> Talos ${ver} not found in local docs. Checking siderolabs/talos upstream..."
    local temp_dir
    temp_dir="$(mktemp -d)"
    for branch in "release-${clean_ver}" "main"; do
        if git clone --depth 1 --branch "${branch}" --filter=blob:none --sparse https://github.com/siderolabs/talos.git "${temp_dir}" 2>/dev/null; then
            git -C "${temp_dir}" sparse-checkout set "website/content/${ver}" 2>/dev/null || true
            if [ -d "${temp_dir}/website/content/${ver}" ]; then
                mkdir -p "$(dirname "${target_dir}")"
                cp -r "${temp_dir}/website/content/${ver}" "${target_dir}"
                rm -rf "${temp_dir}"
                echo "Successfully fetched Talos ${ver} docs from siderolabs/talos (${branch})."
                return 0
            fi
            rm -rf "${temp_dir}"
        fi
    done
    echo "Notice: Talos version ${ver} was not found on upstream branches."
    return 1
}

update_talos() {
    echo "==> Updating Talos documentation..."
    if [ -d "${TALOS_DIR}/.git" ]; then
        echo "Pulling latest Talos docs in ${TALOS_DIR}..."
        git -C "${TALOS_DIR}" pull --rebase || {
            echo "Pull failed; resetting to origin..."
            git -C "${TALOS_DIR}" fetch --depth 1 origin
            git -C "${TALOS_DIR}" reset --hard "@{u}"
        }
    else
        echo "Cloning Talos docs into ${TALOS_DIR}..."
        git clone --depth 1 --filter=blob:none --sparse https://github.com/siderolabs/docs.git "${TALOS_DIR}"
        git -C "${TALOS_DIR}" sparse-checkout set public/talos
    fi

    if [ -n "${REQUESTED_VERSION}" ]; then
        local clean="${REQUESTED_VERSION#v}"
        local major_minor
        major_minor="$(echo "${clean}" | awk -F. '{print $1"."$2}')"
        local norm_ver="v${major_minor}"
        if [ ! -d "${TALOS_DIR}/public/talos/${norm_ver}" ]; then
            fetch_talos_on_demand "${norm_ver}" || true
        fi
    fi

    local available_versions
    available_versions="$(find "${TALOS_DIR}/public/talos" -mindepth 1 -maxdepth 1 -type d -name "v*" 2>/dev/null | sort -V | xargs -r -n1 basename | tr '\n' ' ')"
    echo "Talos documentation is up to date. Available versions: ${available_versions}"
}

update_longhorn() {
    echo "==> Updating Longhorn documentation..."
    if [ -d "${LONGHORN_DIR}/.git" ]; then
        echo "Pulling latest Longhorn docs in ${LONGHORN_DIR}..."
        git -C "${LONGHORN_DIR}" pull --rebase || {
            echo "Pull failed; resetting to origin..."
            git -C "${LONGHORN_DIR}" fetch --depth 1 origin
            git -C "${LONGHORN_DIR}" reset --hard "@{u}"
        }
    else
        echo "Cloning Longhorn docs into ${LONGHORN_DIR}..."
        git clone --depth 1 --filter=blob:none --sparse https://github.com/longhorn/website.git "${LONGHORN_DIR}"
        git -C "${LONGHORN_DIR}" sparse-checkout set content/docs content/kb
    fi

    local latest_version
    latest_version="$(find "${LONGHORN_DIR}/content/docs" -mindepth 1 -maxdepth 1 -type d -name "[0-9]*" 2>/dev/null | sort -V | tail -n 1 | xargs -r basename)"
    echo "Longhorn documentation is up to date (latest available: ${latest_version:-unknown})."
}

case "${TARGET}" in
    talos)
        update_talos
        ;;
    longhorn)
        update_longhorn
        ;;
    all)
        update_talos
        update_longhorn
        ;;
    *)
        echo "Usage: $0 [talos|longhorn|all] [version]"
        exit 1
        ;;
esac
