# 第 2 章：心智模型与第一个 workflow

> 本章目标：精确理解 workflow / event / job / step / runner 五个概念；写出并跑通第一个 workflow；学会在 GitHub UI 观察 run 的结构与日志。
>
> 关键概念：workflow、event、job、step、runner。

---

## 2.1 五个概念的精确关系

```
workflow（.github/workflows/*.yml，一份 YAML 一个 workflow）
  └─ on: event（什么事件触发：push / pull_request / workflow_dispatch ...）
  └─ jobs（并行或按 needs 串行的一组工作）
       └─ runs-on: runner（执行环境：ubuntu-latest 等托管 VM）
       └─ steps（顺序执行的步骤）
            ├─ uses: 复用别人的 action（如 actions/checkout）
            └─ run: 跑 shell 命令
```

- **event** 携带上下文（`github` context）：分支、commit sha、PR 编号、触发者……后续章节的权限与过滤都围绕它；
- **job 是权限与调度的边界**：每个 job 独立 runner、独立 `permissions`；job 之间默认**不共享文件系统**（传文件靠 artifacts，第 8 章）；
- **step 共享 job 的文件系统与环境**：`run` 之间用 `$GITHUB_ENV` / `$GITHUB_OUTPUT` 传值（第 4 章）。

## 2.2 第一个 workflow

把 example 复制成独立仓库推上 GitHub 后，创建 `.github/workflows/hello.yml`：

```yaml
name: Hello CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  hello:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Say hello
        run: |
          echo "分支: $GITHUB_REF_NAME"
          echo "commit: $GITHUB_SHA"
          node --version
```

推上去后，仓库 **Actions** 页签出现 run。点进去能看到：job 列表 → step 列表 → 每步的实时日志。`actions/checkout@v7` 把代码克隆到 runner——**没有它，runner 上只有空目录**，这是新手最常忘的一步。

## 2.3 观察 run 的结构

一次 run 的页面信息值得逐项认识：

- **触发信息**：哪个 event、哪个分支/PR、谁触发；
- **job 图**：并行/依赖关系（第 4 章 needs 会改变它）；
- **每步耗时与退出码**：失败定位的第一现场（第 11 章）；
- **Annotations**：错误摘要；
- **Artifacts**：上传的诊断产物（第 8 章）。

> 养成习惯：每次 CI 失败，先点进**失败的那个 step** 读最后 50 行日志，而不是只看红叉。90% 的答案在那里。

## 2.4 runner：干净的代价与红利

`ubuntu-latest` 是 GitHub 托管的一次性 VM：预装常见工具（Node、Docker、git 等，版本见 runner-images 仓库），**每次 run 全新**。红利：没有「我机器上能跑」；代价：没有任何缓存——依赖每次重装（第 5 章用 cache 加速）、浏览器每次重下（第 8 章）。

## 2.5 常见坑

| 现象                               | 原因                                | 解决                                                     |
| ---------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| workflow 不触发                    | 文件不在仓库根 `.github/workflows/` | 检查路径；example 里的 workflow 需复制到真实仓库根       |
| `run` 里找不到源码                 | 忘了 actions/checkout               | 第一步 checkout                                          |
| 改了 workflow 但 PR 里不生效       | PR 用的是**源分支**的 workflow 版本 | 理解事件上下文（第 3 章）                                |
| `Unexpected value 'on'` 之类解析错 | YAML 缩进/冒号空格                  | 用编辑器 YAML 校验；`on:` 不要写成 `true:`（旧解析器坑） |

## 2.6 本章验收清单

- [ ] 能画出 workflow → event → job → runner → step 的关系；
- [ ] 第一个 workflow 在真实仓库跑绿，能指出触发 event 与 commit sha；
- [ ] 能解释 job 之间为什么不共享文件系统；
- [ ] 知道 runner 是一次性干净 VM 及其代价。

---

上一章：[← 第 1 章：为什么需要 CI/CD](./01-why-ci-cd.md) ｜ 下一章：[第 3 章：事件与触发器 →](./03-events-and-triggers.md) ｜ 返回：[教程目录 README](./README.md)
