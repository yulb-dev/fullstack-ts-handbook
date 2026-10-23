# 第 10 章：调试、Trace Viewer 与 flaky 治理

> 本章目标：建立完整的失败诊断能力：读懂报错与 error context、用 UI Mode / Inspector / `--debug` 交互式调试、用 Trace Viewer 做「时间旅行」复盘；并掌握 flaky 测试的成因分类与治理流程。
>
> 对应总目标：**失败诊断：trace viewer、控制台错误、请求失败、服务器日志和 requestId；重试可以帮助诊断偶发问题，但不能把 flaky 测试当成正常现象。**

---

## 10.1 诊断的第一现场：报错、截图与 error context

测试失败时，Playwright 已经替你收集好了一层现场（取决于第 6 章配置）：

```text
test-results/journey-关键旅程-…-chromium/
├── test-failed-1.png      # 失败瞬间截图（screenshot: 'only-on-failure'）
├── video.webm             # 全程录像（video: 'retain-on-failure'）
├── trace.zip              # 完整 trace（trace: 'retain-on-failure' / CI on-first-retry）
└── error-context.md       # 失败时的页面 ARIA 快照 + 错误详情
```

`error-context.md` 是 1.5x 之后默认生成的宝藏：它是**失败那一刻页面的可访问性树快照（YAML）**。本教程开发过程中一个真实案例——「慢响应加载态」测试失败，报错只说 `getByRole('status')` 找不到元素，而 error-context 直接显示列表数据**已经加载完成**：

```yaml
- main:
    - region "任务列表":
        - combobox "状态": …
        - list:
            - listitem:
                - heading "设计登录页" [level=3]
```

一眼定位根因：不是「loading 没出现」，而是「请求根本没被扣住」——最终查明是在 route handler 内部调用 `page.unroute()` 会立刻放行当前 in-flight 请求（10.6 节案例三）。**先读 error-context，多数「元素找不到」类失败不需要更重的工具。**

诊断工具的升级路径：

```
报错信息 + call log → error-context.md → 截图/视频 → Trace Viewer → UI Mode / --debug 交互复现
```

## 10.2 Trace Viewer：时间旅行复盘

trace 是 Playwright 最强的诊断产物：一个 zip 里装着每个动作前后的 **DOM 快照**、截图胶片、网络请求、控制台日志、动作耗时与源码位置。

```bash
# 本地打开
npx playwright show-trace test-results/<测试目录>/trace.zip

# 或在浏览器打开 https://trace.playwright.dev 拖入 zip（纯本地解析，不上传数据）
# 或直接看远程 trace（如 CI 产物 URL）
npx playwright show-trace https://example.com/trace.zip
```

界面五块区域，对应五类问题：

| 区域               | 回答的问题                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Actions 时间轴** | 每步动作耗时多少？卡在哪一步？（点击动作可看 Before/Action/After 三帧 DOM 快照，Action 帧精确显示点击坐标） |
| **Log**            | actionability 检查逐项日志：元素何时出现、何时稳定、为何点不下去                                            |
| **Network**        | 请求何时发出、状态码、请求/响应体——「接口到底返回了什么」                                                   |
| **Console**        | 页面 console 报错与测试侧日志（图标区分来源），双击动作可过滤到该动作时间段                                 |
| **Source**         | 当前动作对应的测试代码行                                                                                    |

实战流程（以「点击后断言失败」为例）：

1. 时间轴找到失败的断言，看红色错误线的位置；
2. 前一个动作的 **After 快照**：点击真的生效了吗？弹出了什么？
3. **Network** 面板：点击触发的请求状态码是什么？响应体里有没有预期的数据？
4. **Console**：有没有前端异常（如 `Uncaught TypeError`）吞掉了渲染？
5. **Log**：如果是「点不下去」，actionability 日志会写明卡在 visible/stable/receives events 哪一项——十有八九是有遮罩层。

配合第 7 章的服务端日志（如 FlowOps 手册中的 requestId 机制），trace 里的请求头/响应体能把「浏览器侧现象」与「服务端日志」串成一条完整证据链。

## 10.3 交互式调试：UI Mode、Inspector 与 --debug

复盘工具看的是「已发生的失败」；交互式工具用于「现场复现与探索」。

### UI Mode（日常开发主力）

```bash
npx playwright test --ui
```

- 左侧测试树，单测/单文件运行，watch 模式改代码即重跑；
- 每个动作前后快照 + 时间轴（本质是实时 trace）；
- **locator 透视**：点击代码里的 locator，页面高亮所有匹配元素并显示数量——strict violation 无所遁形；
- 注意：UI Mode 默认不跑 setup 项目（登录态过期时手动跑一次 `--project=setup`，第 7 章）。

### Playwright Inspector（--debug）

```bash
npx playwright test tests/journey.spec.ts:50 --debug
```

打开带浏览器的调试器：单步执行、每步查看 actionability 日志、**现场编辑 locator 并立即看到页面高亮**（改对了再抄回代码）。也支持在测试代码里插 `await page.pause()` 只暂停到某一点。

### VS Code 扩展

行号旁点绿箭头跑单测；断点调试；光标悬停 locator 实时高亮匹配。与 CLI 完全兼容，属于体验增强。

### console.log 与 --reporter=line

朴素但有效：测试里 `console.log` 的内容会出现在终端与报告的 stdout 区。调试并行测试时记得 `--workers=1`，否则多 worker 输出交错（本教程 example 的开发过程大量使用了 `--workers=1` + console.log + `page.on('request'/'response')` 的组合）。

## 10.4 flaky 测试：定义、成因与治理流程

**flaky**：同一份代码、同一个测试，不改任何东西，时绿时红。Playwright 报告里它有专门类别：重试后通过的测试标记为 flaky（`passed on retry`）。

### 成因分类（按出现频率）

| 成因               | 典型症状                                               | 解法                                                                          |
| ------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **坏等待**         | 断言在数据到达前采样；`count()`/`isVisible()` 瞬时读取 | 换 web-first 断言（第 4 章）                                                  |
| **共享状态互踩**   | 单独跑必过、并行跑随机挂；重跑上一轮又过               | 唯一命名、专属数据、独立 context（第 5 章）                                   |
| **动画与过渡**     | click 报「元素位置不稳定」                             | 优先关测试环境动画；Playwright 的 stable 检查已能等动画，但无限循环动画等不来 |
| **外部依赖**       | 第三方接口/网络抖动                                    | route mock 第三方（第 8 章）                                                  |
| **时间敏感逻辑**   | 日期边界、倒计时、token 过期                           | `page.clock` API 冻结/快进时间                                                |
| **测试互相踢会话** | 401 随机出现                                           | 登出类操作用专属会话（10.6 案例二）                                           |

### 治理流程（路线图验收项）

1. **可视化**：CI 报告按 flaky 过滤，每周清点；flaky 数 > 0 就当 bug 处理，指定 owner；
2. **复现**：`npx playwright test --repeat-each=20 --workers=4 <file>` 强制高频重跑，把「偶发」变「必现」；
3. **归因**：对必现的失败按上表分类；不能必现的，开 `trace: 'on-all-retries'` 收集样本，用 Trace Viewer 对比成功/失败两轮的差异（通常一眼看出时序或数据差异）；
4. **修复根因**，而不是：加 sleep、加 retry、放 timeout——路线图原话：「重试可以帮助诊断偶发问题，但不能把 flaky 测试当成正常现象」；
5. **防回归**：修复后在 PR 描述里写明根因分类，团队沉淀成 checklist。

`retries` 的正当用途只剩两个：吸收 CI 环境噪音（容器冷启动、网络抖动），以及配合 `on-first-retry` 收集 trace。**如果你的套件需要 retries=3 才能绿，那不是配置问题，是套件生病了。**

## 10.5 一个完整的排障案例：从报错到根因

用本教程 example 开发中的真实失败串一遍流程。

**现象**：`按 id 访问他人工作区的任务同样 403` 之外的多个测试随机失败，`造数接口应当返回 201`，Received: **401**。

**第一步（读报错）**：401 = 未认证。但项目配了 storageState，setup 也成功了——说明**造数时 cookie 失效了**。

**第二步（推理）**：cookie 存在且没过期，服务端却拒绝 ⇒ 服务端 session 被删了。谁会删 session？全局搜 `logout` ⇒ 「创建 → … → 登出」旅程测试在最后登出。

**第三步（验证机制）**：所有测试共享 `alice.json` 里的**同一个 token**；服务端 `sessions.delete(token)` 是全局的。登出测试与造数测试并行时，先登出 ⇒ 别人的 request 全 401。时序图：

```
worker A: [登出测试]──POST /api/logout──▶ 服务端删除 session(token-1)
worker B: [对话框测试]──POST /api/tasks (token-1)──▶ 401 ✘
```

**第四步（修复）**：登出测试改为「干净 context 重新登录，拿到**专属新 token**，再登出吊销它」——吊销的只是自己的会话，共享 token 不受影响（见 `tests/journey.spec.ts` 的登出测试及其注释）。

**第五步（防回归）**：在测试注释里写明「登出必须用专属会话」的原因；这类「服务端共享状态互踩」进入团队 checklist（对应 10.4 表格最后一行）。

这个案例没有用到任何高级工具——**读报错 + 理解系统机制**解决了它。工具（trace/error-context）是在这条路径走不通时才升级的手段。

## 10.6 三个「反直觉」实测行为（本教程开发中踩到的）

真实工程里最难防的是「框架行为与直觉不符」，记录三例（都在 example 的代码注释里有对应标注）：

**案例一：在 route handler 里 `page.unroute()` 会立刻放行当前请求。**
直觉：unroute 只影响「后续」请求，当前 handler 还拿着 route 对象，扣住不放应该继续扣。实测：请求 immediately 继续，「门闩」失效。修复：用标记变量控制放行（`if (!first) return route.continue()`），不在 handler 内部 unroute（见 `resilient.spec.ts` 慢响应测试）。

**案例二：strict violation 的报错是最好的老师。**
`getByLabel('状态')` 命中 3 个元素：工具栏筛选器、任务卡片的「修改「…」的状态」（**子串命中**）、`<dialog>` 里的「状态」——而当时对话框根本没打开！原因：**locator 匹配的是 DOM，关闭的 `<dialog>` 内容仍在 DOM 里**。`exact: true` 也救不了（对话框里的 label 就叫「状态」）。最终修复是改应用：工具栏 label 改为「按状态筛选」。E2E 测试逼迫可访问性命名变得精确——这是良性副作用。

**案例三：跨浏览器行为差异不是 bug，是需求。**
`type="search"` 输入框按 Escape：Chromium/Firefox 清空输入框，WebKit 不动。macOS WebKit 还默认不把 Tab 焦点交给按钮（跟随系统键盘导航设置）。断言平台既定行为时按 `browserName` 分支，或者干脆不断言（Tab 到按钮那步直接删掉，改用表单内 Enter 提交——它在三引擎上行为一致）。**只在所有目标引擎上语义一致的行为才值得无条件断言。**

---

## 常见错误

1. **失败后先看代码再看现场**：顺序反了。报错 call log → error-context → 截图 → trace，逐级升级。
2. **用 `--repeat-each` 前不先 `--workers=1`**：并行下输出交错、复现概率被并发掩盖，先串行必现化，再并行验证。
3. **trace 常开（`trace: 'on'`）**：性能开销大，本地 `retain-on-failure`、CI `on-first-retry` 足够。
4. **把 retry 当 flaky 的解药**：见 10.4——retry 是噪音缓冲和取证工具，不是治疗。
5. **调试时 `console.log` 大对象**：终端里是 `[object Object]`；用 `console.log(JSON.stringify(x, null, 2))` 或直接把信息 `testInfo.attach` 进报告。
6. **忘了测试自己也是共享状态的写入方**：登出、改密码、改全局设置类测试，先问「这会影响别的测试的登录态/数据吗」（10.5）。

## 练习

1. 把 `journey.spec.ts` 登出测试临时改回用共享 `page` fixture 登出（删掉独立 context），`--workers=4` 反复跑全量套件，亲手复现 10.5 的 401 互踩；再改回来。
2. 制造一个必现失败（把某断言的期望值改错），跑完后依次用四种现场诊断：报错 call log → error-context.md → 截图 → `npx playwright show-trace`。在 trace 里找到：失败断言的红色错误线、前一个动作的 After 快照、Network 面板里 `/api/tasks` 的响应体。
3. 用 `--repeat-each=10 --workers=4` 压测 example 全量套件，确认 0 flaky（HTML 报告的 flaky 过滤器应为空）。
4. 给「慢响应加载态」测试临时恢复「handler 内 unroute」的写法，观察门闩失效（复现案例一），再改回标记变量方案。
5. 写一个使用 `page.clock` 的测试：`await page.clock.setFixedTime(new Date('2030-01-01'))` 后加载页面，思考 TaskBoard 要显示什么与时间相关的内容才测得出差异（它目前没有——这个「测不了」本身说明了什么？）。

<details>
<summary>参考答案（要点）</summary>

1. 复现概率取决于登出测试与其他用 request fixture 的测试的并行窗口；跑几轮内应能命中 401 失败。
2. 略。重点体会：trace 的 Network 面板能直接看到响应体 JSON，多数「数据不对」类失败在这一步就能定性是前端渲染问题还是后端数据问题。
3. 若出现 flaky，按 10.4 流程归因（example 当前应当 0 flaky——它的每个「危险点」都已修复并注释）。
4. 现象：`toHaveText('加载中…')` 超时，error-context 显示列表已加载（与本教程开发时一致）。
5. TaskBoard 没有任何时间渲染逻辑，所以固定时钟测不出差异——说明「时间可测性」是应用设计问题：如果产品要显示「3 天前创建」，应用必须消费可注入的时间源，测试才可能覆盖边界（过期、时区、闰年）。这是 E2E 视角反推可测试性设计的例子。

</details>

## 本章验收清单

- [ ] 能按「报错 → error-context → 截图/视频 → trace → 交互调试」的顺序升级诊断手段；
- [ ] 会用 Trace Viewer 的五个面板定位动作、网络、控制台三类问题；
- [ ] 能说出 flaky 的六大成因与对应解法，掌握 `--repeat-each` 必现化手法；
- [ ] 理解 retries 的正当用途边界，坚持「flaky 数 > 0 就是 bug」；
- [ ] 完成过至少一次「从 401 随机失败到共享会话根因」级别的完整排障。

## 官方文档

- [Trace Viewer](https://playwright.dev/docs/trace-viewer) — trace 的录制、打开与五面板
- [Debugging Tests](https://playwright.dev/docs/debug) — UI Mode / Inspector / --debug / VS Code
- [UI Mode](https://playwright.dev/docs/test-ui-mode) — watch 与时间旅行
- [Retries & flakiness](https://playwright.dev/docs/test-retries) — retries 语义与 flaky 分类
- [Clock API](https://playwright.dev/docs/clock) — 时间冻结与快进
- [Troubleshooting](https://playwright.dev/docs/troubleshooting) — 常见环境问题

上一章：[常见交互场景实战](./09-common-scenarios.md) ｜ 下一章：[在 CI 中运行 E2E](./11-ci-integration.md)。
