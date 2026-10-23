# 从 0 到 1：用 shadcn/ui（Base UI）+ React Hook Form + Zod 构建设计系统与复杂表单

**适合读者：** 会一点 JavaScript / React，刚开始做 TypeScript 表单的开发者。  
**教程目标：** 不只拼出一个表单，而是理解组件源码如何维护、复杂交互如何访问、表单状态如何流转，以及客户端错误如何和服务端验证闭环。  
**文档基线：** 按 2026-10-22 可查到的官方文档组织。shadcn/ui 新项目目前默认采用 Base UI；Radix UI 仍受支持，已有 Radix 项目不需要为了学习本教程而迁移。

> 学习方式：建议按章节实际敲代码。每章末尾的“完成标准”是验收点；不要只复制整份代码后一次性调试。

## 学完以后，你会做出什么？

我们会做一个“创建工作区账号”的表单。它包含用户名、邮箱、年龄、账号类型、条件显示的公司名称、嵌套的网站地址、密码确认、订阅开关和联系人动态数组。提交时依次经历：浏览器中的即时反馈、Zod 类型解析、服务器重新校验、服务端字段错误回填、提交中防重复提交，以及成功后重置。另会单独拆解 Dialog、Menu、Popover、Select 的组合式 API 与焦点行为。

---

## 第 1 章：先建立正确的心智模型

### 1.1 shadcn/ui 不是“装好就只能调用”的黑盒组件包

传统组件库通常把组件作为依赖发布：你通过包版本获得按钮、弹窗、下拉框等组件，再用 props 或 CSS 覆盖样式。shadcn/ui 的核心区别是**分发可被复制、阅读和修改的组件源码**。CLI 帮你把选定组件加入项目；源码落在自己的仓库，团队可以直接改动它。

它因此更像“组件源码分发方式 + 一套设计系统起点”，而不是一个必须始终黑盒使用的组件包。官方说明也强调 open code、composition 和 distribution。[官方介绍](https://ui.shadcn.com/docs)

这带来三个责任：

1. **源码由你维护。** 组件被复制到仓库后，它就是项目代码；升级时要审查差异，而不是假设 `npm update` 会自动更新它。
2. **tokens 是一致性的底座。** 颜色、边框、圆角、阴影、间距等应尽量以语义 token 表达。不要让每个业务页面各自写一套近似但不相同的颜色值。
3. **variants 和自定义边界要有约定。** 通用的 `Button` 负责外观与基础交互；“保存并发布”这种业务操作应该放在业务组件中，不要把业务 API 请求塞进通用按钮源码。

### 1.2 Base UI、shadcn/ui、RHF、Zod 分别负责什么？

| 层 | 解决的问题 | 不应该承担的职责 |
|---|---|---|
| Base UI primitives | 无样式或低样式的交互原语、键盘导航、ARIA、焦点管理 | 不替你决定品牌色与业务流程 |
| shadcn/ui 组件源码 | 把原语包装成项目可维护的 Button、Dialog、Select、Field 等设计系统组件 | 不替你判断业务数据是否合法 |
| React Hook Form（RHF） | 表单值、dirty/touched、提交生命周期、字段注册、错误状态 | 不应成为后端安全校验的唯一关卡 |
| Zod | 运行时数据解析、验证、转换和 TypeScript 类型推导 | 不负责把错误消息放到正确的 DOM 位置 |
| 服务端 API / 数据库 | 对真实请求重新验证、授权、检查唯一性并持久化 | 不能信任客户端已经校验过 |

可以把它想成一条管线：**交互组件收集输入 → RHF 管理状态 → Zod 解析输入 → 请求服务端 → 服务端再次验证 → 服务端错误映射回 RHF → 组件以可访问方式显示错误。**

### 1.3 先区分 Base UI 原语 API 和 shadcn 包装 API

直接使用 Base UI 时，你会看到 `Dialog.Root`、`Dialog.Trigger`、`Dialog.Portal`、`Dialog.Popup` 这样的部件组合；shadcn/ui 的包装组件通常写成 `Dialog`、`DialogTrigger`、`DialogContent`。两者不是互相矛盾的写法：前者是 primitive 的组合式 API，后者是项目设计系统提供的更高层接口。

**新项目**按初始化提示选择 Base UI；已存在的 Radix 项目可以继续用，不要把两套 primitive 的 props 和行为混用。尽量从当前项目的 `components/ui/*` 导出入口导入 UI，别在同一功能里一会儿用包装组件、一会儿又绕过包装直接导入另一套 primitive。[Base UI 默认说明](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) · [Base UI 组件文档](https://base-ui.com/react/overview)

**本章完成标准：** 你能说清谁管理“长什么样”、谁管理“怎么交互”、谁管理“数据是否有效”，并且知道复制进仓库的组件需要由团队维护。

---

## 第 2 章：创建项目并安装组件

下面用 Next.js App Router + TypeScript 示范。你也可以把相同的 schema 和 RHF 代码放入 Vite React 项目；只有服务端路由示例会不同。

### 2.1 创建项目

```bash
pnpm create next-app@latest form-studio --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd form-studio
pnpm dlx shadcn@latest init
```

初始化时按 CLI 提示选择 Base UI。CLI 会写入 `components.json`、样式配置和必要工具。具体模板选项可能随 CLI 版本变化，以当前交互提示为准。`components.json` 记录组件风格、CSS 变量、别名等生成配置；如果你完全手工复制源码而不使用 CLI，它并非必需。[components.json 文档](https://ui.shadcn.com/docs/components-json)

### 2.2 安装表单依赖与需要的 UI 组件

```bash
pnpm add react-hook-form zod @hookform/resolvers
pnpm dlx shadcn@latest add button input textarea select checkbox field dialog popover dropdown-menu
```

如果你的包管理器是 npm 或 yarn，把命令前缀换成对应工具即可。组件安装完成后，检查 `src/components/ui/`；本教程假定应用别名 `@/` 指向 `src/`。

### 2.3 推荐的目录边界

```text
src/
  app/
    api/register/route.ts        # 服务端 POST 入口
    register/page.tsx            # 页面
  components/
    ui/                           # shadcn 分发进来的通用组件源码
    forms/
      registration-form.tsx       # 业务表单组合
  lib/
    schemas/registration.ts       # 表单与 API schema
    utils.ts                      # cn 等工具
```

不要把全部内容写进一个巨型组件。通用 `ui/` 不依赖具体业务；`forms/` 可以依赖 `ui/` 和 schema；服务端 route 可以依赖 schema 与数据访问层。这样的单向依赖边界会让设计系统更容易维护。

**本章完成标准：** 项目运行正常，CLI 已生成 Base UI 风格的组件代码，且你知道组件源码、业务组合和 schema 分别放哪里。

---

## 第 3 章：维护 tokens、variants 与自定义边界

### 3.1 Token：先表达语义，再选择颜色

推荐在全局样式中用语义变量，例如 `--background`、`--foreground`、`--primary`、`--muted`、`--border`、`--destructive`。组件应该消费这些变量，而不是在不同页面硬编码“这个边框是 `#e6e6e6`，那个错误文字是另一个红色”。这样切换主题、暗色模式或品牌时，修改一处 token 就能让整体协调变化。

shadcn/ui 的全局样式会因所选 style、Tailwind 版本和 CLI 模板不同而不同。**不要把本教程当成要完整覆盖原 CSS 的模板**；先保留 CLI 生成的 CSS，再把团队的语义 token 加进去。CSS 变量与主题配置见[官方主题文档](https://ui.shadcn.com/docs/theming)。

### 3.2 Variants：允许的是“有名字的差异”，不是随处覆盖

Button 的 variants 适合表达稳定的视觉意图，例如 `default`、`secondary`、`outline`、`destructive`、`ghost`、`link`；size 则表达 `sm`、`default`、`lg`、`icon` 等尺寸。业务页面调用时写：

```tsx
<Button variant="destructive" size="sm">
  删除成员
</Button>
```

而不是每个调用者都写一长串 Tailwind 类。需要自定义变体时，先检查 `src/components/ui/button.tsx` 里已有的变体定义，再按项目风格扩展。shadcn 生成源码常使用 `class-variance-authority`（CVA）组织 variants；不要只为一个页面的偶然需求污染全局 `Button` API。

### 3.3 哪些地方应该改？

- **跨页面、跨产品区一致的基础外观**：改 tokens 或 `components/ui/*`。
- **可复用但有业务语义的组合**：新建 `components/forms/` 或 `components/shared/` 组件，例如 `LabeledTextField`。
- **特定页面一次性的排版**：优先留在页面层，不要为此增加全局 variant。
- **复杂交互行为**：尽可能调用 Base UI/shadcn 已提供的键盘和焦点机制；不要为了动画或样式重写弹窗的核心事件处理。

### 3.4 如何安全地更新源码？

1. 升级前提交 Git commit。
2. 运行 CLI 的 add/update 相关操作前后查看 `git diff`。
3. 检查依赖、ARIA 属性、focus 行为和自定义类是否改变。
4. 用键盘和屏幕阅读器相关测试重新验收。
5. 如果已大量修改组件，先把改动拆成“上游可同步的基础修改”和“项目自己的包装层”。

**本章完成标准：** 能指出项目的 token 来源、Button 的 variants 定义位置，并能解释为什么不应该将某个页面的业务请求写入通用组件。

---

## 第 4 章：Base UI 的组合式 API、受控状态与焦点

Base UI 的关键价值不只是“有一个弹窗组件”，还在于把一个复杂交互拆成语义明确的部件，同时负责许多键盘与 ARIA 细节。[无障碍概览](https://base-ui.com/react/overview/accessibility)

### 4.1 受控与非受控：谁是状态的所有者？

**非受控（uncontrolled）**：只传初始状态，如 `defaultOpen`；组件内部维护当前打开状态。适合普通下拉菜单、简单提示。

**受控（controlled）**：父组件传 `open` 和 `onOpenChange`，状态由 React state 管理。适合“提交成功才关闭”“从页面其他按钮打开”“根据权限决定是否允许关闭”等需求。

直接 Base UI 的 Dialog 示意：

```tsx
import * as React from "react"
import { Dialog } from "@base-ui/react/dialog"

export function FeedbackDialog() {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开反馈
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>发送反馈</Dialog.Title>
            <Dialog.Description>
              请描述你遇到的问题。
            </Dialog.Description>
            <Dialog.Close>取消</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
```

这段是 **Base UI primitive** 的写法；如果项目使用 shadcn 包装，则应按 `@/components/ui/dialog` 的 `Dialog`、`DialogTrigger`、`DialogContent` 等接口书写。不要复制代码时混在一起。

### 4.2 Dialog、Menu、Popover、Select 各自适合什么？

| 组件 | 典型用途 | 学习时重点检查 |
|---|---|---|
| Dialog | 编辑表单、确认操作、需要打断当前任务的内容 | 打开时焦点进入弹窗；Escape 关闭；关闭后焦点回到触发点；模态时背景不可交互 |
| Dropdown Menu | 一组即时操作，如重命名、复制、删除 | 方向键移动高亮；Enter/Space 触发；Escape 关闭；Tab 行为符合菜单模式 |
| Popover | 日历、轻量辅助编辑器、锚定触发器的浮层 | 弹层定位、关闭时机、是否需要 focus trap；普通非模态 Popover 不应随意限制页面交互 |
| Select | 从有限、非可搜索选项中选择一个或多个值 | 有可访问名称；方向键/字符键导航；当前值和选项值稳定；大列表改用 Combobox |

Base UI Select 官方建议：选项多到需要过滤时优先考虑 Combobox；Select Trigger 必须有可访问名称，通常用可见 Label，只有没有可见标签时才用 `aria-label`。[Base UI Select](https://base-ui.com/react/components/select)

### 4.3 shadcn 包装组件的 Select 示例

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const themes = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
]

export function ThemeSelect() {
  return (
    <Select defaultValue="system">
      <SelectTrigger aria-label="主题">
        <SelectValue placeholder="选择主题" />
      </SelectTrigger>
      <SelectContent>
        {themes.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
```

在正式表单里最好有可见标签，并用 `Controller` 连接 RHF；本教程第 7、9 章会做。

### 4.4 焦点和键盘行为是交互契约

设计 Dialog 或 Popover 时，至少检查以下行为：

- 打开后键盘焦点去哪里？是否被送到合理的初始控件？
- 如果是模态弹窗，Tab / Shift+Tab 是否被限制在弹窗内？
- Escape 是否能关闭？如果关闭会丢失重要内容，要如何设计合理的确认流程？
- 关闭后是否回到原来的触发器或指定元素？
- 弹层打开时，读屏软件能否读出标题和描述？
- 禁用状态、展开状态、选中状态是否有正确的 ARIA / 原生语义？

Base UI Dialog 提供 `initialFocus` 和 `finalFocus` 等焦点控制；模态 Dialog 默认处理焦点约束，且当使用模态或 `trap-focus` 模式时，应在 Popup 内提供 Close 入口，方便触屏读屏用户退出。[Dialog 焦点与模态行为](https://base-ui.com/react/components/dialog)

**本章完成标准：** 能根据场景选 Dialog / Menu / Popover / Select；能解释 `open + onOpenChange` 和 `defaultOpen` 的区别；用键盘可以打开、操作、退出并回到触发元素。

---

## 第 5 章：可访问字段的结构与错误描述

可访问性不是最后加上的装饰。它决定了键盘用户和屏幕阅读器用户能否理解“哪个字段要填什么、现在出了什么错、应该怎么修复”。

### 5.1 标签必须和控件建立关系

原生输入框最直接的关联方式是 `label htmlFor` 对应控件 `id`：

```tsx
<Field>
  <FieldLabel htmlFor="display-name">显示名称</FieldLabel>
  <Input id="display-name" name="displayName" autoComplete="name" />
  <FieldDescription id="display-name-help">
    这个名称会显示在工作区成员列表中。
  </FieldDescription>
</Field>
```

不要只用 placeholder 代替 label。placeholder 会在用户输入后消失，也不一定能作为明确的字段名称。

### 5.2 错误必须被机器和人理解

当输入值无效时，除了红色边框，还需要：

- 给控件设置 `aria-invalid="true"`；有效时不要始终保留它。
- 用 `aria-describedby` 把控件关联到帮助文案和错误文案。
- 错误文字要具体说明如何修复，例如“请输入有效邮箱”，而不是只说“错误”。
- 颜色不能成为唯一信号；文字、图标或边框等要协同表达。
- 提交失败时把焦点移到第一个无效字段（RHF 可通过正确传递 ref 实现）。

示意：

```tsx
const error = form.formState.errors.email

<Field data-invalid={Boolean(error)}>
  <FieldLabel htmlFor="email">邮箱</FieldLabel>
  <Input
    id="email"
    type="email"
    aria-invalid={Boolean(error)}
    aria-describedby={error ? "email-error" : "email-help"}
    {...form.register("email")}
  />
  <FieldDescription id="email-help">用于登录和接收通知。</FieldDescription>
  {error && (
    <FieldError id="email-error" role="alert">
      {error.message}
    </FieldError>
  )}
</Field>
```

如果你的 shadcn `FieldError` 版本使用 `errors` 属性而不是 children，就按生成源码的类型定义传入，例如 `fieldState.invalid && <FieldError errors={[fieldState.error]} />`。关键原则是：**错误节点真实存在，ID 对得上，控件也标记为 invalid**。组件 API 会随所选底层库与模板变化，项目源码才是最终依据。[shadcn Field](https://ui.shadcn.com/docs/components/base/field)

### 5.3 Field、FieldLabel、FieldDescription、FieldError 如何分工

- `Field`：字段容器，承担布局和错误态样式。
- `FieldLabel`：可见标签，与输入控件关联。
- `FieldDescription`：帮助用户正确填写的信息，不要塞进错误里。
- `FieldError`：一个或多个校验错误的可见呈现。
- `aria-invalid` / `aria-describedby`：把视觉状态与辅助技术建立联系。

**本章完成标准：** 用 Tab 能依次访问控件；每个控件都有名称；发生错误时能听到/读到清楚的错误，并且控件与错误文案有关联。

---

## 第 6 章：从 0 学 Zod：描述数据，而不只是写 if

Zod 是运行时 schema 与 TypeScript 类型推导工具。TypeScript 类型在编译后不会自动验证网络请求；Zod 则能在运行时真正解析未知数据。[Zod 基础](https://zod.dev/basics)

### 6.1 最基本的 schema

```ts
import { z } from "zod"

const profileSchema = z.object({
  name: z.string().trim().min(2, { error: "至少输入 2 个字符" }),
  email: z.email({ error: "请输入有效邮箱" }),
  age: z.number().int().min(18).max(120),
  role: z.enum(["member", "admin"]),
})

type Profile = z.infer<typeof profileSchema>
// { name: string; email: string; age: number; role: "member" | "admin" }
```

重点不是记住所有方法，而是读懂数据形状：`object` 定义对象；`string` / `number` 定义值类型；`enum` 限定选项；`.min()`、`.max()` 等添加规则；`.trim()` 归一化前后空格。Zod 4 推荐使用顶层格式 schema（例如 `z.email()`）；项目如果仍在 Zod 3，部分写法会不同，以锁定版本的 API 为准。

### 6.2 `optional`、`nullable`、`default` 不是一回事

```ts
const schema = z.object({
  nickname: z.string().optional(), // 缺少值或 undefined 都可接受
  middleName: z.string().nullable(), // 必须有这个键，但值可为 null
  locale: z.string().default("zh-CN"), // 输入为 undefined 时输出默认值
})
```

- `optional()` 允许 `undefined`；它不会自动把 `null` 变成空字符串。
- `nullable()` 允许 `null`；不代表字段可以缺省。
- `default()` 会在解析时填入默认值。使用 default 时，schema 的 input 类型可能比 output 类型更宽。
- `nullish()` 同时允许 `null` 和 `undefined`，不要因为方便就对所有字段都使用它。

表单默认值和 schema 默认值解决的不是完全相同的问题：`defaultValues` 让 UI 一开始显示什么；Zod `.default()` 规定缺值通过解析后应得到什么。

### 6.3 HTML 输入是字符串：使用 transform 建立边界

`input type="number"` 的 DOM 值经常仍是字符串。直接把字符串当数字验证会失败；直接 `Number("")` 又会得到 `0`，有机会把空值误判成真实年龄。

我们会先验证输入是非空数字字符串，再转换成 number：

```ts
const ageTextSchema = z
  .string()
  .trim()
  .min(1, { error: "请输入年龄" })
  .regex(/^\d+$/, { error: "年龄必须是整数" })
  .transform(Number)
  .pipe(z.number().int().min(18, { error: "必须年满 18 岁" }).max(120))

const age = ageTextSchema.safeParse("25")
// success === true, data === 25
```

`.transform(Number)` 转换通过前置检查的输入，`.pipe()` 再把转换后的结果交给 number schema 校验。避免盲目用 `z.coerce.number()` 处理所有表单数字；先决定空字符串、空白和非法文本应该怎么处理。

### 6.4 `refine` 与 `superRefine`：写业务规则

`refine` 适合一个条件、一个错误：

```ts
const usernameSchema = z.string().refine(
  (value) => !value.includes(" "),
  { error: "用户名不能包含空格" },
)
```

`superRefine` 适合跨字段规则或一次添加多个错误。比如确认密码需要指向 `confirmPassword`：

```ts
const passwordSchema = z.object({
  password: z.string().min(10),
  confirmPassword: z.string().min(1),
}).superRefine((data, ctx) => {
  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "两次输入的密码不一致",
    })
  }
})
```

`path` 决定错误归属到哪个字段；没有正确的路径，用户可能只看到一个“表单无效”而不知道该改哪一格。

### 6.5 `parse` 与 `safeParse`

```ts
const result = profileSchema.safeParse(candidate)

if (!result.success) {
  console.log(result.error.issues) // 结构化错误数组
} else {
  console.log(result.data) // 已验证、可能转换过的数据
}
```

`parse` 成功时返回解析数据，失败时抛异常；`safeParse` 返回带 `success` 的结果，更适合处理客户端输入和 API 请求，不必依赖异常流控制。若 schema 中使用了异步 refinement/transform，应使用 `parseAsync` / `safeParseAsync`。这些 API 的区别见[官方 Basics](https://zod.dev/basics) 和 [Schema API](https://zod.dev/api)。

### 6.6 `z.input` 与 `z.output`：把输入类型和业务数据类型分开

```ts
const ageSchema = z.string().transform(Number)

type AgeInput = z.input<typeof ageSchema>   // string
type AgeOutput = z.output<typeof ageSchema> // number
```

这一区别非常重要：用户在输入框里编辑的是字符串；业务逻辑希望拿到的是 number。RHF 应管理 `input` 类型，而 `handleSubmit` 的回调可以接收经过 Zod resolver 解析后的 `output` 类型。下一章会把这两个类型接起来。

**本章完成标准：** 能用 Zod 定义对象、字符串、数字、枚举、可选字段、默认值、跨字段错误和 transform；能解释 `safeParse` 返回什么，以及为什么 input/output 类型可能不一样。

---

## 第 7 章：React Hook Form 的状态和生命周期

RHF 的重点是让表单状态有明确的所有者，并尽量减少不必要的重渲染。它不是“把所有 input 都变成 React state”的同义词。[React Hook Form 官网](https://react-hook-form.com/)

### 7.1 `useForm`：建立表单状态

```tsx
const form = useForm({
  defaultValues: {
    displayName: "",
    email: "",
  },
  mode: "onBlur",
  reValidateMode: "onChange",
})
```

- `defaultValues`：初始输入值。对象/数组字段最好明确提供稳定结构；它会被缓存。
- `mode`：第一次验证的时机：`onSubmit`、`onBlur`、`onChange`、`onTouched`、`all`。
- `reValidateMode`：提交后再次验证的时机。
- `formState`：例如 `errors`、`isDirty`、`dirtyFields`、`touchedFields`、`isSubmitting`、`isSubmitSuccessful`。
- `handleSubmit(onValid, onInvalid)`：负责校验后分流调用。

初学者常把 `onChange` 设为所有字段的默认模式，以为越快反馈越好。它可能让每次按键都触发更重的验证。很多复杂表单可以先用 `onBlur`，用户离开字段时提示；提交后再用 `reValidateMode: "onChange"` 帮用户修正。

### 7.2 `register`：适合原生输入控件

```tsx
const { register, formState: { errors } } = form

<Input id="email" type="email" {...register("email")} />
{errors.email && <p role="alert">{errors.email.message}</p>}
```

`register` 主要把 `name`、`onChange`、`onBlur`、`ref` 等接入 RHF。不要随手覆盖这些 handler；如果自己写了 `onChange`，要确保 RHF 依然收到新的值。

### 7.3 `Controller`：适合自定义受控组件

像 Select、Checkbox、Switch 等组件通常用 `value` / `onValueChange` 或 `checked` / `onCheckedChange`，并不一定遵循原生 input 的 `onChange(event)` 模式。此时用 `Controller`：

```tsx
<Controller
  name="accountType"
  control={form.control}
  render={({ field, fieldState }) => (
    <Select value={field.value} onValueChange={field.onChange}>
      {/* Trigger 负责展示当前值；把 field.ref/onBlur 连接到可聚焦触发器 */}
    </Select>
  )}
/>
```

`field` 常用属性：`value`、`onChange`、`onBlur`、`name`、`ref`。`fieldState` 常用 `invalid`、`error`、`isTouched`。对自定义控件，记住把 `ref` 交给实际可聚焦元素，才能让“提交时自动聚焦第一个错误字段”发挥作用。

不要对同一个控件同时使用 `register` 和 `Controller`。

### 7.4 `watch` / `useWatch`：根据字段值改变界面

```tsx
const accountType = useWatch({
  control: form.control,
  name: "accountType",
})

return accountType === "business" ? <CompanyNameField /> : null
```

`watch` 可以从表单层读取当前值；`useWatch` 很适合在较小的子组件里订阅某些字段，减少整个表单重新渲染。不要对全表单无节制地 watch 再把每次变化都写入外部状态。

### 7.5 `setValue`、`reset` 与 dirty/touched

```tsx
form.setValue("profile.website", "https://example.com", {
  shouldDirty: true,
  shouldTouch: true,
  shouldValidate: true,
})

// 让表单回到默认值
form.reset()

// 编辑页拿到异步加载的记录后，用服务器数据重置“基线”
form.reset(serverRecord)
```

- **dirty**：当前值是否偏离默认值。
- **touched**：用户是否与字段交互并离开过（通常由 blur 标记）。
- **reset**：不只是把输入框清空；它还会更新表单基准与相关状态。编辑模式通常在异步加载数据后调用 `reset(record)`。
- **setValue**：程序化更新某个字段；根据需求显式设置 `shouldDirty`、`shouldTouch`、`shouldValidate`。

### 7.6 提交生命周期与重复提交保护

```tsx
const onSubmit = async (values: Values) => {
  await save(values)
  form.reset()
}

return (
  <form onSubmit={form.handleSubmit(onSubmit)}>
    {/* fields */}
    <Button type="submit" disabled={form.formState.isSubmitting}>
      {form.formState.isSubmitting ? "提交中…" : "提交"}
    </Button>
  </form>
)
```

RHF 会跟踪通过 `handleSubmit` 执行的异步提交，并设置 `isSubmitting`。禁用提交按钮能防止常见的重复点击；服务端仍应考虑幂等性、唯一约束或重复请求保护，因为用户还可能通过网络重试或其他客户端发送重复请求。

**本章完成标准：** 能说明 `register` 与 `Controller` 的适用范围；能用 `watch/useWatch` 实现条件字段，用 `setValue` 更新嵌套值，用 `reset` 处理成功和异步初始化，并用 `isSubmitting` 反馈提交状态。

---

## 第 8 章：把 Zod 正确接入 RHF

### 8.1 用 `zodResolver`

安装 `@hookform/resolvers` 后，核心接法是：

```tsx
const form = useForm<FormInput, unknown, FormOutput>({
  resolver: zodResolver(registrationSchema),
  defaultValues: initialValues,
  mode: "onBlur",
  reValidateMode: "onChange",
})
```

`zodResolver` 把 Zod schema 适配为 RHF 的 resolver；验证成功后，提交回调拿到解析后的结果；失败时，问题会映射到 RHF 的 `formState.errors`。shadcn 的官方 RHF 教程也是通过 `useForm` 的 `resolver` 配置来连接 Zod。[shadcn RHF 教程](https://ui.shadcn.com/docs/forms/react-hook-form)

### 8.2 三个类型参数代表什么？

```tsx
type FormInput = z.input<typeof registrationSchema>
type FormOutput = z.output<typeof registrationSchema>

const form = useForm<FormInput, unknown, FormOutput>({
  resolver: zodResolver(registrationSchema),
  // ...
})
```

- 第一个泛型：RHF 正在管理的表单输入值类型。
- 第二个泛型：resolver 的 context 类型；普通入门表单通常写 `unknown` 即可。
- 第三个泛型：`handleSubmit` 成功回调接收的解析后输出类型。

只写 `useForm<z.infer<typeof schema>>()` 在简单 schema 中经常没问题；如果 schema 有 `transform`、`default` 等导致输入与输出不同的特性，就可能出现类型冲突或丢失转换后的类型。Resolver 官方 README 明确支持显式指定 `z.input` / `z.output` 的方式。[Resolvers 的 Zod 示例](https://github.com/react-hook-form/resolvers)

### 8.3 字段级显示的最小模式

```tsx
const error = form.formState.errors.displayName

<Field data-invalid={Boolean(error)}>
  <FieldLabel htmlFor="displayName">显示名称</FieldLabel>
  <Input
    id="displayName"
    aria-invalid={Boolean(error)}
    {...form.register("displayName")}
  />
  {error && <FieldError id="displayName-error">{error.message}</FieldError>}
</Field>
```

注意：真实应用还应通过 `aria-describedby` 将输入框与帮助/错误文案关联。shadcn 的 `Field` 文档提供了 `data-invalid` 和 `aria-invalid` 的组合用法。[Field 组件](https://ui.shadcn.com/docs/components/base/field)

**本章完成标准：** 能把 schema 接入 `useForm`，并理解为什么输入类型可以是字符串、提交结果却是数字。

---

## 第 9 章：完整项目——创建工作区账号

这一章把上述知识拼起来。为避免将“客户端输入”和“网络 API 的数据契约”混为一谈，我们会有两个 schema：表单 schema 接受年龄字符串并转换成数字；API schema 接受已经是数字的年龄，在服务器再次验证所有字段。

### 9.1 定义 schema：`src/lib/schemas/registration.ts`

```ts
import { z } from "zod"

const ageTextSchema = z
  .string()
  .trim()
  .min(1, { error: "请输入年龄" })
  .regex(/^\d+$/, { error: "年龄必须是整数" })
  .transform(Number)
  .pipe(
    z.number()
      .int()
      .min(18, { error: "必须年满 18 岁" })
      .max(120, { error: "年龄超出合理范围" }),
  )

const contactSchema = z.object({
  name: z.string().trim().min(1, { error: "请输入联系人姓名" }),
  email: z.string().trim().toLowerCase().pipe(
    z.email({ error: "请输入有效邮箱" }),
  ),
})

const commonShape = {
  username: z.string()
    .trim()
    .min(3, { error: "用户名至少 3 个字符" })
    .max(20, { error: "用户名最多 20 个字符" })
    .regex(/^[a-zA-Z0-9_]+$/, { error: "只能使用字母、数字和下划线" }),
  email: z.string().trim().toLowerCase().pipe(
    z.email({ error: "请输入有效邮箱" }),
  ),
  accountType: z.enum(["personal", "business"]),
  companyName: z.string().trim().optional(),
  profile: z.object({
    website: z.string().trim().refine(
      (value) => value === "" || /^https?:\/\/\S+$/i.test(value),
      { error: "网址必须以 http:// 或 https:// 开头" },
    ),
  }),
  password: z.string().min(10, { error: "密码至少需要 10 个字符" }),
  confirmPassword: z.string().min(1, { error: "请再次输入密码" }),
  newsletter: z.boolean(),
  contacts: z.array(contactSchema)
    .min(1, { error: "至少添加一个联系人" })
    .max(5, { error: "最多添加 5 个联系人" }),
}

function addCrossFieldRules<T extends {
  accountType: "personal" | "business"
  companyName?: string
  password: string
  confirmPassword: string
}>(data: T, ctx: z.RefinementCtx) {
  if (data.accountType === "business" && !data.companyName?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["companyName"],
      message: "企业账号必须填写公司名称",
    })
  }

  if (data.password !== data.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "两次输入的密码不一致",
    })
  }
}

// UI schema：age 的输入值为 string，解析后输出 number。
export const registrationSchema = z.object({
  ...commonShape,
  age: ageTextSchema,
}).superRefine(addCrossFieldRules)

// API schema：请求体里的 age 已经是 number，服务端再次检查所有规则。
export const registrationApiSchema = z.object({
  ...commonShape,
  age: z.number().int()
    .min(18, { error: "必须年满 18 岁" })
    .max(120, { error: "年龄超出合理范围" }),
}).superRefine(addCrossFieldRules)

export type RegistrationInput = z.input<typeof registrationSchema>
export type RegistrationOutput = z.output<typeof registrationSchema>
```

为什么需要两个 schema？`handleSubmit` 会把通过 resolver 的数据以 output 形式交给回调；`age` 因此已经是 number。API 就应该针对收到的 payload 合约进行验证，而不是假设网络上仍然是输入框里的字符串。对更大的项目，可以把公共字段与业务规则拆成更细的 schema 模块，但要确保共享规则更新时不会遗漏 API 边界。

### 9.2 表单组件：`src/components/forms/registration-form.tsx`

```tsx
"use client"

import * as React from "react"
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form"
import type { FieldPath } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  registrationSchema,
  type RegistrationInput,
  type RegistrationOutput,
} from "@/lib/schemas/registration"

export function RegistrationForm() {
  const [success, setSuccess] = React.useState(false)
  const [availability, setAvailability] = React.useState<
    "idle" | "checking" | "available" | "taken" | "unknown"
  >("idle")

  const form = useForm<RegistrationInput, unknown, RegistrationOutput>({
    resolver: zodResolver(registrationSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: {
      username: "",
      email: "",
      age: "",
      accountType: "personal",
      companyName: "",
      profile: { website: "" },
      password: "",
      confirmPassword: "",
      newsletter: false,
      contacts: [{ name: "", email: "" }],
    },
  })

  const accountType = useWatch({
    control: form.control,
    name: "accountType",
  })
  const username = useWatch({
    control: form.control,
    name: "username",
  })
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "contacts",
  })

  // 异步可用性预检查：仅改善 UX；最终唯一性仍由服务端 + 数据库约束保证。
  React.useEffect(() => {
    if (!username || username.trim().length < 3) {
      setAvailability("idle")
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setAvailability("checking")
      try {
        const response = await fetch(
          `/api/username-availability?username=${encodeURIComponent(username)}`,
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error("检查失败")
        const result: { available: boolean } = await response.json()
        setAvailability(result.available ? "available" : "taken")
      } catch {
        if (!controller.signal.aborted) setAvailability("unknown")
      }
    }, 400)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [username])

  async function onSubmit(data: RegistrationOutput) {
    setSuccess(false)
    form.clearErrors()

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const result = await response.json()

      if (!response.ok) {
        if (result.fieldErrors && typeof result.fieldErrors === "object") {
          for (const [path, message] of Object.entries(result.fieldErrors)) {
            form.setError(path as FieldPath<RegistrationInput>, {
              type: "server",
              message: String(message),
            })
          }
        } else {
          form.setError("root.server", {
            type: "server",
            message: result.message ?? "提交失败，请稍后再试。",
          })
        }
        return
      }

      setSuccess(true)
      form.reset()
    } catch {
      form.setError("root.server", {
        type: "server",
        message: "网络异常，请检查连接后重试。",
      })
    }
  }

  const errors = form.formState.errors

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <FieldGroup>
        <Field data-invalid={Boolean(errors.username)}>
          <FieldLabel htmlFor="username">用户名</FieldLabel>
          <Input
            id="username"
            autoComplete="username"
            aria-invalid={Boolean(errors.username)}
            aria-describedby={errors.username ? "username-error username-status" : "username-help username-status"}
            {...form.register("username")}
          />
          <FieldDescription id="username-help">
            3 到 20 个字符，只能使用英文字母、数字和下划线。
          </FieldDescription>
          {errors.username && (
            <FieldError id="username-error" role="alert">
              {errors.username.message}
            </FieldError>
          )}
          <p id="username-status" aria-live="polite" className="text-sm text-muted-foreground">
            {availability === "checking" && "正在检查用户名…"}
            {availability === "available" && "当前用户名看起来可用。"}
            {availability === "taken" && "当前用户名可能已被占用，提交时服务器会再次检查。"}
            {availability === "unknown" && "暂时无法检查用户名；你仍可提交并查看服务器结果。"}
          </p>
        </Field>

        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="email">邮箱</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
          {errors.email && <FieldError id="email-error" role="alert">{errors.email.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.age)}>
          <FieldLabel htmlFor="age">年龄</FieldLabel>
          <Input
            id="age"
            inputMode="numeric"
            aria-invalid={Boolean(errors.age)}
            aria-describedby={errors.age ? "age-error" : undefined}
            {...form.register("age")}
          />
          {errors.age && <FieldError id="age-error" role="alert">{errors.age.message}</FieldError>}
        </Field>

        <Controller
          name="accountType"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="accountType">账号类型</FieldLabel>
              <Select
                name={field.name}
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value)
                  if (value === "personal") {
                    form.setValue("companyName", "", {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                }}
              >
                <SelectTrigger
                  id="accountType"
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.error ? "accountType-error" : undefined}
                >
                  <SelectValue placeholder="选择账号类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">个人</SelectItem>
                  <SelectItem value="business">企业</SelectItem>
                </SelectContent>
              </Select>
              {fieldState.error && (
                <FieldError id="accountType-error" role="alert">{fieldState.error.message}</FieldError>
              )}
            </Field>
          )}
        />

        {accountType === "business" && (
          <Field data-invalid={Boolean(errors.companyName)}>
            <FieldLabel htmlFor="companyName">公司名称</FieldLabel>
            <Input
              id="companyName"
              aria-invalid={Boolean(errors.companyName)}
              aria-describedby={errors.companyName ? "companyName-error" : undefined}
              {...form.register("companyName")}
            />
            {errors.companyName && (
              <FieldError id="companyName-error" role="alert">{errors.companyName.message}</FieldError>
            )}
          </Field>
        )}

        <Field data-invalid={Boolean(errors.profile?.website)}>
          <FieldLabel htmlFor="profile.website">个人网站（可选）</FieldLabel>
          <Input
            id="profile.website"
            type="url"
            placeholder="https://example.com"
            aria-invalid={Boolean(errors.profile?.website)}
            aria-describedby={errors.profile?.website ? "website-error" : undefined}
            {...form.register("profile.website")}
          />
          {errors.profile?.website && (
            <FieldError id="website-error" role="alert">{errors.profile.website.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="password">密码</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          {errors.password && <FieldError id="password-error" role="alert">{errors.password.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.confirmPassword)}>
          <FieldLabel htmlFor="confirmPassword">确认密码</FieldLabel>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
            {...form.register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <FieldError id="confirmPassword-error" role="alert">{errors.confirmPassword.message}</FieldError>
          )}
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">联系人（1–5 人）</legend>
          {fields.map((item, index) => {
            const nameError = errors.contacts?.[index]?.name
            const emailError = errors.contacts?.[index]?.email
            return (
              <div key={item.id} className="grid gap-3 rounded-md border p-3">
                <Field data-invalid={Boolean(nameError)}>
                  <FieldLabel htmlFor={`contact-${index}-name`}>联系人姓名</FieldLabel>
                  <Input
                    id={`contact-${index}-name`}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? `contact-${index}-name-error` : undefined}
                    {...form.register(`contacts.${index}.name` as const)}
                  />
                  {nameError && <FieldError id={`contact-${index}-name-error`} role="alert">{nameError.message}</FieldError>}
                </Field>
                <Field data-invalid={Boolean(emailError)}>
                  <FieldLabel htmlFor={`contact-${index}-email`}>联系人邮箱</FieldLabel>
                  <Input
                    id={`contact-${index}-email`}
                    type="email"
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? `contact-${index}-email-error` : undefined}
                    {...form.register(`contacts.${index}.email` as const)}
                  />
                  {emailError && <FieldError id={`contact-${index}-email-error`} role="alert">{emailError.message}</FieldError>}
                </Field>
                {fields.length > 1 && (
                  <Button type="button" variant="outline" onClick={() => remove(index)}>
                    删除联系人 {index + 1}
                  </Button>
                )}
              </div>
            )
          })}
          <Button
            type="button"
            variant="outline"
            disabled={fields.length >= 5}
            onClick={() => append({ name: "", email: "" })}
          >
            添加联系人
          </Button>
          {errors.contacts?.root?.message && (
            <FieldError role="alert">{errors.contacts.root.message}</FieldError>
          )}
        </fieldset>

        <Controller
          name="newsletter"
          control={form.control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="newsletter"
                name={field.name}
                ref={field.ref}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
              />
              <FieldLabel htmlFor="newsletter">接收产品更新邮件</FieldLabel>
            </Field>
          )}
        />
      </FieldGroup>

      {errors.root?.server && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
      {success && <p role="status">注册成功。</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "提交中…" : "创建账号"}
        </Button>
        <Button type="button" variant="outline" onClick={() => form.reset()}>
          重置
        </Button>
      </div>
    </form>
  )
}
```

这份代码展示了核心拼接方式，但不同 shadcn style/版本的 `FieldError`、`Checkbox` ref、`Field` 布局 props 可能略有变化。若 TypeScript 对某个 UI prop 报错，打开你项目实际生成的 `components/ui/*` 类型定义按版本适配；不要为了让示例照抄成功而移除 ARIA 和 focus 行为。若 Checkbox 不把 ref 暴露到真正的 button，请把 `field.ref` 接到它实际可聚焦的 trigger。

**说明：** 本教程为避免依赖具体 toast 库，使用了内联成功提示；生产中可以换成项目的 toast。`/api/username-availability` 是异步预检查端点，示例代码假定它返回 `{ available: boolean }`；它不是最终安全判断。

### 9.3 服务端再次验证：`src/app/api/register/route.ts`

```ts
import { NextResponse } from "next/server"
import { registrationApiSchema } from "@/lib/schemas/registration"

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { message: "请求体不是有效 JSON。" },
      { status: 400 },
    )
  }

  const parsed = registrationApiSchema.safeParse(body)

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}

    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join(".")
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
    }

    return NextResponse.json({ fieldErrors }, { status: 422 })
  }

  const data = parsed.data

  // 生产代码应在这里做：身份/权限检查、用户名或邮箱唯一性检查、
  // 数据库唯一约束与写入事务、速率限制及必要的审计日志。
  // 例如：如果用户名已存在，返回：
  // return NextResponse.json(
  //   { fieldErrors: { username: "用户名已被占用。" } },
  //   { status: 409 },
  // )

  // TODO: await db.user.create({ data: ... })
  // 此处只示范闭环，不会真正写入数据库。
  return NextResponse.json({ ok: true }, { status: 201 })
}
```

### 9.3.1 给异步预检查一个演示端点

本地练习时可以建立 `src/app/api/username-availability/route.ts`。下面的保留用户名列表只是让练习能立刻运行；生产环境应查询数据库，并以唯一约束保证一致性。

```ts
import { NextResponse } from "next/server"

const reservedForDemo = new Set(["admin", "support", "root"])

export async function GET(request: Request) {
  const url = new URL(request.url)
  const username = (url.searchParams.get("username") ?? "").trim().toLowerCase()

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ available: false }, { status: 400 })
  }

  // DEMO ONLY: 用数据库查询替换这行。真正提交时还必须再次检查。
  const available = !reservedForDemo.has(username)
  return NextResponse.json({ available })
}
```

创建页面 `src/app/register/page.tsx`：

```tsx
import { RegistrationForm } from "@/components/forms/registration-form"

export default function RegisterPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">创建工作区账号</h1>
        <p className="text-sm text-muted-foreground">
          填写资料，服务端会在保存前再次验证。
        </p>
      </header>
      <RegistrationForm />
    </main>
  )
}
```

### 9.4 这条错误闭环是如何工作的？

1. 用户输入时，RHF 保存原始表单值（例如 `age: "25"`）。
2. Zod resolver 在校验阶段解析它；`handleSubmit` 收到 `age: 25` 等 output 值。
3. 客户端把 output 发送到 API。
4. API 不能信任客户端，即使用 `registrationApiSchema.safeParse(body)` 重新解析未知请求体。
5. 如果格式不对，服务器把错误路径整理为 `fieldErrors`，例如 `{ "email": "请输入有效邮箱" }`，并返回 422。
6. 客户端遍历 `fieldErrors`，用 `form.setError(path, { type: "server", message })` 存回 RHF。
7. 字段组件读取 `formState.errors`，设置 `aria-invalid`，把错误文本关联到输入框。
8. 成功后调用 `form.reset()`，恢复初始值；如果是编辑资料而不是创建表单，通常用 `form.reset(savedRecord)` 更新为服务器返回的新值。

注意字段错误路径要和 RHF 字段名一致：`profile.website`、`contacts.0.email`。对数组字段，还应验证路径是否属于允许的字段集合，避免把不可信服务器字符串直接当作任意字段路径。更严格的生产实现可以在 API 端返回允许的 key，或在客户端建立路径映射表。

### 9.5 生产级安全边界清单

- 所有客户端检查只为体验服务；服务端仍要做相同或更严格的验证。
- 验证认证身份和授权权限；“用户可以填这个 ID”不等于“用户有权修改这条记录”。
- 对用户名、邮箱等唯一值，在数据库里建立唯一约束；单纯先查再写会有并发竞态。
- 对重复提交、支付、创建资源等操作设计幂等键或业务级重复检测。
- 进行输入校验、速率限制和必要的审计；不要把密码、token 或敏感数据写入日志。
- 只返回给用户需要的字段，不要把完整数据库异常直接发回客户端。

**本章完成标准：** 表单可提交；错误在字段旁显示；服务端 422 的字段错误能回填；提交过程有 pending 状态且按钮禁用；成功后 reset；你能说明为什么客户端验证不能替代服务端验证。

---

## 第 10 章：字段数组、嵌套对象和条件字段的通用模式

### 10.1 嵌套对象

Schema：

```ts
const schema = z.object({
  profile: z.object({
    website: z.string(),
    address: z.object({
      city: z.string(),
      postalCode: z.string(),
    }),
  }),
})
```

RHF 字段名用点路径：`register("profile.website")`、`register("profile.address.city")`。`setValue("profile.address.city", "上海")` 更新单个嵌套值。错误读取也沿路径展开：`errors.profile?.address?.city?.message`。

### 10.2 动态字段数组：`useFieldArray`

`useFieldArray` 负责动态增删行。渲染时使用 `fields.map`，必须使用 RHF 生成的 `item.id` 作为 React key，而不是数组索引；删除某行后索引会变化，索引 key 可能导致控件状态错位。

```tsx
const { fields, append, remove, move } = useFieldArray({
  control: form.control,
  name: "contacts",
})

{fields.map((item, index) => (
  <div key={item.id}>
    <Input {...form.register(`contacts.${index}.name` as const)} />
    <Button type="button" onClick={() => remove(index)}>删除</Button>
  </div>
))}

<Button type="button" onClick={() => append({ name: "", email: "" })}>
  添加
</Button>
```

为数组设置最少/最多数量的校验时，记得给用户明确的错误信息，并在达到 max 时禁用“添加”按钮。数组内部字段错误通常来自 `errors.contacts?.[index]?.email`；数组自身的根错误形态可能随 resolver/RHF 类型版本变化，检查真实类型定义。

### 10.3 条件字段

可以通过 `useWatch` 观察驱动字段，决定是否渲染额外字段。例如账号类型为 `business` 才显示公司名称。与此同时 schema 也必须表达同一条条件规则；**仅仅隐藏 UI 不等于验证规则已改变**。

隐藏字段的数据是否保留，要明确选择：

- 保留：适合用户切换选项后不想丢内容，但要确保 schema/输出策略不会意外提交无关数据。
- 注销或清空：适合切换到另一模式后字段不再属于业务数据。可使用 `shouldUnregister`，或者在切换时显式 `setValue` 清空，并在服务端 schema 中按规则校验。

别只在客户端决定“个人账号不需要公司名称”，服务器端也必须实现同样的规则。

### 10.4 跨字段验证

密码确认是经典场景。日期范围、最低金额与最高金额、发货地址和账单地址、开始日期和结束日期等也同理。Zod `superRefine` 中每条 `ctx.addIssue` 都应设置正确的 `path`，这样 RHF 才能把错误放在正确字段旁边。

### 10.5 异步校验：哪些放在 Zod，哪些放在 API？

Zod 支持异步 refine / transform；直接调用时需要 `safeParseAsync` / `parseAsync`。`zodResolver` 默认走异步模式。[Resolvers API](https://github.com/react-hook-form/resolvers)

但“检查用户名是否已经存在”会访问网络，且常在用户每输入一个字符时被触发。把有副作用、成本高或需要授权的请求直接塞进一个会反复运行的通用 schema，通常不是好的默认设计。建议区分两类：

- **本地、确定、低成本规则**（格式、长度、跨字段）：放在 Zod schema 中，成为客户端和服务端共享的规则。
- **远端预检查**（用户名占用、优惠券是否可用）：用带 debounce 和取消请求的 UI 状态做预提示，显示“检查中 / 可用 / 不可用 / 暂时未知”。提交时仍由服务端重新检查，且以数据库约束为最终权威。

如果确实将异步规则放进 Zod：

```ts
const asyncUsernameSchema = z.string().min(3).refine(
  async (value) => await checkUsernameAvailability(value),
  { error: "用户名已被占用" },
)

const result = await asyncUsernameSchema.safeParseAsync("new_user")
```

要处理请求超时、网络失败、竞态和重复请求；更不能把客户端能访问的检查接口当成安全机制。

**本章完成标准：** 动态数组可增删且 key 稳定；嵌套字段可以注册、设置值和显示错误；条件字段隐藏和数据保留策略明确；跨字段错误指向正确字段；异步预检查与最终服务端决定分开。

---

## 第 11 章：常见故障排查

### “Select 看起来选中了，但 RHF 没有拿到值”

检查是否用 `Controller`；把 `value={field.value}`、`onValueChange={field.onChange}`、`name={field.name}` 接到 Select；`field.ref`、`field.onBlur` 应放到真实可聚焦的 Trigger。不要假设自定义 Select 会触发原生 `<select>` 的 `onChange(event)`。

### “提交后拿到的数字还是字符串”

确认用了 `zodResolver(schema)`，提交函数是通过 `handleSubmit` 进入；检查 schema 是否真的 `.transform(Number)`，并确认 `useForm<Input, Context, Output>` 的第三个泛型是 `z.output`。不要在页面另写一遍不一致的 `Number(value)`。

### “调用 reset 后默认值不对”

`defaultValues` 会被缓存。编辑表单在数据异步加载完成后，使用 `reset(loadedRecord)`，而不是期待组件重新渲染后 `defaultValues` 自动更新。

### “切换条件字段后仍然提交旧值”

明确保留还是清除策略。用 `shouldUnregister` 或切换时 `setValue` 清空，并为 server schema 写测试。只有把字段从 UI 移除，不一定会从 RHF 数据中移除。

### “服务端错误显示不出来”

检查：API 的 `fieldErrors` key 是否与 RHF 字段名一致；客户端是否 `setError`；组件是否订阅 `formState.errors`；条件字段是否在错误到达时仍然渲染；嵌套/数组路径是否被允许映射。

### “错误只有红色边框，读屏软件没读出来”

为输入添加 `aria-invalid`；给错误节点稳定 `id`；把该 id 放到 `aria-describedby`；对于异步状态或提交总错误，可使用适当的 `aria-live` / `role="alert"`，避免同一条消息重复播报过多次。

### “用户可以绕过前端校验”

可以，而且任何客户端校验都可被绕过。通过直接请求 API、改请求体或其他客户端发请求都能越过浏览器逻辑。所以服务端必须验证未知 JSON、权限、业务状态和数据库约束；客户端 schema 只负责更快地给用户反馈。

---

## 第 12 章：验收练习与最终清单

按以下顺序完成练习。每一步都应在浏览器中操作并观察结果。

1. **源码与设计系统**：修改 Button 一个 variant；用语义 token 调整边框或主色；确认多个页面仍一致。解释什么时候改 `ui/`、什么时候建业务 wrapper。
2. **Base UI 行为**：打开 Dialog，用 Tab / Shift+Tab 移动焦点，按 Escape 关闭，确认焦点返回触发器。用键盘完成 Menu 操作；Select 至少用方向键和键盘字符导航。
3. **无障碍**：每个输入都有 label；错误时 `aria-invalid` 为 true；错误 ID 在 `aria-describedby` 中；颜色以外也有文字反馈。
4. **RHF 生命周期**：尝试更改一个值观察 `isDirty`；聚焦后离开观察 `touchedFields`；提交时按钮进入 pending；成功后 reset；模拟网络失败观察 `root.server`。
5. **Zod 类型**：输入 `"25"` 后输出是数字 `25`；输入空字符串不能悄悄变成 0；输入两个不一致的密码时错误落到确认密码字段。
6. **复杂字段**：添加/删除联系人；编辑 `profile.website`；切换个人/企业账号；企业账号没填公司名时出现字段级错误。
7. **客户端/服务端闭环**：让 API 返回 422 及 `fieldErrors`，确认错误重新出现在具体输入框；尝试手工构造非法请求，确认服务端依旧拒绝。
8. **安全与并发**：实现唯一值数据库约束；把重复提交按钮禁用和服务端去重作为两层防线；不要把客户端预检查当作最终结果。

当以上都通过，你就不只是“会用表单组件”了，而是已经能构建可维护的设计系统交互、带类型转换的复杂表单以及真正闭合的错误处理链路。

---

## 官方文档索引

建议在完成每章后对照阅读这些一手资料。页面会持续更新，实际项目以当前安装版本和生成源码为准。

- [shadcn/ui Introduction](https://ui.shadcn.com/docs)
- [shadcn/ui Base UI 默认变更说明（2026 年 7 月）](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
- [shadcn/ui components.json](https://ui.shadcn.com/docs/components-json)
- [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- [shadcn/ui Field](https://ui.shadcn.com/docs/components/base/field)
- [shadcn/ui Select（Base UI）](https://ui.shadcn.com/docs/components/base/select)
- [shadcn/ui Dialog（Base UI）](https://ui.shadcn.com/docs/components/base/dialog)
- [shadcn/ui React Hook Form 教程](https://ui.shadcn.com/docs/forms/react-hook-form)
- [Base UI Accessibility](https://base-ui.com/react/overview/accessibility)
- [Base UI Dialog](https://base-ui.com/react/components/dialog)
- [Base UI Popover](https://base-ui.com/react/components/popover)
- [Base UI Select](https://base-ui.com/react/components/select)
- [Base UI Menu](https://base-ui.com/react/components/menu)
- [React Hook Form](https://react-hook-form.com/)
- [React Hook Form API: useForm](https://react-hook-form.com/docs/useform)
- [React Hook Form API: useFieldArray](https://react-hook-form.com/docs/usefieldarray)
- [Zod Basics](https://zod.dev/basics)
- [Zod API](https://zod.dev/api)
- [React Hook Form Resolvers（Zod）](https://github.com/react-hook-form/resolvers)

> 版本提示：组件包装 API、Zod 的错误配置参数与 schema API、RHF 的泛型推导都会随版本变化。尤其是 shadcn/ui 现在同时维护 Base UI、React Aria 和 Radix 对应变体；复制片段时请确认页面上选择的 primitive 版本与项目生成的组件一致。
