#!/usr/bin/env bash
# 镜像秘密审计（路线图阶段 15 练习 4）：
# 确认没有数据库密码 / Better Auth secret / 真实 .env 被烘焙进镜像。
# 用法: bash scripts/audit-image.sh workboard-api:local
set -euo pipefail

IMAGE="${1:?用法: audit-image.sh <image:tag>}"

echo "== 1. 构建历史：检查每一层做了什么（重点看 COPY/ENV/ARG）=="
docker history --no-trunc "$IMAGE"

echo
echo "== 2. 镜像元数据里的环境变量（ENV 烘焙进层的值在这里现形）=="
docker image inspect "$IMAGE" --format '{{json .Config.Env}}'

echo
echo "== 3. 文件系统里搜秘密文件（.env / 私钥）=="
docker run --rm --entrypoint sh "$IMAGE" -c '
  found=$(find /app -maxdepth 4 \( -name ".env*" -o -name "*.pem" -o -name "*.key" \) -print)
  if [ -n "$found" ]; then
    echo "发现可疑文件:"; echo "$found"; exit 1
  fi
  echo "OK: /app 下没有 .env / 私钥文件"
'

echo
echo "== 4. 运行用户（应为非 root，例如 node）=="
docker image inspect "$IMAGE" --format 'Config.User = {{.Config.User}}'

echo
echo "== 5. 构建历史中搜索疑似秘密赋值（人工复核输出）=="
if docker history --no-trunc "$IMAGE" | grep -iE '(PASSWORD|SECRET|TOKEN|API_KEY)='; then
  echo "!! 发现疑似秘密赋值，请逐条人工确认"
  exit 1
fi
echo "OK: 构建历史中没有疑似秘密赋值"