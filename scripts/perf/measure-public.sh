#!/usr/bin/env bash
# P0 效能量測：只呼叫公開、唯讀的端點（/health、/auth/config），不登入、不寫入任何資料。
# 用法：
#   bash scripts/perf/measure-public.sh https://expense-tracker-api-gmpi.onrender.com/api 3
# 冷啟動量測：先確認後端已閒置 20 分鐘以上（Render 後台 Events 看得到休眠），再執行；
# 第 1 次的 total 就是冷啟動等待時間，之後幾次是暖機狀態。
set -euo pipefail

BASE="${1:?請提供 API 網址，例如 https://.../api}"
RUNS="${2:-3}"
BASE="${BASE%/}"

printf '時間(UTC)\t端點\tHTTP\tDNS\t連線\tTLS\tTTFB\t總計(秒)\n'
for run in $(seq 1 "$RUNS"); do
  for path in /health /auth/config; do
    curl -s -o /dev/null --max-time 180 \
      -w "$(date -u +%H:%M:%S)\t${path}\t%{http_code}\t%{time_namelookup}\t%{time_connect}\t%{time_appconnect}\t%{time_starttransfer}\t%{time_total}\n" \
      "${BASE}${path}" || printf '%s\t%s\t失敗\n' "$(date -u +%H:%M:%S)" "$path"
  done
  if [ "$run" -lt "$RUNS" ]; then sleep 2; fi
done
