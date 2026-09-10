#!/usr/bin/env bash
#
# peak-pricing.sh — switch a Routstr model between off-peak and peak USD pricing.
#
# Peak hours (UTC, Monday-Friday):
#   01:00–04:00  and  06:00–10:00
# All other hours are off-peak. Off-peak is half of peak, so peak = 2x off-peak.
#
# Usage:
#   peak-pricing.sh peak       # apply peak prices (off-peak * PEAK_MULTIPLIER)
#   peak-pricing.sh off-peak   # apply off-peak (baseline) prices
#   peak-pricing.sh auto       # detect from current UTC time and apply
#   peak-pricing.sh status     # show current model pricing (no write)
#
# Intended to be driven by cron at the four daily transitions; see
# `crontab -l` (entries call this script with an explicit peak/off-peak arg).
#
# Override defaults via env: ROUTSTR_PRICING_PROVIDER, ROUTSTR_PRICING_MODEL,
# ROUTSTR_PEAK_MULTIPLIER, ROUTSTR_PRICING_LOG.
#
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
# Target model: DB model id on the provider (public alias: deepseek-v4.1-flash).
PROVIDER="${ROUTSTR_PRICING_PROVIDER:-5}"
MODEL="${ROUTSTR_PRICING_MODEL:-deepseek-flash}"

# Peak multiplier. Off-peak * multiplier = peak. (2 => peak is double.)
PEAK_MULTIPLIER="${ROUTSTR_PEAK_MULTIPLIER:-2}"

# Baseline OFF-PEAK prices, in USD per 1M tokens. Peak is derived from these
# so there is a single source of truth ("off-peak is half of peak").
OFF_PEAK_PROMPT="0.15"
OFF_PEAK_COMPLETION="0.60"
OFF_PEAK_INPUT_CACHE_READ="0.003"

# ── Environment ──────────────────────────────────────────────────────────
# cron runs with a minimal PATH; make sure bun and coreutils are reachable.
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI=(bun run "$REPO_ROOT/src/index.ts")
LOG_FILE="${ROUTSTR_PRICING_LOG:-$HOME/.routstr/peak-pricing.log}"

log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG_FILE"
}

# Multiply two numbers and print without trailing zeros (awk for float math).
mult() {
  awk -v v="$1" -v m="$2" 'BEGIN { printf "%.10g", v * m }'
}

is_peak() {
  local dow hour
  dow="$(date -u '+%u')"   # 1=Mon .. 7=Sun
  hour="$(date -u '+%H')"  # 00..23

  # Weekends are always off-peak.
  [ "$dow" -le 5 ] || return 1
  # 01:00 (inclusive) – 04:00 (exclusive)
  if [ "$hour" -ge 1 ] && [ "$hour" -lt 4 ]; then return 0; fi
  # 06:00 (inclusive) – 10:00 (exclusive)
  if [ "$hour" -ge 6 ] && [ "$hour" -lt 10 ]; then return 0; fi
  return 1
}

apply() {
  local mode="$1" prompt completion cache output
  if [ "$mode" = "peak" ]; then
    prompt="$(mult "$OFF_PEAK_PROMPT" "$PEAK_MULTIPLIER")"
    completion="$(mult "$OFF_PEAK_COMPLETION" "$PEAK_MULTIPLIER")"
    cache="$(mult "$OFF_PEAK_INPUT_CACHE_READ" "$PEAK_MULTIPLIER")"
  else
    prompt="$OFF_PEAK_PROMPT"
    completion="$OFF_PEAK_COMPLETION"
    cache="$OFF_PEAK_INPUT_CACHE_READ"
  fi

  log "apply ${mode}: provider=${PROVIDER} model=${MODEL} prompt=${prompt} completion=${completion} cache_read=${cache} USD/1M"

  if output="$("${CLI[@]}" providers models update "$PROVIDER" "$MODEL" \
    --price-unit per-1m \
    --prompt "$prompt" \
    --completion "$completion" \
    --input-cache-read "$cache" \
    -o json 2>&1)"; then
    log "OK ${mode}: ${output}"
    printf '%s\n' "$output"
  else
    log "ERROR ${mode}: ${output}"
    return 1
  fi
}

show_status() {
  "${CLI[@]}" providers models show "$PROVIDER" "$MODEL" -o json
}

case "${1:-auto}" in
  peak | on)
    apply peak
    ;;
  off-peak | off)
    apply off-peak
    ;;
  auto | sync)
    if is_peak; then
      apply peak
    else
      apply off-peak
    fi
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $(basename "$0") {peak|off-peak|auto|status}" >&2
    exit 2
    ;;
esac
