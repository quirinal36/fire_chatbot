#!/usr/bin/env bash
# Aside 브라우저로 브라우저 흐름을 시험한다 (playwright 대신).
#   e2e/run-aside.sh <chat|case|admin|regression|answer> [WEB_BASE]
# 관리자 흐름은 ADMIN_EMAIL, ADMIN_PASSWORD 가 필요하다.
# Aside 는 자기 세션 폴더 밖에 파일을 못 쓴다. 스크린샷을 세션 안에 남기고 e2e/out/<이름>/ 으로 옮긴다.
# aside repl 은 한 번에 120초까지만 돈다. 흐름 하나를 그 안에 끝내도록 쓴다.
set -euo pipefail
name=${1:?사용법: e2e/run-aside.sh <chat|case|admin|regression|answer|plan-layout|plan-ux|plan-openings> [WEB_BASE]}
base=${2:-http://localhost:5173}
dir=$(cd "$(dirname "$0")" && pwd)
src="$dir/aside/$name.js"
[ -f "$src" ] || { echo "없는 흐름: $name"; exit 1; }
out="$dir/out/$name"
mkdir -p "$out"
script=$(sed \
  -e "s|__NAME__|$name|g" \
  -e "s|__BASE__|$base|g" \
  -e "s|__EMAIL__|${ADMIN_EMAIL:-}|g" \
  -e "s|__PASSWORD__|${ADMIN_PASSWORD:-}|g" \
  "$src")
log=$(mktemp)
aside repl "$script" | tee "$log"
session=$(sed -n 's/.*"session":"\([^"]*\)".*/\1/p' "$log" | tail -1)
if [ -n "$session" ] && [ -d "$session/artifacts/$name" ]; then
  cp "$session/artifacts/$name"/*.png "$out"/ 2>/dev/null || true
  echo "스크린샷: $out"
fi
rm -f "$log"
