# 可访问设计系统与复杂表单实战：从 0 到 1 打通「组件源码 → 校验 → 错误闭环」

> 本教程基于以下**官方最新版本**编写，全部 API 以官方文档为准：
>
> - **shadcn/ui**：自 **2026 年 7 月**起，新项目默认使用 **Base UI** 作为底层无样式原语库（Radix UI 仍完整支持）；`npx shadcn create` 可在两者间选择。
> - **Base UI**：包名为 `@base-ui/react`（旧包名 `@base-ui-components/react` 已重命名），v1.x 稳定版。
> - **React Hook Form**：v7 稳定版 API（v8 目前为 Beta，本教程在需要处会标注差异）。
> - **Zod**：v4（`z.infer` 等价于 `z.output`，输入/输出类型可分离）。
> - **Tailwind CSS**：v4（CSS-first 配置）。
>
> **重要提醒**：网上大量 shadcn/ui 教程仍停留在「Radix + `asChild`」的旧写法。本教程默认走 **Base UI** 路线（`render` prop 组合、`Field`/`Form` 原语），并在关键处对比 Radix 差异，避免你照抄踩坑。

---

## 这份教程解决什么问题

你已经会写 React、会用 Tailwind，但一到「正经做产品」就卡壳：

- 想要一套**能改、能拥有、能长期维护**的设计系统组件，而不是只能调 API 的黑盒库；
- 想做**复杂表单**：字段数组、嵌套对象、条件字段、跨字段校验、异步校验……一上强度就乱；
- 想打通**客户端校验 → 提交 → 服务端校验 → 错误回显**的完整闭环，而不是只会在前端拦一道；
- 想让组件和表单**真正可访问**：label 关联、ARIA 状态、焦点陷阱、Esc 关闭、返回焦点，一个都不少。

这份教程会带你**从 0 搭起一个真实项目**，把上面四件事全部做扎实。

## 学完之后你将能够

1. 说清 shadcn/ui 的「拷入并拥有源码」分发模型，独立维护 **组件源码、design tokens、variants 与自定义边界**；
2. 用 **Base UI primitives** 组装可访问组件，掌握**受控/非受控**、**组合式 `render` API**、弹窗/菜单/Popover/Select、**焦点管理与键盘行为**；
3. 落实**可访问性**：label 与控件关联、ARIA 状态、错误描述、**focus trap**、**Esc 关闭**、**返回焦点**；
4. 熟练使用 **React Hook Form**：`register`、`Controller`、`useForm`、`formState`、`defaultValues`、`reset`、`watch`、`setValue`；
5. 管理完整**表单生命周期**：初始化、dirty/touched、提交中、成功后重置、服务端错误回填与**重复提交防护**；
6. 处理**字段数组、嵌套对象、条件字段、跨字段校验、异步校验与字段级错误**；
7. 用 **Zod** 定义 schema：`object`、`string/number/enum`、`optional/nullable/default`、`refine/superRefine`、`transform`、`safeParse`，并理解 **`z.input` 与 `z.output` 的区别**；
8. 用 **`zodResolver`** 把 Zod 接入 RHF，并牢记一条铁律：**客户端校验是用户体验，不是安全边界**。

---

## FULL-STACK ENGINEERING ROADMAP｜核心能力路线图

本教程对应下面这张「全栈工程能力路线图」中的一段核心链路。每一章都会明确它落在路线图的哪个能力点上，学完即可**逐项验收**。

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     前端工程能力（本教程覆盖区）                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [1] 设计系统所有权          [2] 可访问组件原语        [3] 可访问性合规       │
│      shadcn/ui 源码分发   →     Base UI primitives  →    ARIA / 焦点 / 键盘  │
│      tokens / variants          受控 vs 非受控            label 关联          │
│      自定义边界                 组合式 render             focus trap / esc    │
│         │                          │                        │                │
│         └──────────────┬───────────┴────────────────────────┘                │
│                        ▼                                                      │
│  [4] Schema 校验              [5] 表单状态机             [6] 校验闭环         │
│      Zod v4               →       React Hook Form   →      zodResolver        │
│      z.input / z.output           生命周期 / formState     客户端 + 服务端     │
│      transform / refine           数组 / 嵌套 / 异步        错误回显           │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                     [7] 服务端校验（安全边界）
                         同一套 Zod schema 前后端复用
                         返回结构化错误 → setError 回填
```

| 能力点         | 对应章节   | 一句话验收标准                                     |
| -------------- | ---------- | -------------------------------------------------- |
| 设计系统所有权 | 第 1、2 章 | 能解释源码分发，能改 token/variant 且知道边界      |
| 可访问组件原语 | 第 3 章    | 能用 Base UI 组装受控/非受控组件并说明键盘行为     |
| 可访问性合规   | 第 4 章    | 弹窗满足 focus trap / Esc / 返回焦点 / label 关联  |
| Schema 校验    | 第 5 章    | 能写 refine/transform，能说清 `z.input`≠`z.output` |
| 表单状态机     | 第 6、7 章 | 能管理 dirty/touched/submitting，能防重复提交      |
| 校验闭环       | 第 8 章    | 客户端+服务端错误都能落到对应字段并回显            |
| 复杂字段       | 第 9 章    | 数组/嵌套/条件/跨字段/异步都能正确校验报错         |
| 综合实战       | 第 10 章   | 独立完成一个可访问的复杂表单并通过验收清单         |

---

## 章节目录

| 章节     | 标题                                                           | 内容概要                                                                                                            |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 第 1 章  | [全景与环境搭建](./01-landscape-and-setup.md)                  | 四个库的分工与心智模型、Vite+React+TS+Tailwind v4+shadcn(Base UI) 从 0 搭建、项目结构、跑通第一个组件               |
| 第 2 章  | [shadcn/ui 的「拥有源码」模型](./02-shadcn-ownership-model.md) | 源码分发 vs 黑盒库、`components.json`、design tokens、`cva` variants、自定义边界与升级权衡                          |
| 第 3 章  | [Base UI primitives](./03-base-ui-primitives.md)               | 受控/非受控、组合式 `render` API、Popover/Menu/Select/Dialog 结构、焦点管理与键盘行为                               |
| 第 4 章  | [可访问性实战](./04-accessibility.md)                          | label 与控件关联、ARIA 状态、错误描述、focus trap、Esc 关闭、返回焦点                                               |
| 第 5 章  | [Zod：schema 与类型](./05-zod-schema-and-types.md)             | object/primitive/enum、optional/nullable/default、refine/superRefine、transform、safeParse、`z.input` vs `z.output` |
| 第 6 章  | [React Hook Form 核心](./06-react-hook-form-core.md)           | useForm、register、Controller、formState、defaultValues、reset、watch、setValue，非受控性能模型                     |
| 第 7 章  | [表单生命周期](./07-form-lifecycle.md)                         | 初始化、dirty/touched、提交中、成功后重置、服务端错误、重复提交防护                                                 |
| 第 8 章  | [zodResolver 与校验闭环](./08-resolver-and-validation-loop.md) | 接入 zodResolver、客户端 vs 服务端边界、setError 回填、结构化错误映射                                               |
| 第 9 章  | [复杂字段与高级校验](./09-advanced-fields.md)                  | useFieldArray、嵌套对象、条件字段、跨字段校验、异步校验、字段级错误                                                 |
| 第 10 章 | [综合实战与逐项验收](./10-capstone-and-acceptance.md)          | 完整「LaunchPad 云实例开通表单」、逐项验收清单、常见坑与延伸                                                        |

---

## 学习路线建议

```
第 1 章（搭环境，建立全景心智）
   └─> 第 2 章（理解 shadcn 拥有源码模型）★ 设计系统的地基
         └─> 第 3 章（Base UI primitives）★ 组件怎么拼、焦点怎么管
               └─> 第 4 章（可访问性）★ 弹窗/表单的合规底线
                     ├─> 第 5 章（Zod）      ← 校验的"数据契约"
                     └─> 第 6 章（RHF 核心） ← 表单的"状态机"
                           └─> 第 7 章（表单生命周期）
                                 └─> 第 8 章（zodResolver + 校验闭环）★ 前后端打通
                                       └─> 第 9 章（复杂字段）
                                             └─> 第 10 章（综合实战 + 验收）
```

- **每章都有可运行代码和练习**，强烈建议边读边敲，不要只用眼睛看；
- 第 3、4 章是「可访问组件」的灵魂，第 5、8 章是「校验闭环」的灵魂，值得反复读；
- 第 5、6 章彼此独立，可以任意顺序，但都要在第 8 章之前学完。

---

## 贯穿全书的实战项目：LaunchPad

教程从第 3 章起围绕一个真实场景逐步演进——「**LaunchPad：云服务实例开通表单**」。它天然覆盖了复杂表单的所有难点：

- **嵌套对象**：实例配置（region / plan / 副本数）；
- **枚举 + 条件字段**：选了「自动扩缩容」才显示阈值滑块；
- **字段数组**：环境变量列表、通知邮箱列表（可增删）；
- **跨字段校验**：最小副本数 ≤ 最大副本数、确认密码一致；
- **异步校验**：实例名唯一性（防抖请求后端）；
- **服务端错误回显**：优惠码过期、配额不足等提交后才暴露的错误；
- **可访问弹窗**：开通前的二次确认 Dialog（focus trap / Esc / 返回焦点）；
- **重复提交防护**：提交中禁用、幂等处理。

到第 10 章，你会把它拼成一个完整、可访问、前后端校验闭环的作品。

---

## 官方资源（务必以官方为准）

- shadcn/ui 文档：<https://ui.shadcn.com/docs>（表单指南：`/docs/forms/react-hook-form`）
- Base UI 文档：<https://base-ui.com>（每页顶部有 **View as Markdown**，对喂给 AI 很友好；Handbook 里有 Styling / Composition / Forms / Accessibility）
- React Hook Form 文档：<https://react-hook-form.com>（API：`/docs/useform`）
- Resolvers（含 zodResolver）：<https://github.com/react-hook-form/resolvers>
- Zod 文档：<https://zod.dev>（基础：`/basics`，完整 API：`/api`，v4 迁移：`/v4/changelog`）
- Tailwind CSS v4：<https://tailwindcss.com/docs>

> 版本会持续演进。开始动手前，花两分钟核对一遍上面的官方页面，确认你项目锁定的主版本与之一致。
