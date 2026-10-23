# Vitest 从 0 到 1：为前端、API 与数据库服务建立可靠测试层

> 一份面向有基础 JavaScript/TypeScript 知识、但尚未系统写过测试的实战教程。重点不是记住 API，而是学会判断“该测什么、隔离什么、如何验证、怎样避免测试误报”。
>
> 文档核对日期：2026-10-22。示例采用 TypeScript、Vite、React、React Testing Library、Fastify 与 PostgreSQL 风格的依赖注入。项目若使用不同数据库、状态库或版本，请按对应适配层调整。

## 学完后，你应该能做到什么

完成本教程后，你应能够：

1. 为纯函数设计覆盖正常值、边界值和错误输入的单元测试。
2. 理解 unit、component、integration 三层测试的证明目标和维护成本，知道何时不要写昂贵的端到端测试。
3. 从现有 Vite 项目安装和配置 Vitest，理解 `environment`、`setupFiles`、生命周期钩子和测试文件发现规则。
4. 使用 `vi.fn()`、`vi.spyOn()`、`vi.mock()`、全局替换和 fake timers，并在测试结束后恢复环境。
5. 用 React Testing Library 从用户可见的行为出发测试 React 表单、异步状态和错误提示。
6. 让每个测试拥有自己的 QueryClient、状态 store、依赖 mock 和数据库数据集。
7. 使用 Fastify `app.inject()` 测试 HTTP 状态码、响应体、校验、异常处理和插件，无须占用外部端口。
8. 区分 mock 边界与真实集成：单元测试隔离外部系统，集成测试验证关键组件之间确实能协作。
9. 阅读 coverage 报告，知道 statements、branches、functions、lines 各表示什么，以及高覆盖率为什么不等于高质量。
10. 诊断偶发失败、测试顺序依赖、并发竞争、未清理计时器/连接/数据等问题。

---

# 第 1 章：先建立正确的测试思维

## 1.1 测试不是给代码盖章，而是验证一个可观察的承诺

假设业务有一个函数：给订单金额打折。我们真正关心的是：金额为 100、折扣为 20% 时得到 80；金额不能为负；折扣不能超过 100%；无效输入应以约定的方式失败。这些是用户或调用者可以观察到的承诺。

测试最有价值的结构是：**给定条件（Arrange），执行一个行为（Act），验证结果（Assert）**。每个测试应尽可能只回答一个清晰问题。例如：

```ts
import { describe, expect, it } from 'vitest'
import { applyDiscount } from './discount'

describe('applyDiscount', () => {
  it('按百分比折扣计算最终金额', () => {
    // Arrange：准备输入
    const amount = 100
    const percent = 20

    // Act：执行被测行为
    const result = applyDiscount(amount, percent)

    // Assert：验证对外可观察的结果
    expect(result).toBe(80)
  })
})
```

如果业务实现将来从 `if` 改为查表，或者函数内部变量改名，这个测试不应该因此失败。测试应保护业务承诺，而不应将每一行实现细节都锁死。

## 1.2 三种常用测试层级

| 层级 | 主要证明什么 | 常见范围 | 速度与成本 | 适用例子 |
|---|---|---|---|---|
| Unit（单元） | 单个函数/对象的规则在输入输出层面正确 | 通常用内存数据，不连接真实外部系统 | 很快、失败位置清晰、成本低 | 折扣计算、邮箱规范化、权限判定、错误映射 |
| Component（组件） | 一个 UI 组件的可见输出和交互契约正确 | 真实渲染组件，外部网络/路由/复杂上下文通常用测试替身 | 中等速度，反馈接近用户行为 | 必填校验、按钮禁用、加载/成功/失败提示 |
| Integration（集成） | 多个真实模块协作时契约仍成立 | 真实路由、插件、Repository、测试数据库或真实适配器 | 较慢，环境与数据维护成本高 | Fastify 路由连服务和数据库、ORM 查询与约束 |

还存在浏览器端到端（E2E）测试，它从真实浏览器出发覆盖多个页面与服务。它对用户关键流程很有价值，但通常更慢、更脆弱，排错范围也更大。本教程主要建立题目要求的三层测试，不把 E2E 当作每项规则的默认选择。

一个实用原则是：**用最便宜的测试证明规则，用少量真实集成测试证明接线没接错。** 若折扣规则能用纯函数测试，就不要为了验证 `20%` 的计算而启动整个 API 和数据库。反过来，纯函数全绿也无法证明 ORM 的 SQL、数据库唯一约束和 Fastify 插件真的正常工作，所以仍需要少量集成测试。

## 1.3 测试的边界如何划分

先看应用的典型调用链：

```text
React 页面
   │ 用户提交表单
   ▼
HTTP 请求 ──► Fastify 路由/插件
                   │ 参数校验、状态码、错误转换
                   ▼
               业务服务
               │ 业务规则
               ▼
              Repository
               │ SQL/ORM
               ▼
             数据库
```

建议把依赖边界设计成可注入的接口：

- 纯业务规则尽量不直接读取 `process.env`、系统时钟或数据库。
- 服务通过参数接受 Repository、邮件服务、时钟或密码哈希器等依赖。
- Fastify app 用工厂函数构建，服务器监听端口的代码单独放在启动入口。
- React 组件通过 props、context 或经过测试封装的 Provider 获取依赖。

**低耦合并不是所有东西都 mock。** 低耦合是让模块之间的契约清晰、可以替换；mock 只是测试时替换某个边界的一种办法。

---

# 第 2 章：建立可以运行的 Vitest 项目

## 2.1 检查运行环境

打开终端执行：

```bash
node --version
npm --version
```

当前 Vitest 官方入门页标出的要求为 Node.js `>=22.12.0`、Vite `>=6.4.0`。如果你进入一个已有项目，先检查项目锁定的 Vitest、Vite 和 Node 版本，不要为了教程直接升级生产项目中所有依赖。Node 版本要求可能随 Vitest 主版本变化，应以官方 Getting Started 页面为准。

如果你没有项目，可以创建一个 React + TypeScript 的 Vite 项目：

```bash
npm create vite@latest vitest-lab -- --template react-ts
cd vitest-lab
npm install
```

如果你已有项目，跳过脚手架步骤，在项目根目录继续。

## 2.2 安装测试依赖

```bash
npm install -D vitest jsdom \
  @testing-library/react \
  @testing-library/user-event \
  @testing-library/jest-dom \
  @vitest/coverage-v8
```

说明：

- `vitest`：测试运行器、断言与 mock 工具。
- `jsdom`：在 Node 进程里模拟常用浏览器 DOM API，以运行 React DOM 测试。
- `@testing-library/react`：将 React 组件渲染到测试 DOM 并提供查询方法。
- `@testing-library/user-event`：模拟更接近真实用户的输入、点击和键盘交互。
- `@testing-library/jest-dom`：提供 `toBeInTheDocument()`、`toBeDisabled()` 等 DOM 断言扩展；包名虽带 Jest，它也支持 Vitest 的接入入口。
- `@vitest/coverage-v8`：通过 V8 收集覆盖率。

如果仓库已经有 Vite 的 React 插件，通常不必重复安装。若准备在同一个项目里测试 Fastify 服务，安装其运行依赖：

```bash
npm install fastify
```

如果数据库示例采用 PostgreSQL 驱动 `pg`，需另外安装 `pg` 与相应 TypeScript 类型。数据库测试连接必须指向专用测试库，不得指向生产数据库。

## 2.3 编写测试脚本

在 `package.json` 的 `scripts` 中加入：

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

如果原来的 `scripts` 里还有 `dev`、`build` 等命令，保留它们，只增加以上测试命令。`vitest` 默认进入 watch 模式：开发中通常会在相关文件变化后重新运行测试；`vitest run` 则执行一次后退出，更适合 CI。

## 2.4 建立目录结构

小项目可以把测试文件放在源文件旁边，大项目可以按领域集中放置。重点是团队统一，而不是迷信唯一目录。

```text
src/
  domain/
    discount.ts
    discount.test.ts
  components/
    SignupForm.tsx
    SignupForm.test.tsx
  services/
    user-service.ts
    user-service.test.ts
  repositories/
    postgres-user-repository.ts
  server/
    app.ts
    app.test.ts
  test/
    setup.ts
vitest.config.ts
```

将测试命名为 `*.test.ts` 或 `*.test.tsx`，并把测试放在 `src` 内是常见做法。后续覆盖率设置会明确统计哪些 `src` 文件，避免报告只统计“碰巧被 import 过的文件”。

---

# 第 3 章：理解 Vitest 配置与测试环境

## 3.1 创建 `vitest.config.ts`

在仓库根目录创建如下文件。若已有 `vite.config.ts`，也可以把测试配置合并到既有 Vite 配置中；不要创建两个相互矛盾的配置源。

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // 默认 Node 环境适合纯函数、服务和 Fastify 测试。
    // React 测试文件可以用文件级注释切换到 jsdom。
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],

    // 清除 mock 的调用记录；恢复 spy 替换掉的原始方法。
    clearMocks: true,
    restoreMocks: true,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
})
```

关于这段配置：阈值 `80`、`75` 只是演示团队可以设门槛，并不是 Vitest 的强制标准。新项目应结合风险与代码现状逐步设定，别为了达到数字而排除重要文件或写无意义的断言。上面 `include` 与 `exclude` 的路径模式也应按实际仓库调整。

如果 `vite.config.ts` 已经调用了 `defineConfig`，确认你从 `vitest/config` 引入合适的定义类型，并检查 Vite 插件是否有重复配置。混合 Vite 与测试配置时，应尽量只维护一个清晰的配置入口。

## 3.2 `environment`：代码运行在哪里？

Vitest 默认使用 `node` 环境。它适合绝大多数纯函数、服务层、Fastify 路由和数据库 Repository 测试。浏览器 API 并非 Node 原生具备，因此测试里访问 `document` 或渲染 React DOM 时需要 DOM 环境。

最常见的环境选择：

- `node`：没有模拟浏览器 DOM，适合服务端逻辑。
- `jsdom`：模拟许多浏览器 DOM API，是 React Testing Library 测试的常见选择。
- `happy-dom`：另一个浏览器类环境，部分情况下更快，但并非完整浏览器实现。
- Browser Mode：若测试重点是实际浏览器行为、CSS 布局、真实焦点管理或浏览器 API，可考虑 Vitest 的浏览器模式。`jsdom` 不等于真实浏览器，不会准确呈现所有布局和平台行为。

在 React 测试文件最顶部加入：

```tsx
/** @vitest-environment jsdom */
```

这样只有这个文件切到 `jsdom`，其他 Node 测试仍用 `node`。如果整个项目几乎都是前端 DOM 测试，也可以把全局 `environment` 设为 `jsdom`，但含服务端文件的项目更适合按文件或项目划分环境。

## 3.3 `setupFiles` 与 `globalSetup` 的区别

这两个名字很像，但时机和作用域不同：

- `setupFiles`：在每个测试文件执行前运行，运行在测试 worker 的上下文。适合加载 matcher、polyfill、挂载通用的 `afterEach` cleanup。它不是“整个 Vitest 只运行一次”。
- `globalSetup`：在测试 worker 创建前运行一次全局初始化，且不与测试文件共享普通全局变量。适合启动一次昂贵的测试依赖或执行全局准备。测试代码若要获取全局 setup 的信息，需要使用 Vitest 提供的通信机制，而不是假设变量自动共享。
- `beforeAll`：通常在当前测试文件或 `describe` 作用域内，执行一次。
- `beforeEach`：每个测试执行前运行，用于重新创建测试状态。
- `afterEach`：每个测试结束后运行，即使断言失败也应尽量完成必要清理。

## 3.4 设置 DOM matcher 与清理

创建 `src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

这里显式调用 `cleanup()`，所以即使没有把 `test.globals` 设为 `true`，也能明确保证每个测试结束后卸载组件。默认保持 `globals: false`，测试里显式从 `vitest` 导入 `describe`、`it`、`expect`，更容易看出依赖来源，也有利于 TypeScript 类型检查。

不要在 setup 文件中无差别地 mock 所有网络请求、数据库或业务模块。全局 setup 影响每个测试文件；过度集中地 mock 会让某些测试在没有意识到的情况下失去真实性。全局 setup 应只放真正通用的基础设施。

## 3.5 第一次运行

创建 `src/domain/smoke.test.ts`：

```ts
import { expect, it } from 'vitest'

it('测试运行器能够执行断言', () => {
  expect(2 + 2).toBe(4)
})
```

运行：

```bash
npm test
# 或者执行一次就退出
npm run test:run
```

如果测试文件没有被发现，先检查文件名、`include` 模式和当前工作目录。如果 DOM 测试提示 `document is not defined`，检查对应文件是否运行在 `jsdom` 中；如果 `toBeInTheDocument` 不存在，检查 `setupFiles` 是否被加载以及 matcher 导入是否正确。

---

# 第 4 章：编写你的第一批高价值单元测试

## 4.1 AAA 不只是注释模板

AAA 分别是 Arrange（准备）、Act（执行）、Assert（断言）。它让测试读起来像一段小型规格说明。测试并不要求每一部分一定单独占一行，也不必机械地写注释；但读者应该能迅速看出输入、执行动作和预期结果。

一条好的测试描述了行为，而不是内部步骤。例如：

- 好：`无折扣时返回原金额`
- 较差：`调用 applyDiscount，然后检查第三个变量`

不要在一个测试里一次验证成功、三种错误、日志调用和多个不相关函数。测试越能清楚说明失败原因，维护者越容易修复问题。

## 4.2 给纯函数定义明确的契约

创建 `src/domain/discount.ts`：

```ts
export function applyDiscount(amount: number, percent: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('amount must be a finite non-negative number')
  }

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError('percent must be between 0 and 100')
  }

  // 金额按分计价的系统通常需要更明确的舍入策略。
  // 此例为了简明，假设返回值可以是普通数值。
  return amount * (1 - percent / 100)
}
```

这里有个重要的工程判断：金额系统常常不应使用浮点数直接表示货币，真实业务应考虑整数最小货币单位（如分）或 Decimal 类型，并定义舍入规则。本例用简单数值只为了讲测试方法。

接着创建 `src/domain/discount.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { applyDiscount } from './discount'

describe('applyDiscount', () => {
  it('折扣后金额正确', () => {
    expect(applyDiscount(100, 20)).toBe(80)
  })

  it('百分之零返回原金额', () => {
    expect(applyDiscount(99, 0)).toBe(99)
  })

  it('百分之百折扣返回零', () => {
    expect(applyDiscount(99, 100)).toBe(0)
  })

  it('不允许负金额', () => {
    expect(() => applyDiscount(-1, 10)).toThrow(RangeError)
  })

  it('不允许超过 100 的折扣', () => {
    expect(() => applyDiscount(100, 101)).toThrow(/between 0 and 100/)
  })
})
```

为什么 `toThrow` 的参数里要写函数包装器？因为 `applyDiscount(-1, 10)` 会在断言执行之前立刻抛出异常，而 `expect(() => applyDiscount(-1, 10)).toThrow(...)` 是把执行时机交给 matcher 捕获。

## 4.3 边界值：别只测试“看起来正常”的中间值

对一个接受区间的输入，先找边界，再找边界外的值。百分比范围是 `[0, 100]`，值得覆盖：

- `0`：合法下界。
- `100`：合法上界。
- 小于 `0`：越界失败。
- 大于 `100`：越界失败。
- `NaN`、`Infinity`：不是有效业务数字。
- 金额 `0`：零金额的行为。

边界测试来自业务规则，不是为了盲目穷举。例如一个邮箱字段需要测空字符串、前后空白、无效格式、大小写规范化；分页参数要测第一页、最后一页、零、负数、超大值。无需给每个输入值单独写一百个测试，重点是识别不同的行为分支。

## 4.4 参数化测试：减少重复，不减少可读性

当多组输入只在数据不同、验证逻辑相同时，可以参数化：

```ts
import { expect, test } from 'vitest'
import { applyDiscount } from './discount'

test.for([
  { amount: 100, percent: 0, expected: 100 },
  { amount: 100, percent: 10, expected: 90 },
  { amount: 100, percent: 100, expected: 0 },
  { amount: 25, percent: 20, expected: 20 },
])('applyDiscount($amount, $percent) -> $expected', ({ amount, percent, expected }) => {
  expect(applyDiscount(amount, percent)).toBe(expected)
})
```

参数化表的字段名应有意义。与其写 `[100, 20, 80]` 让后来者猜每一列是什么，不如使用对象字段。当前 Vitest 文档推荐新测试可以使用 `test.for`；`test.each` 也可用于兼容常见 Jest 风格。请遵循项目所安装的 Vitest 版本支持的 API。

不要把完全不同的失败场景塞到一张参数表里，仅仅因为“可以参数化”。若不同情况需要不同的异常或断言，单独命名测试更清晰。

## 4.5 异步函数与错误路径

假设服务从外部资料源读取用户：

```ts
export type User = { id: string; name: string }

export async function loadUser(
  id: string,
  fetcher: (id: string) => Promise<User | null>,
): Promise<User> {
  const user = await fetcher(id)
  if (!user) throw new Error('USER_NOT_FOUND')
  return user
}
```

测试异步成功与拒绝：

```ts
import { expect, it, vi } from 'vitest'
import { loadUser } from './load-user'

it('返回找到的用户', async () => {
  const fetcher = vi.fn().mockResolvedValue({ id: 'u1', name: 'Ada' })

  await expect(loadUser('u1', fetcher)).resolves.toEqual({ id: 'u1', name: 'Ada' })
  expect(fetcher).toHaveBeenCalledWith('u1')
})

it('用户不存在时以约定错误拒绝', async () => {
  const fetcher = vi.fn().mockResolvedValue(null)

  await expect(loadUser('missing', fetcher)).rejects.toThrow('USER_NOT_FOUND')
})

it('下游失败时将拒绝传递给调用者', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('database offline'))

  await expect(loadUser('u1', fetcher)).rejects.toThrow('database offline')
})
```

非常重要：`.resolves` 和 `.rejects` 前面的断言必须 `await` 或 `return`。否则测试函数可能先结束，断言 Promise 还没完成，造成测试假绿或产生未处理拒绝。测试异步回调时，如果断言是在回调里发生，还应考虑 `expect.hasAssertions()` 或显式等待那个回调。

## 4.6 `get`、`toBe`、`toEqual` 与错误断言

- `toBe`：通常用于基本类型精确值，或验证是不是同一个对象引用。
- `toEqual`：递归比较对象与数组的结构和数据。
- `toMatchObject`：只要求对象包含指定部分字段。
- `toContain`：验证数组包含项目或字符串包含子串。
- `toThrow`：验证同步函数抛出错误；异步函数使用 `.rejects.toThrow(...)`。
- `toHaveBeenCalledWith`、`toHaveBeenCalledTimes`：验证 mock 调用参数和次数。

断言应尽量验证有业务意义的东西。不要只检查“结果不为 `undefined`”，如果约定是返回用户 ID，就断言 ID；若约定是无权限返回 403，就断言状态码和稳定的错误结构。

---

# 第 5 章：理解 mock，做到隔离而不造假

## 5.1 为什么要 mock？什么时候不该 mock？

测试通常不希望每次都发真实邮件、扣真实款、访问生产 API 或写入共享数据库。mock 可把不可控的外部边界替换成可预测的替身，从而让测试更快、更稳定，也避免副作用。

但是，**如果把被测业务逻辑本身全部 mock 掉，测试就没有证明它的正确性**。例如，测试 `createOrder()` 时把 `createOrder` 自己替换成 `vi.fn().mockResolvedValue(order)`，再断言它返回订单，这只证明 mock 会返回预设值，不证明真正的下单逻辑正确。

优先考虑的边界：

- 短单元测试：mock 邮件供应商、支付供应商、第三方 HTTP API、系统时钟或随机数源。
- 集成测试：尽可能保留本项目内部的服务、路由、数据库访问代码，使用测试数据库或真实的适配器验证集成。
- 不要因为数据库稍微慢一点，就让所有测试都 mock 掉 SQL；也不要因为真实第三方 API 不稳定，就在每个单元测试里请求线上 API。

## 5.2 `vi.fn()`：创建可观察的函数替身

```ts
import { expect, it, vi } from 'vitest'

it('调用通知函数时传入用户和内容', () => {
  const sendNotification = vi.fn()

  sendNotification({ userId: 'u1', message: '订单已创建' })

  expect(sendNotification).toHaveBeenCalledTimes(1)
  expect(sendNotification).toHaveBeenCalledWith({
    userId: 'u1',
    message: '订单已创建',
  })
})
```

`vi.fn()` 本身不会实现真实业务；默认返回 `undefined`。你可以设定返回结果：

```ts
const findUser = vi.fn().mockReturnValue({ id: 'u1' })
const fetchProfile = vi.fn().mockResolvedValue({ id: 'u1' })
const writeRecord = vi.fn().mockRejectedValue(new Error('write failed'))
```

记住三类行为：

- `mockReturnValue(value)`：同步返回值。
- `mockResolvedValue(value)`：返回一个成功解析为 `value` 的 Promise。
- `mockRejectedValue(error)`：返回一个以 `error` 拒绝的 Promise。

不要用一个 `vi.fn()` 去模拟返回值却忘记函数本来是异步的。例如如果业务代码会 `await repository.save()`，测试最好让 mock 返回 Promise，这样类型与调用方式都更接近真实契约。

## 5.3 `vi.spyOn()`：观察真实方法，必要时替换实现

```ts
import { expect, it, vi } from 'vitest'

const calculator = {
  add(a: number, b: number) {
    return a + b
  },
}

it('监听调用，但保留原本行为', () => {
  const spy = vi.spyOn(calculator, 'add')

  expect(calculator.add(2, 3)).toBe(5)
  expect(spy).toHaveBeenCalledWith(2, 3)
})

it('必要时可以替换返回值', () => {
  const spy = vi.spyOn(calculator, 'add').mockReturnValue(99)

  expect(calculator.add(2, 3)).toBe(99)
  expect(spy).toHaveBeenCalledTimes(1)
})
```

区别是：`vi.fn()` 创建一只新函数；`vi.spyOn(object, 'method')` 包装对象上的既有方法，默认原方法仍会执行，除非你改写它。`spyOn` 很适合观察日志、埋点或调用边界，但对模块导出做 spy 在 ESM、Browser Mode 等情境会有约束。最稳妥的做法通常是对你拥有的普通对象方法做 spy，或通过依赖注入传递函数。

## 5.4 `vi.mock()`：替换模块依赖

当服务直接 import 一个供应商模块，且不便于通过参数注入时，可使用模块 mock。例如 `src/services/email-client.ts` 导出 `sendEmail`，生产代码调用它；测试可以替换整个模块：

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import { sendWelcomeEmail } from './welcome-service'
import { sendEmail } from './email-client'

vi.mock(import('./email-client'), () => ({
  sendEmail: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(sendEmail).mockResolvedValue({ accepted: true })
})

it('发送欢迎邮件并返回成功', async () => {
  await sendWelcomeEmail('ada@example.com')

  expect(sendEmail).toHaveBeenCalledWith({
    to: 'ada@example.com',
    template: 'welcome',
  })
})
```

这里的示例假设 `sendEmail` 返回 `Promise<{accepted: boolean}>`；若项目中的返回类型不同，应相应调整 mock 返回值。

学习模块 mock 时，要牢记两点：

1. `vi.mock()` 通常会被 Vitest 提升到模块导入之前执行。不要把它当成一个普通运行时语句，以为它会在前一行代码之后才生效。
2. 模块路径必须与生产代码实际导入的路径正确匹配。路径或导出名称不一致，可能得到未 mock 的原模块或模块缺失错误。

如果一个服务可以接收依赖参数，依赖注入往往比模块级 mock 更简单、更明确；`vi.mock()` 应当是工具箱里的选择，而不是所有测试的起点。

## 5.5 清理 mock：clear、reset、restore 不一样

这三个名字容易混淆：

- `mockClear()` / `vi.clearAllMocks()`：清空调用历史，不移除当前 mock 实现。
- `mockReset()` / `vi.resetAllMocks()`：清空调用记录并重置 mock 实现。
- `mockRestore()` / `vi.restoreAllMocks()`：对 `vi.spyOn()` 创建的 spy 恢复对象上的原始实现。对普通 `vi.fn()` 不存在可以还原的原始对象方法。

配置 `clearMocks: true` 可以在每个测试前清理调用历史；`restoreMocks: true` 可以恢复 spy。它们解决的是不同问题。若在测试间共享一个 `vi.fn()`，要特别注意它是否配置过自定义返回值；清除调用历史不代表自定义实现也会消失。

不要一边使用 `test.concurrent`，一边让多个测试共享同一个全局 mock，然后靠 `clearAllMocks()` 清记录。并发测试中的清理可能影响另一个尚未结束的测试。要么每项测试创建自己的 mock，要么保持顺序执行，并避免隐式共享。

## 5.6 mock 全局 API 与清理它们

有时需要替换 `fetch`、`localStorage` 或某个全局对象。Vitest 提供 `vi.stubGlobal()`：

```ts
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('可以用可控的 fetch 响应测试网络错误处理', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )

  vi.stubGlobal('fetch', fetchMock)

  const response = await fetch('/api/health')

  expect(response.status).toBe(200)
  expect(fetchMock).toHaveBeenCalledWith('/api/health')
})
```

这是一个只说明全局替换机制的示例。若使用 `fetch` 的函数还需要处理超时、非 2xx 状态或 JSON 解析失败，应单独针对这些真实行为写断言。也可以启用 `unstubGlobals: true` 自动恢复被 stub 的全局属性；要避免每个测试结束时恢复一个其他并发测试仍在使用的全局值。

## 5.7 Fake timers：不需要真的等 5 秒

假设搜索框输入后需要等 300ms 再触发查询。可以把时间相关行为写成独立函数：

```ts
export function scheduleSearch(
  query: string,
  callback: (query: string) => void,
) {
  return setTimeout(() => callback(query), 300)
}
```

测试里使用假计时器：

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { scheduleSearch } from './schedule-search'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('300ms 到期前不触发，达到 300ms 后触发', () => {
  vi.useFakeTimers()
  const callback = vi.fn()

  scheduleSearch('vitest', callback)

  vi.advanceTimersByTime(299)
  expect(callback).not.toHaveBeenCalled()

  vi.advanceTimersByTime(1)
  expect(callback).toHaveBeenCalledWith('vitest')
  expect(callback).toHaveBeenCalledTimes(1)
})
```

常见 API：

- `vi.advanceTimersByTime(ms)`：推进指定的虚拟时间。
- `vi.advanceTimersToNextTimer()`：推进到下一个计时器。
- `vi.runOnlyPendingTimers()`：执行当前待处理计时器，不无限执行新生成的周期任务。
- `vi.runAllTimers()`：执行所有计时器；对会反复安排自己的定时器要谨慎。
- `vi.useRealTimers()`：恢复真实计时器。
- `vi.setSystemTime(date)`：在 fake timers 场景下控制系统时间。

不要在没有理解副作用时统一 `runAllTimers()`，否则递归 `setTimeout` 或周期性 `setInterval` 可能导致测试跑不完。也别忘了恢复真实计时器；否则后续测试中的 `waitFor`、Promise 调度或超时行为可能变得难以解释。

如果 fake timers 与 React `act()` 或 Testing Library 的等待方法同时使用，应显式推进虚拟时间并按 React 的要求包在 `act()` 中。不要把“异步永远 pending”一律归因于 Vitest，有时是虚拟时钟还没有向前走。

---

# 第 6 章：React Testing Library ——测试用户能看到和完成的事

## 6.1 从用户角度查询 DOM

React Testing Library 的基本理念是：测试尽可能像用户与页面互动的方式。优先查询：

1. `getByRole(role, { name })`：按钮、标题、文本框、复选框等可访问角色和名称。
2. `getByLabelText()`：表单字段与它关联的 label。
3. `getByPlaceholderText()`、`getByText()`：在 role/label 不合适时使用。
4. `getByTestId()`：前面方式都不适用时的后备方案，而不是默认选择。

尽量避免通过内部 CSS class、组件私有状态、React 属性或 DOM 的偶然结构找元素。实现细节一改，测试就坏，而用户行为可能根本没有变化。

## 6.2 写一个可测试的注册表单

`src/components/SignupForm.tsx`：

```tsx
import { useState, type FormEvent } from 'react'

export type SignupInput = {
  email: string
  password: string
}

type Props = {
  onSubmit: (input: SignupInput) => Promise<void>
}

export function SignupForm({ onSubmit }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('loading')

    try {
      await onSubmit({ email: email.trim(), password })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="signup-email">邮箱</label>
      <input
        id="signup-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="signup-password">密码</label>
      <input
        id="signup-password"
        type="password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />

      <button type="submit" disabled={status === 'loading'}>
        {status === 'loading' ? '提交中…' : '创建账户'}
      </button>

      {status === 'success' && <p role="status">账户创建成功</p>}
      {status === 'error' && <p role="alert">创建失败，请重试</p>}
    </form>
  )
}
```

组件将提交函数通过 prop 注入。这样组件本身的工作是接收输入、显示加载状态和结果；网络请求由外层服务负责。它不需要在单元/组件测试里真的注册用户。

## 6.3 测试提交成功、失败与 loading

`src/components/SignupForm.test.tsx`：

```tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { SignupForm } from './SignupForm'

it('用户填写邮箱和密码后可以创建账户', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn().mockResolvedValue(undefined)

  render(<SignupForm onSubmit={onSubmit} />)

  await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'ada@example.com')
  await user.type(screen.getByLabelText('密码'), 'strong-password')
  await user.click(screen.getByRole('button', { name: '创建账户' }))

  expect(onSubmit).toHaveBeenCalledWith({
    email: 'ada@example.com',
    password: 'strong-password',
  })
  expect(await screen.findByRole('status')).toHaveTextContent('账户创建成功')
})

it('提交失败时显示用户可见的错误信息', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn().mockRejectedValue(new Error('network down'))

  render(<SignupForm onSubmit={onSubmit} />)

  await user.type(screen.getByRole('textbox', { name: '邮箱' }), 'ada@example.com')
  await user.type(screen.getByLabelText('密码'), 'strong-password')
  await user.click(screen.getByRole('button', { name: '创建账户' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('创建失败，请重试')
})
```

注意这些测试断言的是：

- 用户能够通过 label 找到表单字段；
- 用户能够输入、点击按钮；
- 表单提交时将正确数据传给服务边界；
- 成功/失败状态以可被用户或辅助技术感知的方式呈现。

它们没有去读 React 的 `status` state，也没有依赖 `.signup-form__error` 这样的样式类。若产品设计变更，把成功消息换成一个可访问的 toast，只要用户承诺不变，测试仍然可能成立。

## 6.4 `getBy`、`queryBy`、`findBy` 和 `waitFor` 的选择

它们的等待语义不同：

- `getBy...`：同步查询；元素不存在或有多个匹配时立即失败。适合已应存在的元素。
- `queryBy...`：同步查询；没有匹配时返回 `null`。常用于断言某个元素不存在。
- `findBy...`：返回 Promise，在指定超时内等待元素出现。适合异步请求完成后渲染的 UI。
- `waitFor(callback)`：反复尝试 callback，直到不再抛错或超时。适合等待多个条件或特定断言；不要把它当成随便延迟一段时间的 `sleep()`。

例如：

```tsx
expect(screen.queryByRole('alert')).not.toBeInTheDocument()

await user.click(screen.getByRole('button', { name: '刷新' }))
expect(await screen.findByText('数据加载完成')).toBeInTheDocument()
```

不推荐：

```ts
await new Promise((resolve) => setTimeout(resolve, 1000))
```

固定等待 1 秒既慢，也不能保证异步行为真的完成。如果网络或电脑稍慢，仍有可能失败；如果只用 20ms，又可能过早执行断言。优先等待具体可观察条件。

## 6.5 原生表单校验也要考虑

示例中的输入元素使用了 `required` 和 `type="email"`。浏览器会对原生约束校验有自己的处理。测试时先明确你验证的是浏览器原生表单行为，还是业务层的输入规则。例如“表单为空时不发送请求”可以通过填入/不填入字段后观察 `onSubmit` 调用次数来确认；复杂业务规则更适合由服务端或独立验证函数承担，并为其写纯函数单测。

## 6.6 `user-event` 为什么比到处用 `fireEvent` 更适合新手

`fireEvent` 更接近直接派发底层 DOM 事件；`user-event` 会模拟一次真实用户交互涉及的多个事件，并执行某些可交互性检查。因此输入文字、点击、键盘操作的组件测试通常优先使用 `user-event`。当你明确需要触发一个低层事件、而 user-event 不提供合适操作时，再使用 `fireEvent`。

测试应该尽量像真实用户：键入文字、点击按钮、等待消息，而不是直接给 React state 赋值。直接改变内部 state 往往等于绕过了你真正要验证的交互。

---

# 第 7 章：让 React Query、状态 store 与组件测试彼此隔离

## 7.1 为什么每个测试都要有自己的 QueryClient

如果多个测试共用一个 TanStack Query `QueryClient`，缓存、错误、重试、请求状态可能从前一个测试泄漏到后一个测试。某个测试即使没有真正发请求，也可能命中旧缓存，从而出现“本地单测绿、换顺序就红”的问题。

对每次渲染创建独立客户端：

```tsx
/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )

  return {
    ...result,
    queryClient,
  }
}
```

测试中每次调用 `renderWithQuery()` 都会获得新的客户端。测试里通常关闭重试，是为了让失败路径快速且确定，不需要等待 Query 自动重试；这并不意味着生产配置也应该关闭重试。若测试组件使用 Router、Theme、I18n 等 Provider，可以将这些通用包裹逻辑放在自定义 render 中，但仍应让状态可变的实例按测试创建。

## 7.2 状态 store 不要偷偷共享一个单例

对 Zustand、Redux、MobX 或自建 store，都有类似风险：测试 A 把计数改为 5，测试 B 默认期望 0，但测试 B 没有重置 store。

更可测试的做法是提供 store 工厂，而不是只导出唯一的可变单例：

```ts
// counter-store.ts：用一个简单的纯对象示意 store 工厂
export type CounterStore = {
  count: number
  increment(): void
}

export function createCounterStore(): CounterStore {
  return {
    count: 0,
    increment() {
      this.count += 1
    },
  }
}
```

```ts
import { expect, it } from 'vitest'
import { createCounterStore } from './counter-store'

it('一个测试中的 store 不会改变另一个新 store', () => {
  const first = createCounterStore()
  first.increment()

  const second = createCounterStore()
  expect(first.count).toBe(1)
  expect(second.count).toBe(0)
})
```

真实 Zustand 的 store API 与这里的示意对象不同，但核心设计相同：每个测试创建 store 或在测试结束后通过受支持的方式恢复初始状态。若组件直接 import 全局 store，测试也可以重置它，但那需要明确且可靠的 reset API，不应依赖测试顺序。

## 7.3 什么时候使用共享 Provider helper

共享 helper 是为了减少重复，不是为了偷偷让所有测试共享数据。一个 helper 可以复用 Provider 结构、路由和主题，但 QueryClient、store、mock server 状态、事件监听器应该按测试生成或明确重置。

检查自己的测试辅助代码时可以问：

1. 每次 `render()` 是否产生新的有状态依赖？
2. 如果前一个测试失败，清理是否仍会运行？
3. 能否单独运行一个测试？
4. 能否改变测试顺序而不改变结果？

若其中任何一项不确定，就先把隔离补好，再增加更多测试。

---

# 第 8 章：Fastify `app.inject()` 测试 API，不监听端口

## 8.1 为什么将 app 构建和 listen 拆开

如果应用在模块 import 时就执行 `listen(3000)`，测试会遇到端口冲突、启动开销、忘记关闭连接等问题。更好设计是：`buildApp()` 只创建 Fastify 实例、注册路由与插件，并将实例返回；生产入口才调用 `listen()`。测试中通过 `inject()` 直接给 app 注入一次模拟 HTTP 请求。

Fastify 的 `inject()` 基于 `light-my-request`，无需外部客户端连接实际 TCP 端口，并会确保注册插件完成启动后再执行请求。这不等于完全模拟了真实网络传输；它主要用于覆盖 Fastify 应用内的路由、hooks、schema 校验、错误处理和插件行为。

## 8.2 创建 app factory 与依赖注入

`src/server/app.ts`：

```ts
import Fastify from 'fastify'

export type User = { id: number; name: string }

export interface UserService {
  findById(id: number): Promise<User | null>
}

type AppDeps = {
  users: UserService
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: false })

  app.get<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const id = Number(request.params.id)

    if (!Number.isInteger(id) || id < 1) {
      return reply.code(400).send({ error: 'INVALID_ID' })
    }

    const user = await deps.users.findById(id)

    if (!user) {
      return reply.code(404).send({ error: 'USER_NOT_FOUND' })
    }

    return reply.code(200).send(user)
  })

  return app
}
```

生产启动入口 `src/server/main.ts` 可以是：

```ts
import { buildApp } from './app'
import { userService } from '../services/container'

const app = buildApp({ users: userService })

try {
  await app.listen({ host: '0.0.0.0', port: 3000 })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
```

`../services/container` 只是项目装配层示意，你应替换为自己的依赖组装位置。不要在 `app.ts` 里直接自动监听端口；测试只需要 build app。

## 8.3 用 inject 验证请求、响应与错误路径

`src/server/app.test.ts`：

测试前先创建独立的 app 和 mock，测试后关闭这个 app。这样不会出现“第一个测试已经关闭 app，后一个测试还要继续使用它”的生命周期错误。

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { buildApp } from './app'

let users: { findById: ReturnType<typeof vi.fn> }
let app: ReturnType<typeof buildApp>

beforeEach(() => {
  users = { findById: vi.fn() }
  app = buildApp({ users })
})

afterEach(async () => {
  await app.close()
})

it('找到用户时返回 200 和用户数据', async () => {
  users.findById.mockResolvedValue({ id: 7, name: 'Ada' })
  const response = await app.inject({ method: 'GET', url: '/users/7' })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toEqual({ id: 7, name: 'Ada' })
})

it('ID 不合法时返回 400 且不查询服务', async () => {
  const response = await app.inject({ method: 'GET', url: '/users/0' })
  expect(response.statusCode).toBe(400)
  expect(response.json()).toEqual({ error: 'INVALID_ID' })
  expect(users.findById).not.toHaveBeenCalled()
})

it('用户不存在时返回 404', async () => {
  users.findById.mockResolvedValue(null)
  const response = await app.inject({ method: 'GET', url: '/users/99' })
  expect(response.statusCode).toBe(404)
  expect(response.json()).toEqual({ error: 'USER_NOT_FOUND' })
})
```

**学习要点：** 示例先故意展示了一个很像真实代码、但生命周期设计错误的写法，再给出每测试一份 app 的正确版本。复制时只保留第二段修正版即可。这样每个测试都有独立的 mock 调用记录、实例和插件状态。

`response.json()` 会解析 JSON 响应体；若需要验证响应头，也可检查 `response.headers['content-type']`。路由测试不仅测 200：还要测无效参数、找不到资源、下游错误映射成 5xx 或业务状态码的合同。

## 8.4 插件与 hook 怎么测

当一个 Fastify plugin 注册路由、decorate、hook 或 schema 时，测试不应只直接调用插件内部函数，还应把插件注册到一个真实 Fastify 实例里，通过 `inject()` 观察最终结果。例如鉴权 hook：

- 不带 token 时：约定返回 401，不触发业务服务。
- 带合法 token 时：下游服务获得正确的 user/role，返回 200。
- token 解析器失败时：返回统一错误，而不是把内部异常堆栈泄漏给用户。

这类测试保留 Fastify 的路由分发与 hook 顺序，只在认证供应商或业务服务等外部边界上 mock。若完全 mock Fastify 或直接调用 handler，就无法证明插件真正注册成功、hook 顺序正确或响应经过框架序列化。

## 8.5 一定要关闭 app

测试建的 app 应被关闭，尤其当插件持有 timer、数据库池、Redis 连接或其他资源时。通常每个测试在 `afterEach` 里 `await app.close()`；如果资源属于共享测试 fixture，则应在对应 fixture 的正确生命周期关闭。不要只靠进程退出清理资源，因为那会让套件逐渐变慢，或让 CI 因开放句柄无法退出。

---

# 第 9 章：API、业务服务和数据库——mock 边界与真实集成

## 9.1 将业务服务写成可替换的依赖

假设注册用户包含以下规则：

1. 邮箱先去除两端空白并转为小写。
2. 邮箱已存在时抛出特定的业务错误。
3. 密码不应以明文存储，必须经过 hasher。
4. 合法用户最终由 Repository 写入。

`src/services/user-service.ts`：

```ts
export type NewUser = { email: string; passwordHash: string }
export type User = { id: number; email: string; passwordHash: string }

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>
  insert(input: NewUser): Promise<User>
}

export interface PasswordHasher {
  hash(password: string): Promise<string>
}

export class EmailAlreadyUsedError extends Error {
  constructor() {
    super('EMAIL_ALREADY_USED')
    this.name = 'EmailAlreadyUsedError'
  }
}

export function createUserService(deps: {
  users: UserRepository
  hasher: PasswordHasher
}) {
  return {
    async register(input: { email: string; password: string }): Promise<User> {
      const email = input.email.trim().toLowerCase()

      if (!email || !email.includes('@')) {
        throw new Error('INVALID_EMAIL')
      }

      const existing = await deps.users.findByEmail(email)
      if (existing) throw new EmailAlreadyUsedError()

      if (input.password.length < 12) {
        throw new Error('PASSWORD_TOO_SHORT')
      }

      const passwordHash = await deps.hasher.hash(input.password)
      return deps.users.insert({ email, passwordHash })
    },
  }
}
```

这里的邮箱校验只是用最简单的规则示意服务层测试；生产项目要定义实际的邮箱验证策略，并在适当层级再次校验。安全上不要自己设计密码哈希算法，应使用成熟的密码哈希实现，成本参数遵循项目威胁模型。

依赖通过参数传入，因此单元测试不需要 mock 模块加载器，也不必访问真实数据库。这可以同时提升代码的可读性、测试速度和架构边界的清晰度。

## 9.2 为业务服务写单元测试

```ts
import { beforeEach, expect, it, vi } from 'vitest'
import {
  createUserService,
  EmailAlreadyUsedError,
  type UserRepository,
  type PasswordHasher,
} from './user-service'

let users: UserRepository & {
  findByEmail: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
}
let hasher: PasswordHasher & { hash: ReturnType<typeof vi.fn> }
let service: ReturnType<typeof createUserService>

beforeEach(() => {
  users = {
    findByEmail: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      passwordHash: 'hash:strong-password',
    }),
  }
  hasher = {
    hash: vi.fn().mockResolvedValue('hash:strong-password'),
  }
  service = createUserService({ users, hasher })
})

it('规范化邮箱，哈希密码后写入仓储', async () => {
  const user = await service.register({
    email: '  ADA@EXAMPLE.COM ',
    password: 'strong-password',
  })

  expect(users.findByEmail).toHaveBeenCalledWith('ada@example.com')
  expect(hasher.hash).toHaveBeenCalledWith('strong-password')
  expect(users.insert).toHaveBeenCalledWith({
    email: 'ada@example.com',
    passwordHash: 'hash:strong-password',
  })
  expect(user.email).toBe('ada@example.com')
})

it('邮箱已存在时拒绝注册，也不哈希或写入', async () => {
  users.findByEmail.mockResolvedValue({
    id: 8,
    email: 'ada@example.com',
    passwordHash: 'existing-hash',
  })

  await expect(
    service.register({ email: 'ADA@example.com', password: 'strong-password' }),
  ).rejects.toBeInstanceOf(EmailAlreadyUsedError)

  expect(hasher.hash).not.toHaveBeenCalled()
  expect(users.insert).not.toHaveBeenCalled()
})

it('密码太短时拒绝注册', async () => {
  await expect(
    service.register({ email: 'ada@example.com', password: 'short' }),
  ).rejects.toThrow('PASSWORD_TOO_SHORT')

  expect(hasher.hash).not.toHaveBeenCalled()
  expect(users.insert).not.toHaveBeenCalled()
})
```

这三个测试证明服务自身的业务决策，而非数据库驱动是否能执行 SQL。此处 mock Repository 是合适的，因为测试目标就是 `createUserService` 的规则。若服务把业务判断全委托给数据库，那么就还需要集成测试证明数据库的约束与错误映射正确。

## 9.3 集成测试必须保留关键真实部件

服务单元测试可以证明：“发现邮箱已存在时，我会抛出 `EmailAlreadyUsedError`”。但它不能证明：

- `findByEmail()` 的 SQL 是否真的能找到已存在的行；
- 邮箱唯一约束是否存在并按预期生效；
- Repository 是否将数据库行正确映射成业务对象；
- 数据库异常是否被翻译成对外约定的业务错误；
- 真实数据库事务与连接配置是否正常。

这些问题需要集成测试。集成测试里应保留真实 Repository、真实 ORM/驱动、真实迁移和测试数据库，mock 的数量要少且有明确目的。

## 9.4 每个数据库测试都要有自己的事务或数据集

数据库隔离有几种常见策略：

1. **每测试一个事务，完成后回滚。** 快且干净，但要求被测代码确实通过同一个 transaction-bound client/connection 执行 SQL。如果服务偷偷从全局连接池另开连接，外层事务回滚并不会撤销那个连接写入的行。
2. **每测试一个独立数据集。** 用唯一的邮箱、随机 ID 或测试专用 tenant/schema，并在结束后清理。并行测试要确保命名不会碰撞。
3. **每套件或每 worker 一个专用测试数据库/schema。** 适合需要隔离约束、迁移和较多表的集成测试；清理策略应由 fixture 管理。
4. **容器化测试数据库。** 在 CI 使用专用 PostgreSQL/MySQL 等测试实例，确保版本、迁移与生产环境接近。不要连接生产库，也不要使用被多开发者共享且会互相污染的数据集。

下面用 `pg` 的 transaction-bound client 说明“事务回滚”的关键条件。它假设 Repository 接收客户端，并且所有 SQL 都用传入的同一个客户端执行：

```ts
import type { Pool, PoolClient } from 'pg'

export async function withRollbackTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    return await run(client)
  } finally {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  }
}
```

每个测试可以调用：

```ts
it('真实数据库可以保存并读回用户', async () => {
  await withRollbackTransaction(pool, async (tx) => {
    const repository = new PostgresUserRepository(tx)
    const inserted = await repository.insert({
      email: 'tx-case@example.com',
      passwordHash: 'test-hash',
    })

    const found = await repository.findByEmail('tx-case@example.com')
    expect(found).toMatchObject({ id: inserted.id, email: 'tx-case@example.com' })
  })
})
```

`PostgresUserRepository` 是你需要按实际表结构实现的适配器。此例意在展示事务边界，不是复制后无需修改就能运行的完整数据库仓库。

事务包装器必须保证测试失败时仍执行 `ROLLBACK` 并释放 client，因此用 `finally`。如果数据库驱动/ORM 的事务 API 不允许这样把客户端传到 Repository，就用该 ORM 官方的 transaction API，或使用隔离 schema/独立数据集。**绝不能因为测试声称会回滚，就假设所有异步 SQL 都已纳入同一事务。**

## 9.5 唯一约束与并发竞态

业务服务里“先查询，再插入”有竞态条件：两个并发请求可能同时查到邮箱不存在，然后都尝试插入。真正可靠的唯一性通常还需要数据库唯一索引；应用层的查询用于更友好地给出业务错误，但不能代替数据库约束。应为真实唯一约束写集成测试，并验证重复插入会以约定方式失败。

这也是为什么“单测全绿”不等于整个系统无问题：单元测试验证业务代码的决策，但并不替代数据库约束、隔离级别、事务和并发行为测试。

## 9.6 API、服务和数据库应该各测到哪里

以注册用户为例：

- **单测 `createUserService`**：邮箱规范化、密码长度、遇到已存在邮箱时的业务规则、哈希器与 Repository 的调用契约。
- **Fastify 路由测试**：请求体校验、状态码、响应 JSON、认证 hook、将领域错误映射为 409/400 等 API 合约。服务本身可以用替身，以快速定位路由行为。
- **Repository/数据库集成测试**：SQL、唯一约束、事务、映射、迁移和数据库异常处理。
- **少量端到端测试**：如果注册属于关键旅程，可从 UI 到 API 到测试数据库覆盖一条完整成功/失败流程。

并非每个组合都要全覆盖；要选真正容易出错、对用户影响大、mock 单测无法证明的集成点。

---

# 第 10 章：Coverage 覆盖率的正确读法

## 10.1 四个指标分别是什么

Vitest 当前支持 V8 与 Istanbul 等覆盖率 provider；默认 provider 为 `v8`，启用覆盖率还需要安装对应 provider 包（例如 `@vitest/coverage-v8`）。常见报告指标如下：

| 指标 | 含义 | 典型漏测信号 |
|---|---|---|
| Statements（语句） | 代码中的可执行语句有多少被执行 | 有些赋值、返回、调用语句从未运行 |
| Branches（分支） | 分支路径有多少被走过，例如 `if/else`、条件表达式、switch 分支 | 只测了条件为 true，没有测 false |
| Functions（函数） | 被执行过的函数占比 | 某个错误处理函数、回调或工具函数从未运行 |
| Lines（行） | 可执行代码行中执行过的行占比 | 某些代码行未执行 |

语句、行和分支不等价。例如 `const label = ok ? 'yes' : 'no'` 可能只执行了一行，但它有两个分支。测试只让 `ok` 为 true 时，行覆盖率看起来可能很高，branch coverage 却提醒你另一路径没有验证。

## 10.2 生成报告

```bash
npm run test:coverage
```

文本摘要会输出到终端，HTML 报告常见位置是 `coverage/index.html`。打开它，重点看红色/未覆盖分支，把覆盖率视为“哪些代码未被测试触达”的地图，而不是考试分数。

## 10.3 怎样设置阈值

配置里的 `thresholds` 可以让覆盖率低于门槛时命令返回失败，适用于 CI 守门。例如初期可以设定一个不会阻止整个团队修复历史遗留代码的底线，再逐步提高关键模块要求。对金额、权限、身份校验、资金状态迁移等高风险领域，应更多关注关键分支和错误路径，而不是只追求项目总平均值。

务必配置 `coverage.include`，否则默认报告往往只显示运行期间被导入的文件，完全没有被测试触达的源文件可能不会出现在报告里。通过 `coverage.exclude` 排除生成代码、声明文件等也要谨慎，不要把难测或低覆盖的重要业务模块随意排除。

## 10.4 为什么 100% 覆盖率也可能没质量

例如下面的测试可能执行了 100% 的函数和语句，却几乎没有价值：

```ts
it('调用函数', () => {
  applyDiscount(100, 20)
  expect(true).toBe(true)
})
```

这只证明函数没有让当前测试直接失败，完全没有验证结果是不是 80。即使把每个分支都执行一次，如果断言错了对象、断言过于宽松或所有外部依赖都被 mock，也仍会有漏网的业务缺陷。

提升质量的思路：

1. 先写明确行为和风险清单，再查看 coverage 找缺口。
2. 为关键分支断言具体结果，而不只让代码走一遍。
3. 对错误路径、权限边界、重复提交、并发状态转换等高风险行为设计测试。
4. 定期审查 mock 是否把真实逻辑也替换掉了。
5. 可考虑 mutation testing（变异测试）来检查测试能否识别故意引入的小错误；它比单纯看执行覆盖更接近“测试有没有发现错误”的问题。

覆盖率是观测信号，不是质量本身。

---

# 第 11 章：测试的稳定性、顺序、并发与资源清理

## 11.1 每个测试都应独立运行

一个可靠测试最好满足：

- 单独执行时通过；
- 与整套测试一起运行时结果相同；
- 改变测试顺序时结果相同；
- 前一个测试失败后，不会破坏后续测试的清理；
- 不依赖机器上偶然存在的文件、端口、时区、当前日期或网络。

导致不稳定的常见来源：可变全局状态、共享 mock 记录、共享数据库数据、开放连接、未清理的 interval、随机数、固定端口、依赖实际时钟、真实网络、依赖测试运行顺序。

## 11.2 形成清晰的生命周期习惯

典型安排如下：

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

let resource: { close: () => Promise<void> }

beforeEach(async () => {
  // 每次测试创建独立资源
  resource = await createResourceForTest()
})

afterEach(async () => {
  // 无论断言成功还是失败，都尽量释放资源
  await resource.close()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
```

这里的 `createResourceForTest()` 是示意工厂。实际项目应确保关闭方法即使部分初始化失败也不会抛出遮蔽原始错误。若一个测试里可能在赋值 `resource` 之前失败，就用 `resource | undefined` 并在清理时检查是否初始化成功。

一个常用的清理清单：

- React：卸载组件、订阅、事件监听器。
- Timer：清除 pending timers，恢复 real timers。
- Mock：清除调用记录、恢复 spy、撤销全局 stub。
- Fastify：关闭 app，释放插件拥有的资源。
- DB：回滚事务，释放连接，清理测试数据。
- 网络 mock/server：还原 handler 和服务器状态。
- 文件系统：删除临时文件与目录。

不要只在测试最后一行手动清理；如果中间断言失败，末尾清理不会执行。把清理放到 `afterEach`/`finally` 或 fixture teardown 中。

## 11.3 随机测试顺序能揭示隐藏依赖

Vitest 文档支持按配置调整测试文件顺序，也支持用于诊断的 shuffle/随机顺序选项（具体 CLI/选项名应按已安装版本核对）。建议在测试套件出现偶发失败时，用随机顺序或反向/不同顺序重跑，寻找依赖先前测试状态的测试。若为了复现需要固定 seed，应记录 seed 及具体失败文件。

随机化不是让测试每次都随机，而是有意改变执行顺序以发现隐藏共享状态。发现问题后，应修复测试隔离；不要靠固定顺序把 bug 永久藏起来。

## 11.4 文件并行与单文件内并发是两回事

Vitest 通常会并行运行多个测试文件，而同一个文件里的测试默认顺序执行。`test.concurrent` 会让标记的测试在一个文件中并发执行；文件间的 worker/pool 又是另一层并行度。

多数测试文件独立时，并行能显著提速。但若两个测试共用不可区分的数据库、固定端口、同一个临时目录或一套全局时钟，增加并行度就可能引入竞争条件。优先修复隔离方式；只有当外部资源确实无法隔离时，再考虑把相关测试划入单独 project 或控制文件并行度，而不是全局关闭并行。

对不共享状态的异步测试，`test.concurrent` 可以帮助节省等待时间。但不要为了变快把依赖同一个 QueryClient、mock 或数据库数据集的测试改成 concurrent。并发是优化，不是默认目标。

## 11.5 不要依赖真实时间与真实网络

- 定时逻辑用 fake timers，明确时钟推进到哪个时刻。
- 随机 ID 尽量从依赖参数或工厂注入，或者断言格式/唯一性而非硬编码偶然值。
- 时间日期逻辑明确时区、夏令时与系统时间，不能假设 CI 时区和开发者一致。
- 第三方网络接口在单元测试中 mock；在关键集成测试中使用可控的契约测试或专用测试环境。
- 如果真实 HTTP 请求是测试目标，记录合理超时，并保证资源被中断/释放。

## 11.6 失败定位：一次只修复一个根因

当测试失败，按这个次序排查：

1. **先读失败断言和堆栈。** 确定是被测结果错误，还是测试在查询/等待错误。
2. **单独运行该测试文件。** 若单独通过、整套失败，优先怀疑共享状态、并发或顺序依赖。
3. **单独运行失败的测试名。** 缩小范围后，可在源码附近临时加日志，但移除随机 `console.log` 前应先确认失败根因。
4. **检查 mock 返回类型。** `mockResolvedValue` 是否与真实 async API 一致？Mock 是否过早设置或路径不匹配？
5. **检查 DOM 与等待。** `getBy` 是否用于异步元素？是否应该用 `findBy`？组件是否因缺 Provider 报错？
6. **检查资源清理。** app/DB/client/timer 是否释放？前一个测试的状态是否泄漏？
7. **确认环境一致。** 本机 Node 版本、时区、环境变量、数据库迁移与 CI 是否相同？

不要先加一个 `await new Promise(resolve => setTimeout(resolve, 2000))` 来“修复”偶发失败。固定延时通常会掩盖根因，还会让套件越来越慢。

---

# 第 12 章：测试命名与维护成本

## 12.1 测试名应能独立作为文档阅读

差的测试名：`test 1`、`works`、`should pass`。

更清楚的名字：

- `折扣率为 100 时返回零金额`
- `用户不存在时 API 返回 404`
- `提交过程中禁用按钮以防止重复提交`
- `数据库唯一约束拒绝重复邮箱`

测试名应在 CI 报告里直接告诉你“什么行为失败了”。测试组的 `describe` 表达模块或业务主题，单条 `it` 表达一个具体承诺。

## 12.2 不要为了抽象而抽象

通用测试工厂和 helper 很有价值，但如果读者需要跳转五个文件才知道一条测试的输入是什么，就可能抽象过度。优先保证测试意图可读，再在重复确实形成维护成本时提取 helper。

适合抽取的内容包括：构建 Fastify app、建立独立 QueryClient、构建测试用户、创建 transaction fixture。应谨慎抽取只有一条测试使用、且隐藏了大部分安排步骤的复杂 helper。

## 12.3 快照测试不应成为万能答案

快照适合验证结构化输出或稳定的渲染结构，但很大的 UI 快照容易在更新时被机械地接受，出现差异却无人认真阅读。对新手而言，用户可见行为断言通常更具体、更有意图。若使用快照，应保持小、稳定、具业务意义，并理解更新快照意味着接受变化，而非证明变化正确。

---

# 第 13 章：把不同层级组合成一条真实的质量链

假设要交付“注册账户”功能，可按下面顺序开发与验收：

## 第一步：先锁定业务规则

列出输入边界：邮箱为空、两端空格、大小写不同、已存在、密码短于要求、Hasher 失败、Repository 写入失败。哪些属于业务规则，哪些属于数据库约束，哪些属于 API 协议？不要用一个巨大测试同时验证全部问题。

## 第二步：写服务层单元测试

通过 `createUserService({ users, hasher })` 注入两个替身，验证邮箱规范化、密码规则、业务错误、hashing 调用和不应发生的写入。这里的目标是快速、准确定位业务判断问题。

## 第三步：写数据库集成测试

使用测试数据库和真正的 `PostgresUserRepository`，验证 insert/find、唯一约束和错误映射。每个测试用事务、独立 schema 或唯一数据集隔离。不要用服务层单测来声称数据库约束已被证明。

## 第四步：写 Fastify 路由测试

用 `buildApp({ users: service })` 构建真实 Fastify app，用 `app.inject()` 发送 POST 请求。保留 schema 校验、hooks、序列化和路由代码；是否 mock service，取决于测试目标：

- 只测路由协议时，注入可预测的 service 替身。
- 测路由到服务的集成时，注入真实 service 和测试 Repository。

检查成功状态码、错误状态码、响应 schema、错误消息，以及验证失败时不应触发的下游调用。

## 第五步：写组件测试

通过 RTL 用户填入邮箱和密码、提交按钮，观察 loading / success / error 的用户可见状态。组件测试通常注入提交函数，不必每个表单测试都启动 Fastify 与数据库。少量端到端测试再覆盖整个注册链路。

## 第六步：运行覆盖率和稳定性检查

执行 `npm run test:coverage`，查看漏掉的分支。然后在 CI 里运行 `npm run test:run`，确保无开放句柄。出现偶发失败时检查缓存、数据库事务、mock 清理、计时器和并行数据集，而非直接增加测试超时。

整条质量链的重点是“各层证明各自该证明的东西”：单测证明规则，组件测试证明可见交互，路由测试证明 HTTP 契约，数据库集成测试证明真实适配器与约束，E2E 少量验证完整旅程。

---

# 第 14 章：常见问题与修复思路

## 14.1 `document is not defined`

**原因：** 测试运行在 `node` 环境，却直接使用 DOM。

**处理：** 给 React 测试文件加 `/** @vitest-environment jsdom */`，安装 `jsdom`，确认环境注释位于文件最前面；或为纯前端测试项目配置全局 `environment: 'jsdom'`。

## 14.2 `toBeInTheDocument is not a function`

**原因：** 未注册 jest-dom matcher，或者 `setupFiles` 路径不正确。

**处理：** 在 setup 文件中导入 `@testing-library/jest-dom/vitest`，确认配置实际被 Vitest 读取。注意 matcher 是 `toBeInTheDocument()`，不是单独导入一个同名函数。

## 14.3 测试一单独通过，整套一起失败

**原因：** 测试之间存在共享状态：单例 store、QueryClient cache、mock 的实现/调用记录、全局时钟、数据库行或资源。

**处理：** 每测试新建状态对象，清理 spy/stub/timer，数据库使用隔离事务/数据集，Fastify app 按测试构建并关闭。之后尝试随机顺序重跑。

## 14.4 异步测试偶发失败

**原因：** 没有 `await` Promise、异步 UI 使用 `getBy`、测试只等待固定时间、或 fake timer 没推进。

**处理：** 用 `await expect(promise).resolves/rejects`，用 `findBy...` 或 `waitFor` 等待具体条件，并确保虚拟时间被明确推进。不要简单地把 timeout 加到 30 秒。

## 14.5 `vi.spyOn()` 没有记录调用

**原因：** spy 安装前目标方法已经调用，测试实际上调用的是另一个对象/引用，或正在 Browser Mode 中对不可 spy 的原生 ESM 导出使用它。

**处理：** 在被测调用发生前建立 spy，检查对象与模块引用是否一致。可以改用依赖注入传参，或在适合的环境下用 `vi.mock()` 替换模块。

## 14.6 Fastify 测试卡住或端口冲突

**原因：** app import 时就 `listen()`，每个测试未关闭 app，或插件持有数据库连接池。

**处理：** 拆分 `buildApp()` 与生产启动入口；用 `app.inject()` 而非监听真实端口；每个测试结束 `await app.close()`，并关闭应用外层创建的连接池。

## 14.7 数据库测试污染别的测试

**原因：** 使用同一个共享数据库数据集，或者认为事务回滚会自动撤销从另一个连接发出的写入。

**处理：** 确认全部查询走同一事务客户端；若不能保证，则用独立 schema/数据库、唯一测试数据和清理。确保测试库 URL 显式与生产环境区分。

## 14.8 Coverage 高但 bug 仍然很多

**原因：** 代码执行过，但没有正确断言业务结果；或 mock 把关键实现替换掉；或真正关键的并发、错误映射、数据库约束根本没测。

**处理：** 从用户承诺和业务风险出发补测试，审查断言的实际含义，增加真实集成测试，必要时使用 mutation testing。

---

# 第 15 章：建议的日常工作流与 CI 规则

## 15.1 写新功能时的循环

1. 先写一句具体行为，比如“邮箱已存在时注册返回冲突错误”。
2. 决定最便宜的证明层级：业务规则用单元测试，用户交互用组件测试，路由契约用 inject，数据库约束用集成测试。
3. 编写能失败的测试，确认它因为业务结果不满足而失败，而不是导入路径或配置错误。
4. 实现最小必要代码，让测试通过。
5. 补边界值和错误路径，再运行相关测试。
6. 执行全量测试与 coverage，判断是否有未覆盖的高风险路径。
7. 最后检查清理与隔离，确保独立运行和 CI 运行都稳定。

这是红-绿-重构的实用版本：先看到测试红，再实现为绿，在行为受保护的前提下重构。不是所有任务都必须严格测试先行，但测试应能在缺陷存在时真实地失败一次。

## 15.2 CI 最低建议

CI 常用命令：

```bash
npm ci
npm run test:run
npm run test:coverage
```

`npm ci` 按锁文件安装，能够提高 CI 依赖的可重复性。若 `test:coverage` 与 `test:run` 重复运行让 CI 时间过长，也可以将 coverage 放到专门 job 中；但合并前应有约定的必跑测试门禁。

进一步的团队约束可以包括：

- 必须包含关键业务分支与错误路径，而不只是 happy path。
- 对高风险模块设定明确覆盖率阈值，且不准通过随意排除文件来通过门禁。
- 测试数据库只允许写专用实例，并通过迁移从零初始化。
- 不允许用固定 sleep 解决 flaky test，必须等具体条件。
- 测试资源必须在 finally/afterEach 中释放。
- 当改变公开业务契约时，同时更新测试与产品/接口说明。

## 15.3 哪些测试不该追求秒级以外的绝对速度

Unit 测试理应快，通常应让大量单元测试在很短时间完成。Component 测试可允许适度成本。数据库集成测试会慢一些，但如果每次全量测试都启动大型环境、重复迁移上千次，应考虑 fixture 复用与测试数据隔离设计。关键不是要求所有测试都一样快，而是让昂贵测试的数量、作用和运行频率都清晰。

---

# 第 16 章：练习与自检答案

完成每个练习前先自己动手，不必只读答案。

## 练习 1：分页输入

写一个 `normalizePage(page, pageSize)`：页码至少为 1，每页数量限定在 1 到 100，非法值应以明确错误失败。请写至少 6 个测试，其中包括上下界、越界和非法类型/数值。

**自检方向：** 覆盖 page=1、pageSize=1、pageSize=100、page=0、pageSize=101、`NaN` 或非整数。先明确你是选择纠正输入还是抛错，两种策略都可以，但测试契约必须一致。

## 练习 2：防止重复提交

为一个提交按钮组件写测试，用户点击后显示“提交中”，请求期间按钮禁用，请求成功后显示成功消息，失败后显示错误消息。

**自检方向：** 通过 props 注入返回 Promise 的函数；用一个可手动 resolve/reject 的 Promise 测试 loading 状态，或用 `findByRole` 等待最终结果。不要直接修改组件 state。

## 练习 3：Fastify 错误映射

为 `POST /users` 写 inject 测试：请求体缺邮箱时返回 400；服务抛 `EmailAlreadyUsedError` 时返回 409；其他未知错误不会把内部堆栈泄漏到 JSON 响应体。

**自检方向：** 路由测试应该检查 status code、响应 JSON 的稳定字段、是否调用 service。把某些情况的 service 设成 mock 可让路由错误映射测试更聚焦；再增加一条连接真实服务和测试数据库的集成测试。

## 练习 4：数据库唯一约束

使用专用测试数据库，让同一邮箱插入第一次成功、第二次失败。每条测试完成后不留下数据，并能与另一个并行测试同时运行。

**自检方向：** 不要只依靠服务层 `findByEmail` 的 mock；用真实唯一索引。要么确保 insert 操作共享可回滚事务，要么使用隔离数据集并可靠清理。并发场景应直接验证数据库约束，而不是只在应用层先查后写。

## 练习 5：覆盖率与质量

假设一个函数有 `if (isAdmin)` 分支，你的测试只有 `isAdmin = true`。报告 line coverage 是 100%，branch coverage 是 50%。还需要什么测试？

**自检方向：** 加一条非管理员路径测试，并断言它的业务结果（例如拒绝访问）；不要只调用函数而不检查结果。若权限判断涉及 API，还可为 HTTP 401/403 错误契约写路由测试。

---

# 第 17 章：核心概念逐项验收清单

学完后逐条勾选。若某条只能背出名字，尚不能用代码解释，就回到对应章节完成练习。

- [ ] **测试层级：** 我能说明 unit、component、integration 各自证明什么、速度和维护成本如何不同。
- [ ] **Vitest 配置：** 我能配置测试发现规则、脚本、coverage，并能按文件设置 `node` 与 `jsdom`。
- [ ] **setupFiles：** 我能说明它在每个测试文件前运行；不会把它与 `globalSetup` 或 `beforeAll` 混为一谈。
- [ ] **AAA 与边界值：** 我的测试有清晰的准备、动作和断言，并覆盖边界、异常与不同业务路径。
- [ ] **参数化测试：** 我能将同一规则的多组数据写成清晰的 parameterized tests。
- [ ] **异步断言：** 我对 Promise 的成功、拒绝与 DOM 异步渲染使用 `await`、`.resolves`、`.rejects`、`findBy`/`waitFor`。
- [ ] **mock 函数：** 我能解释 `vi.fn()`、`vi.spyOn()`、`vi.mock()` 的区别，以及 `clear`、`reset`、`restore` 的差别。
- [ ] **Fake timers：** 我能控制虚拟时间，并在测试结束时清除 timer、恢复真实时钟。
- [ ] **RTL：** 我优先用 role、accessible name、label 和 user-visible behavior；不会先依赖 class 或内部 state。
- [ ] **组件清理：** React DOM 被卸载；每个测试拥有自己的 QueryClient 和 store。
- [ ] **Fastify：** 我将 app factory 与 `listen()` 分开，用 `app.inject()` 验证请求、响应和插件行为，并关闭 app。
- [ ] **数据库：** 我使用专用测试数据库、事务/隔离数据集，并理解回滚仅覆盖同一连接/事务里的操作。
- [ ] **Mock 边界：** 我 mock 外部不确定依赖，不把被测业务逻辑或所有内部集成都 mock 掉。
- [ ] **Coverage：** 我能解释 statements、branches、functions、lines，并把覆盖率当诊断信号而非质量证明。
- [ ] **稳定性：** 测试可单独运行，不依赖顺序；并发资源有隔离，连接与全局环境得到清理。
- [ ] **失败定位：** 遇到 flaky test，我能区分异步等待、状态泄漏、并行竞态、mock 配置与外部环境问题。

---

# 第 18 章：官方文档与继续学习路线

教程的配置细节、兼容性和 Vitest API 随版本更新。遇到版本差异时，以项目锁文件和官方当前文档为准。下面优先列出本教程直接参考的官方页面：

1. **Vitest 入门与安装** — https://vitest.dev/guide/
2. **Vitest 写测试** — https://vitest.dev/guide/learn/writing-tests
3. **异步测试** — https://vitest.dev/guide/learn/async
4. **Setup 与 Teardown** — https://vitest.dev/guide/learn/setup-teardown
5. **Mock 函数** — https://vitest.dev/guide/learn/mock-functions
6. **模块 Mock** — https://vitest.dev/guide/mocking/modules
7. **Fake timers** — https://vitest.dev/guide/mocking/timers
8. **测试环境** — https://vitest.dev/guide/environment.html
9. **测试并行** — https://vitest.dev/guide/parallelism.html
10. **覆盖率** — https://vitest.dev/guide/coverage.html
11. **Coverage 配置** — https://vitest.dev/config/coverage.html
12. **Setup files 配置** — https://vitest.dev/config/setupfiles.html
13. **React Testing Library 查询优先级** — https://testing-library.com/docs/queries/about/
14. **按 role 查询** — https://testing-library.com/docs/queries/byrole/
15. **按 label 查询** — https://testing-library.com/docs/queries/bylabeltext/
16. **user-event** — https://testing-library.com/docs/user-event/intro/
17. **React Testing Library setup** — https://testing-library.com/docs/react-testing-library/setup/
18. **Fastify 测试指南** — https://fastify.dev/docs/latest/Guides/Testing/
19. **Fastify Server API（含 inject）** — https://fastify.dev/docs/latest/Reference/Server/

推荐阅读顺序：先掌握第 2 到第 5 章，把第一批纯函数测试真正跑通；接着完成第 6、7 章的 UI 测试；然后做 Fastify 和数据库集成；最后用覆盖率与稳定性章节审查测试质量。不要试图一次记住所有 API，核心能力是持续提出“我要验证哪条承诺？”并为它选择最合适、最少耦合的测试层级。

---

## 最后：一个可长期使用的判断框架

开始写一条测试之前，依次问自己五个问题：

1. **要保护的承诺是什么？** 把它写成用户、调用者或系统可观察的结果。
2. **最便宜的有效测试层级是什么？** 纯业务规则优先单测；UI 行为用组件测试；路由与数据库真实契约用集成测试。
3. **什么应该是真的，什么应该替换？** 保留本次测试要证明的逻辑和集成，隔离外部不确定边界。
4. **这条测试会不会污染别的测试？** 数据、时钟、全局值、mock、store、cache、连接都要有所有者和清理时机。
5. **如果它失败，能否在一分钟内理解为什么？** 清晰的测试名、单一行为、具体断言和可定位的错误，是测试长期有用的关键。

只要持续按照这个框架设计测试，就能逐渐形成快速、可靠、低耦合的测试层，而不是把测试变成一份脆弱、维护困难的重复代码。
