# 第 13 章：完成书店闭环，证明你真正掌握了数据层

[上一章](./12-boundaries-and-testing.md) · [目录](./README.md)

最后我们不再孤立调用API，而是把前面所有能力串成一个实际流程：浏览图书 → 查看作者 → 下单 → 重放请求 → 模拟支付 → 保存书评 → 再读详情。

这一章给出可执行入口、预期结果、故障实验和完整验收。验收标准不是“能在代码里找出某个函数名”，而是能解释业务为什么正确，以及失败时会怎样。

## 13.1 本项目完成了什么，以及没有完成什么

最终 [example](./example) 是完整的数据访问层教学工程，包含schema、relations、迁移、Repositories、Services、种子、demo和测试。

它没有实现HTTP服务、认证系统、真正支付网关、退款、订单取消、库存预留过期、管理后台或云端部署。因此“支付”只在脚本中模拟；不能把 `markPaid` 直接开放成任意用户可调用的API。

订单价格、库存和幂等有明确实现。订单行一旦创建在本教程中不修改、不删除；待支付订单的库存会被扣减并一直占用。真实产品必须继续设计取消/过期库存释放，但那是下一轮业务扩展，不是可以隐瞒的生产能力。

## 13.2 先建立一个安全的练习环境

进入最终工程根目录：

```bash
cd drizzle-orm-tutorial/example
npm ci
npm run typecheck
npm run db:check
npm test
```

这是最快的验收入口。PGlite测试不需要真实Postgres，默认应看到10项通过、真实Postgres两项跳过。

有Docker/Postgres时按第2章启动教学容器，手动创建`.env`并复制`.env.example`里的本地教学连接串。先检查数据库名，确认不是业务库，再运行：

```bash
npm run db:migrate
npm run seed
npm run demo
```

使用配套工程时直接migrate已提供的迁移，不需要先generate一次；迁移已经是发布产物。只有你修改模型时才应generate新历史。

种子会创建：

- 用户小林，邮箱reader@example.com。
- 作者林远和周青。
- 三本书：SQL第一步（4900分，10本）、TypeScript实战（6900分，5本）、并发的故事（5900分，1本）。
- 第二本书有两位作者，position分别为1和2。

ID从数据库返回，脚本不假设一定是1、2、3。教学ISBN只是满足结构的占位标识，不声称是真实出版社编号。

seed检测教学数据已有时会拒绝继续，不删除旧数据。重复执行demo会创建新请求、继续消费库存；为了观察幂等，同一次demo内部会重放同一个请求。

## 13.3 从调用入口读懂整条链

完整脚本见 [demo.ts](./example/src/scripts/demo.ts)。它的关键内容如下，可按前面已经建立的目录直接运行：

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, closeDb } from "../db/client";
import { users } from "../db/schema";
import { listBooks, getBookDetail } from "../repositories/book-repository";
import { placeOrder, markPaid } from "../services/order-service";
import { saveReview } from "../services/review-service";

try {
  const [reader] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "reader@example.com"));
  if (!reader) throw new Error("请先运行 npm run seed");

  const page = await listBooks(db, { limit: 2 });
  console.log("第一页", page);
  const book = page.items[0];
  if (!book) throw new Error("没有图书");

  const input = {
    idempotencyKey: randomUUID(),
    items: [{ bookId: book.id, quantity: 1 }],
  };
  const order = await placeOrder(db, reader.id, input);
  const replay = await placeOrder(db, reader.id, input);
  console.log("订单与幂等重放", {
    orderId: order.id,
    replayId: replay.id,
    totalCents: order.totalCents,
  });

  // 仅模拟已验证支付；真实系统由可信支付回调触发。
  await markPaid(db, reader.id, order.id);
  await saveReview(db, reader.id, {
    bookId: book.id,
    rating: 5,
    body: "学会了先设计数据库！",
  });
  console.log("详情", await getBookDetail(db, book.id));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
```

读代码时，按四个边界逐步确认：

1. `listBooks`：投影、筛选、排序和limit，返回游标，不负责用户身份验证。
2. `placeOrder`：接受可信userId和未知rawInput，负责输入、幂等、价格、事务。
3. Repository：接收执行者，事务里传tx，不暗中另借全局连接。
4. `getBookDetail`：把不同表组织成嵌套响应，不改变底层外键。

`markPaid` 用orderId、userId和pending状态条件更新。它有条件一致性保护，但调用权限仍由可信调用方保证；这两者不能混为一谈。

## 13.4 第一次运行你应该看到什么？

刚seed后，通常第一本书是SQL第一步，因为种子同事务创建、以createdAt和id稳定排序。

预期重点不是对象打印格式，而是以下事实：

- 第一页2本书，nextCursor不为空。
- 两次placeOrder返回相同orderId，价格为数据库图书价格。
- 图书库存只减少1，不是减少2。
- 一张订单有一条订单行，unitPriceCents是4900。
- 模拟paid后允许书评；详情包含作者、最新书评、reviewCount。
- 所有业务完成后连接池关闭，脚本退出。

如果把图片、React界面或HTTP框架接上来，数据层的这些规则不应该改变。UI只是调用它们的入口之一。

## 13.5 逐步做三个故障实验

### 实验A：图书改价不影响已下单价格

完成下单后，在独立教学脚本中用实际bookId修改books.priceCents，再读取已创建订单。确认：

```text
books.price_cents → 新价格
order_items.unit_price_cents → 仍为下单旧价格
orders.total_cents → 仍为原订单总额
```

不要在UI展示历史订单时拿当前书价重新算钱。这条规则来源于模型设计，不是ORM缓存帮你保留历史。

### 实验B：第一本够、第二本不够

购物车买第一本2本、最后一本2本，最后一本初始库存只有1。预期抛OUT_OF_STOCK，第一本库存保持原值，没有新订单，也没有残余订单行。

查看 [失败回滚测试](./example/test/inkwell.test.ts)，它检查错误后数据库状态。只看到“报错了”还不算成功验收。

### 实验C：重复键配不同购物车

先用key K买一本，再用同key K买两本。预期IDEMPOTENCY_CONFLICT，不能“悄悄返回上次订单”欺骗调用者，也不重复扣库存。

如果客户端因为超时重试原购物车，继续用同key K才能找回已创建订单。生成新key代表新的业务意图。

## 13.6 再做真实双连接竞争

准备专用测试库：

```bash
docker exec inkwell-pg createdb -U postgres inkwell_test
TEST_POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/inkwell_test npm test
```

若库已经存在，不必重复createdb。测试会迁移并写入数据；不要用真实生产URL。

并发测试要求：

- 不同幂等键抢stock=1的书：恰好一个成功，另一人OUT_OF_STOCK，库存为0。
- 同幂等键并发重放：两次返回同订单，库存仍为0而不是负数。

默认测试不设置URL会跳过它们。本次只运行了PGlite路径，不能把未执行的并发测试写成已通过。

## 13.7 核心概念逐项验收

下面每组都同时包含操作和解释；建议你遮住参考判断，先自己回答。

### 一：列、空值、默认值和数据库设计

- [ ] 用Postgres builder写出integer、text、date、timestamp、uuid、enum。
- [ ] 说明`text().default('x')`为什么select仍可能为null。
- [ ] 分清省略、undefined、null、空字符串。
- [ ] 说明defaultNow与$onUpdate分别由谁执行。
- [ ] 解释订单价格快照、连接表和删除规则的业务理由。

验收题：把stock类型定义为number后，为什么还需要CHECK与输入校验？

参考：number不保证非负整数，也不保证HTTP值真实类型；数据库CHECK保护所有写入方，输入校验保护业务入口并改善错误反馈。

### 二：主外键、unique、index与check

- [ ] 实现复合主键、复合UNIQUE和外键删除规则。
- [ ] 用实际坏数据验证CHECK、FK、UNIQUE。
- [ ] 解释普通索引不等于唯一约束，FK不自动为引用侧建索引。
- [ ] 不重复创建PK已有的完全相同索引。

验收题：连接表PK是(book_id, author_id)，按author_id找书是否就有最合适索引？

参考：不能仅凭已有PK这样断言。反方向访问通常需要按author_id的索引，并用实际计划验证；索引数量要考虑写成本。

### 三：Drizzle schema与select/insert shape

- [ ] 使用`$inferSelect` / `$inferInsert`或Infer\*Model，而不是抄interface。
- [ ] 能写只有必需字段的NewBook，读回数据库默认值。
- [ ] 解释generated字段与完整读取形状的差别。
- [ ] 说明投影结果为什么不能强制当完整Book。

验收题：为什么不把Partial<User>当公开注册/更新输入？

参考：它错误地弱化必填规则，并暴露role、id等不应由普通用户改的字段；数据库模型和公共请求权限不同。

### 四：关系与Join

- [ ] 解释relations不会创建FK，one也不会创建UNIQUE。
- [ ] 实现一对多、多对多through和读取position的credits关系。
- [ ] 同一详情能写relation query与Join两种版本。
- [ ] 说明外连接nullable、父/子过滤和Join行展开。

验收题：两组一对多同时Join后sum销售量为什么可能翻倍？

参考：作者×订单行的组合产生行乘积，SUM按展开行计算；需要先各自聚合或明确去重策略。

### 五：CRUD、条件、排序与分页

- [ ] 完成insert/update/delete/returning投影。
- [ ] 用and/or写正确括号，处理0与undefined。
- [ ] 实现稳定排序、limit上限、offset与复合游标。
- [ ] 说明毫秒精度、日期JSON转换和筛选变更后重置游标。

验收题：为什么LIMIT20不总意味着数据库只读20行？

参考：过滤、排序、聚合、Join和offset可能先处理大量行；LIMIT约束结果，不是通用资源预算。

### 六：事务、批量、并发与冲突

- [ ] Service拥有事务，所有数据库操作传tx。
- [ ] 任一步失败不留下订单头、不丢第一本库存。
- [ ] 解释条件UPDATE如何在Read Committed下防超卖。
- [ ] 用唯一约束、幂等键和负载比较防重复下单。
- [ ] 能区分批量INSERT、驱动batch与事务。
- [ ] 知道死锁/序列化失败可有限重试整个事务，不重复外部副作用。

验收题：给先查stock再写stock的逻辑加transaction，为什么不一定解决超卖？

参考：两个事务仍可先读到相同旧值，需要原子条件更新、锁或适合的隔离策略，而不是只有原子性。

### 七：迁移与生产发布

- [ ] 能解释本地snapshot、生成SQL、数据库历史之间关系。
- [ ] 做一次nullable新增、数据回填、收紧约束的演练。
- [ ] 不改已应用历史，核对新旧应用兼容期。
- [ ] 用单个受控任务迁移，配置迁移身份与备份恢复策略。
- [ ] 识别CONCURRENTLY不能放进默认事务块。

验收题：新增回退列为什么不能恢复已被DROP的原数据？

参考：逆向DDL只能恢复结构，已提交数据损失需要备份/PITR或另有数据来源。应用回滚也不自动逆转数据库变更。

### 八：Raw SQL、安全与性能

- [ ] 展示sql模板中值进入params，不自己加引号。
- [ ] 动态字段/排序走白名单，不接收用户sql.raw。
- [ ] 解释sql<T>不做运行时映射，numeric/count有独立规则。
- [ ] 检查N+1与无界with，核对生成SQL和EXPLAIN。
- [ ] 日志脱敏，不把SQL/params完整返回给客户端。

验收题：关闭prepared是否等于关闭安全参数绑定？

参考：不等于。普通参数化查询依然安全，named prepared只是另一层依赖会话的优化。

### 九：连接与架构边界

- [ ] 按实例数计算Pool预算，区分脚本结束与共享池生命周期。
- [ ] 选择Direct、Session或Transaction，解释IPv4/IPv6与会话限制。
- [ ] 识别Postgres.js pipelining、prepared和TLS校验的不同问题。
- [ ] 不假设管理员直连自动携带HTTP用户RLS身份。
- [ ] Repository统一有价值的查询；简单SQL可留Service，不做万能GenericRepository。
- [ ] 区分类型检查、PGlite行为测试、真实并发与云端部署验证。

## 13.8 一道进阶作业：取消待支付订单

为了扩展系统，尝试实现cancelPendingOrder。不要先写代码，先推演两次取消并发时会不会还两遍库存：

1. 验证可信用户和订单归属。
2. 用条件状态更新把pending改为cancelled，只有实际转移成功的请求有权释放库存。
3. 在同一事务中读订单行并按固定bookId顺序归还数量。
4. 第二个请求不能再次归还；paid订单不能走该取消入口。
5. 如果归还库存失败，状态变化也必须回滚。

参考核心状态门闩：

```sql
UPDATE orders
SET status = 'cancelled', updated_at = now()
WHERE id = $1 AND user_id = $2 AND status = 'pending'
RETURNING id;
```

只有返回一行才执行库存归还。配套工程没有实现这道扩展；你需要补事务、错误策略、幂等语义和双连接测试，不能只加一个status字段就宣称取消完整。

还要重新审视书评资格、订单过期和支付回调与取消的竞争。这正是在ORM之外仍然存在的业务设计工作。

## 13.9 最后总结

你现在应该能沿着这条链解释每一环：

```text
业务事实与不变量
→ SQL表、键、约束与索引
→ Drizzle schema与推断类型
→ 有界、参数化的SQL查询
→ 明确事务与并发策略
→ Repository / Service分工
→ 可审阅迁移与可验证部署
```

Drizzle让TypeScript与SQL模型更直接地连接，但数据库设计、运行时校验、权限、资源边界和发布策略不会因此消失。

把所有验收做完，才算完成从0到1：不是只会调用ORM，而是知道数据为什么在成功、失败、重试和并发中仍然可信。
