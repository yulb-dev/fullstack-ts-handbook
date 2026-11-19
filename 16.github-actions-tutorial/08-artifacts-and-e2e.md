# 第 8 章：artifacts 与 E2E 报告——失败必须留下证据

> 本章目标：分清 cache 与 artifacts；落地 main.yml（集成测试 + 生产构建上的 E2E）；失败时上传 Playwright trace/报告与测试结果；理解诊断产物的安全边界。
>
> 关键概念：Cache 与 artifacts 区别、保存测试报告/coverage/Playwright trace 等诊断产物。｜ 动手练习：练习 2。

---

## 8.1 cache vs artifacts：加速 vs 存证

|          | cache（第 5 章）              | artifacts（本章）                       |
| -------- | ----------------------------- | --------------------------------------- |
| 目的     | 加速后续 run                  | 保存本次 run 的产物/证据                |
| 内容     | 依赖目录（pnpm store）        | 报告、trace、coverage、构建产物         |
| 生命周期 | 按 key 命中复用，7 天未用驱逐 | 按 retention-days（默认 90，可设 1~90） |
| 谁消费   | 下一次 run                    | **人**（下载排障）或下游 job            |
| 失败时   | 无所谓                        | **恰恰失败时最需要**（`if: failure()`） |

一句话：**cache 是给机器用的加速器，artifacts 是给人看的证据链**。

## 8.2 main.yml：比 PR 更重的验证

PR 门禁跑单元/集成 + build；main 再加一层 **E2E smoke**（真实浏览器、生产构建）：

```yaml
name: Main
on:
  push:
    branches: [main]

concurrency:
  group: main-${{ github.ref }}
  cancel-in-progress: false # 每次合并都要完整记录

permissions:
  contents: read

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: test-results
          path: |
            **/test-results/
            **/coverage/
          retention-days: 7
          if-no-files-found: ignore

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Install Playwright browsers
        run: pnpm --filter @workboard/e2e exec playwright install --with-deps chromium
      - name: Run E2E
        run: pnpm e2e
        env: { CI: "true" }
      - name: Upload Playwright report
        if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: |
            e2e/playwright-report/
            e2e/test-results/
          retention-days: 7
          if-no-files-found: ignore
```

要点：

- **E2E 跑在生产构建上**：`pnpm build` 后，playwright.config.ts 的 webServer 用 `node dist/server.js` + `vite preview` 起服务——测的是「将要部署的东西」，不是 dev server；
- **`--with-deps`**：全新 runner 缺浏览器系统依赖，一并安装；
- **`if: failure()`**：只在失败时上传——绿的时候不浪费存储；
- **trace: on-first-retry**（playwright.config.ts）：首次重试才录 trace，平衡成本与诊断。

## 8.3 失败排障演练

E2E 红时的标准动作：

```
Actions → 失败的 run → e2e job → Artifacts 区下载 playwright-report
→ 解压后 npx playwright show-report（本地打开 HTML 报告）
→ 失败用例附 trace.zip → npx playwright show-trace trace.zip
→ 逐帧看页面动作、网络请求、断言失败点（阶段 13 第 10 章的技能）
```

**没有 artifact 的失败 = 没有证据的失败**——只能靠重跑碰运气。这就是路线图把「保存诊断产物」列为核心概念的原因。

## 8.4 诊断产物的安全边界

artifact 任何有仓库读权限的人都能下载，所以：

- **不上传含秘密/真实个人数据的内容**：`.env`、storageState（可能含会话 cookie）、真实数据库 dump 都不行；
- Playwright 的 trace 含请求头——测试里若用了真实 token，trace 就含 token。**测试只用假凭据/测试账号**（阶段 13 的隔离原则）；
- retention 设短（7 天）：证据够用即可，减少暴露窗口。

## 8.5 常见坑

| 现象                           | 原因                           | 解决                                 |
| ------------------------------ | ------------------------------ | ------------------------------------ |
| 失败 run 没有 artifact         | 上传 step 没加 if: failure()   | 加上；注意 if 默认只在成功时跑       |
| artifact 上传报 no files found | 路径不对 / 测试没产出          | if-no-files-found: ignore 或修正路径 |
| E2E 在 CI 挂、本地过           | 测的是 dev server 而非生产构建 | webServer 用 build 产物（8.2）       |
| 浏览器启动失败                 | 缺系统依赖                     | playwright install --with-deps       |
| trace 里发现真实 token         | 测试用了真实凭据               | 换测试账号；已上传的删除并轮换       |

## 8.6 本章验收清单

- [ ] 完成练习 2：main workflow 跑集成 + E2E；
- [ ] 故意弄挂 E2E，下载 report + trace 并定位失败点；
- [ ] 能说出 cache 与 artifacts 的四点区别；
- [ ] 能列出三类不该上传的内容。

---

上一章：[← 第 7 章：权限、秘密与 fork 安全](./07-permissions-secrets-security.md) ｜ 下一章：[第 9 章：部署：环境保护与 OIDC →](./09-deploy-environments-oidc.md) ｜ 返回：[教程目录 README](./README.md)
