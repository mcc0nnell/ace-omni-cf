#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ELIXIP_DIR="${ELIXIP_DIR:-${ROOT_DIR}/.elixip-upstream}"
SCENARIO="${ROOT_DIR}/ports/elixip/omni_conformance.exs"
FIXTURES_DIR="${ROOT_DIR}/conformance/fixtures"
OUTPUT_DIR="${ROOT_DIR}/conformance/generated/elixip"

if [[ ! -f "${ELIXIP_DIR}/apps/elixip2/mix.exs" ]]; then
  echo "Pinned Elixip checkout not found at ${ELIXIP_DIR}" >&2
  echo "Set ELIXIP_DIR to an Elixip checkout before running this script." >&2
  exit 2
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

count=0
while IFS= read -r fixture; do
  name="$(basename "${fixture}")"
  echo "Elixip Omni conformance: ${name}"
  (
    cd "${ELIXIP_DIR}/apps/elixip2"
    OMNI_FIXTURE="${fixture}" \
    OMNI_TRACE_OUT="${OUTPUT_DIR}/${name}" \
      mix scenario "${SCENARIO}"
  )
  count=$((count + 1))
done < <(find "${FIXTURES_DIR}" -maxdepth 1 -type f -name '*.json' | sort)

if [[ "${count}" -eq 0 ]]; then
  echo "No Omni conformance fixtures found in ${FIXTURES_DIR}" >&2
  exit 1
fi

echo "Elixip emitted ${count} Omni semantic traces."
