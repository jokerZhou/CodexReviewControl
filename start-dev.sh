#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
WEBSITE_PID=""

cleanup() {
  local exit_code=$?

  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi

  if [[ -n "${WEBSITE_PID}" ]] && kill -0 "${WEBSITE_PID}" 2>/dev/null; then
    kill "${WEBSITE_PID}" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "${exit_code}"
}

trap cleanup INT TERM EXIT

cd "${ROOT_DIR}/backend"
pnpm run dev &
BACKEND_PID=$!

cd "${ROOT_DIR}/website"
pnpm run dev &
WEBSITE_PID=$!

# 变更说明：
# - macOS 默认 /bin/bash 常见为 3.2，不支持 `wait -n`。
# - 这里先尝试 `wait -n`，失败则回退到兼容轮询逻辑，保证脚本在不同 Bash 版本都可用。
if help wait 2>/dev/null | rg -q -- '-n'; then
  wait -n "${BACKEND_PID}" "${WEBSITE_PID}"
else
  # 兼容模式：每秒检查一次两个子进程是否仍在运行。
  # 只要任意一个进程退出，就结束等待并进入 cleanup 流程。
  while true; do
    if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
      break
    fi
    if ! kill -0 "${WEBSITE_PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi
