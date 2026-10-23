# 第 10 章：综合实战与逐项验收

> 本章目标：把前九章的能力**拼成一个完整作品**——LaunchPad 云实例开通表单（可访问、复杂字段、客户端 + 服务端校验闭环、防重复提交）；然后对照你在开头立下的**核心概念清单**，**逐项验收**，确保每一条都真正掌握。
> 对应路线图能力点：**全部**。

---

## 10.1 实战需求：LaunchPad 完整版

我们要做的表单，必须同时满足：

1. **设计系统**：所有控件用 shadcn/ui（底层 Base UI）组件，颜色走 design token，深色模式正常；
2. **可访问**：label 关联、ARIA 状态、错误 `role="alert"`、开通前**二次确认弹窗**满足 focus trap / Esc / 返回焦点；
3. **复杂字段**：嵌套对象（配置）、字段数组（环境变量、通知邮箱，可增删）、条件字段（自动扩缩容阈值）、跨字段（min ≤ max、确认密码）、异步（实例名唯一性预检）；
4. **校验闭环**：客户端 Zod 校验（体验）→ 提交 → 服务端**同一份 schema** 校验 + 业务校验（安全边界）→ 错误批量回填到字段；
5. **生命周期**：dirty/touched、提交中禁用、成功重置、**三层防重复提交**。

### 文件结构（回顾第 1.5 节）

```
src/
├── components/ui/                 # shadcn 拷入的组件源码（第 2 章）
├── features/launch/
│   ├── launch-schema.ts           # 单一事实来源：Zod schema + 类型（第 5、9 章）
│   ├── map-server-errors.ts       # 服务端错误→setError 映射（第 8 章）
│   ├── confirm-dialog.tsx         # 可访问二次确认弹窗（第 4 章）
│   └── launch-form.tsx            # 主表单（第 6~9 章）
└── server/
    ├── validate.ts                # 服务端复用 schema（第 8 章）
    └── routes/instances.ts        # Express 路由（第 8 章）
```

---

## 10.2 单一事实来源：schema（最终版）

```ts
// src/features/launch/launch-schema.ts
import { z } from "zod";

export const REGIONS = ["us-east", "us-west", "eu-central"] as const;
export const PLANS = ["standard", "performance", "enterprise"] as const;

export const LaunchSchema = z
  .object({
    name: z
      .string()
      .min(3, "实例名至少 3 个字符")
      .max(32, "实例名最多 32 个字符")
      .refine((v) => /^[a-zA-Z]/.test(v), "实例名必须以字母开头"),

    region: z.enum(REGIONS, { message: "请选择区域" }),
    plan: z.enum(PLANS, { message: "请选择套餐" }),

    autoScale: z.boolean(),
    scalingThreshold: z.number().min(0).max(1).optional(),

    replicas: z.object({
      min: z.coerce.number().int().min(1, "至少 1 个副本"),
      max: z.coerce.number().int().max(64, "最多 64 个副本"),
    }),

    envVars: z
      .array(z.object({ key: z.string().min(1, "键必填"), value: z.string() }))
      .max(10, "最多 10 个环境变量"),

    emails: z
      .array(z.object({ address: z.string().email("邮箱格式不正确") }))
      .min(1, "至少一个通知邮箱")
      .max(5, "最多 5 个"),

    contactEmail: z.string().trim().toLowerCase().email("联系邮箱格式不正确"),
  })
  // 跨字段：min ≤ max，错误落到 replicas.max
  .refine((d) => d.replicas.min <= d.replicas.max, {
    message: "最小副本数不能大于最大副本数",
    path: ["replicas", "max"],
  })
  // 条件字段：开自动扩缩容必须有阈值
  .superRefine((d, ctx) => {
    if (d.autoScale && d.scalingThreshold == null) {
      ctx.addIssue({
        code: "custom",
        path: ["scalingThreshold"],
        message: "开启自动扩缩容时必须设置阈值",
      });
    }
  });

export type LaunchInput = z.input<typeof LaunchSchema>;
export type LaunchOutput = z.output<typeof LaunchSchema>;
```

> 这一个文件被**前端表单和服务端路由同时 import**——这就是「同一套校验前后端复用」的物理落地（第 5.7、8.5 节）。

---

## 10.3 可访问二次确认弹窗（第 3、4 章）

```tsx
// src/features/launch/confirm-dialog.tsx
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmLaunchDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  summary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  summary: { name: string; region: string; plan: string };
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    // modal 默认 true → focus trap + 锁滚动；Esc 默认可关闭
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // 危险操作：初始焦点落在"取消"，避免回车误开通。
        // Base UI：DialogContent 把 initialFocus 透传给底层 Dialog.Popup（第 4.6 节）；
        // 关闭后 finalFocus 默认回到 Trigger，无需显式设置。
        initialFocus={cancelRef}
      >
        <DialogHeader>
          <DialogTitle>确认开通实例？</DialogTitle>
          <DialogDescription>
            即将在 {summary.region} 用 {summary.plan} 套餐创建「{summary.name}
            」，并开始计费。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {/* 内部渲染 Close，保证触屏读屏用户能退出（第 4.4 节） */}
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "开通中…" : "确认开通"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> **后端差异（重要）**：本项目走 **Base UI**，控制初始/返回焦点用 `Dialog.Popup` 的 `initialFocus` / `finalFocus`（shadcn 的 `DialogContent` 会把它们透传下去）。若你的项目当初选了 **Radix**，等价写法是 `<DialogContent onOpenAutoFocus={(e) => { e.preventDefault(); cancelRef.current?.focus() }}>`——`onOpenAutoFocus` 是 **Radix 专有** prop，别在 Base UI 项目里用。**两条路都满足 focus trap / Esc / 返回焦点**，因为模态行为由底层原语默认提供。

**键盘走查（务必亲自验证）**：Tab 到触发器 → 回车打开 → 焦点是否在「取消」→ 连续 Tab 焦点只在弹窗内循环 → Esc 关闭 → 焦点回到触发器。

---

## 10.4 主表单（组装全部能力）

```tsx
// src/features/launch/launch-form.tsx
import { useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { XIcon } from "lucide-react";
import {
  LaunchSchema,
  REGIONS,
  PLANS,
  type LaunchOutput,
} from "./launch-schema";
import { applyServerErrors } from "./map-server-errors";
import { ConfirmLaunchDialog } from "./confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldSet,
  FieldLegend,
  FieldGroup,
} from "@/components/ui/field";

export function LaunchForm() {
  // 三泛型：input（transform 前）/ ctx / output（transform 后）
  const form = useForm<z.input<typeof LaunchSchema>, unknown, LaunchOutput>({
    resolver: zodResolver(LaunchSchema), // 客户端校验（体验）
    mode: "onTouched",
    criteriaMode: "all",
    shouldUnregister: true, // 卸载的条件字段不参与校验
    defaultValues: {
      name: "",
      region: "us-east",
      plan: "standard",
      autoScale: false,
      replicas: { min: 1, max: 3 },
      envVars: [],
      emails: [{ address: "" }],
      contactEmail: "",
    },
  });

  const {
    fields: envFields,
    append: addEnv,
    remove: removeEnv,
  } = useFieldArray({ control: form.control, name: "envVars" });
  const {
    fields: emailFields,
    append: addEmail,
    remove: removeEmail,
  } = useFieldArray({ control: form.control, name: "emails" });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const submittingRef = useRef(false); // 防重复提交：同步锁
  const keyRef = useRef(crypto.randomUUID()); // 防重复提交：幂等键
  const { isSubmitting, isDirty } = form.formState;

  async function submit(data: LaunchOutput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": keyRef.current,
        },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        // 服务端校验（安全边界）回显
        if (json.errors?.length) applyServerErrors(form.setError, json.errors);
        else form.setError("root", { message: json.message ?? "开通失败" });
        setConfirmOpen(false);
        return;
      }
      form.reset(); // 成功 → pristine
      keyRef.current = crypto.randomUUID();
      setConfirmOpen(false);
    } catch {
      form.setError("root", { message: "网络异常，请重试" });
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      className="grid max-w-xl gap-6"
      noValidate
      onSubmit={form.handleSubmit(
        (data) => setConfirmOpen(true) /* 先弹确认 */,
        (errs) => {
          // onInvalid：把焦点移到第一个出错的字段，提升可访问性
          const first = Object.keys(errs)[0];
          if (first) form.setFocus(first as any);
        },
      )}
    >
      {form.formState.errors.root && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {form.formState.errors.root.message}
        </div>
      )}

      {/* 实例名（含异步唯一性预检，见下方说明） */}
      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>实例名称</FieldLabel>
            <Input
              {...field}
              id={field.name}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                fieldState.invalid ? `${field.name}-error` : undefined
              }
            />
            {fieldState.invalid && (
              <FieldError
                id={`${field.name}-error`}
                errors={[fieldState.error]}
              />
            )}
          </Field>
        )}
      />

      {/* 区域 / 套餐：Select（受控 → Controller） */}
      <Controller
        name="region"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>区域</FieldLabel>
            <Select
              value={field.value}
              onValueChange={field.onChange}
              name={field.name}
            >
              <SelectTrigger id={field.name} aria-invalid={fieldState.invalid}>
                <SelectValue placeholder="选择区域" />
              </SelectTrigger>
              <SelectContent>
                {REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      {/* 自动扩缩容 + 条件字段 */}
      <Controller
        name="autoScale"
        control={form.control}
        render={({ field }) => (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="autoScale">自动扩缩容</FieldLabel>
            <Switch
              id="autoScale"
              name={field.name}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </Field>
        )}
      />
      {form.watch("autoScale") && (
        <Controller
          name="scalingThreshold"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="scalingThreshold">扩缩容阈值</FieldLabel>
              <Slider
                id="scalingThreshold"
                value={[field.value ?? 0.5]}
                onValueChange={([v]) => field.onChange(v)}
                aria-invalid={fieldState.invalid}
              />
              <FieldDescription>CPU 使用率超过该阈值时扩容。</FieldDescription>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      )}

      {/* 嵌套对象：副本数 min/max（跨字段 min≤max） */}
      <FieldSet>
        <FieldLegend variant="label">副本数</FieldLegend>
        <FieldGroup>
          <Controller
            name="replicas.min"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field>
                <FieldLabel htmlFor="replicas-min">最小</FieldLabel>
                <Input
                  {...field}
                  id="replicas-min"
                  type="number"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          <Controller
            name="replicas.max"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field>
                <FieldLabel htmlFor="replicas-max">最大</FieldLabel>
                <Input
                  {...field}
                  id="replicas-max"
                  type="number"
                  aria-invalid={fieldState.invalid}
                  onChange={(e) => {
                    field.onChange(e); /* 跨字段联动可 trigger min */
                  }}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </FieldGroup>
      </FieldSet>

      {/* 字段数组：环境变量（key 用 field.id） */}
      <FieldSet>
        <FieldLegend variant="label">环境变量</FieldLegend>
        <FieldGroup>
          {envFields.map((f, i) => (
            <div key={f.id} className="flex gap-2">
              <Controller
                name={`envVars.${i}.key`}
                control={form.control}
                render={({ field }) => (
                  <Input
                    {...field}
                    placeholder="KEY"
                    aria-label={`第 ${i + 1} 个环境变量键`}
                  />
                )}
              />
              <Controller
                name={`envVars.${i}.value`}
                control={form.control}
                render={({ field }) => (
                  <Input
                    {...field}
                    placeholder="value"
                    aria-label={`第 ${i + 1} 个环境变量值`}
                  />
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`删除第 ${i + 1} 个环境变量`}
                onClick={() => removeEnv(i)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </FieldGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addEnv({ key: "", value: "" })}
          disabled={envFields.length >= 10}
        >
          添加环境变量
        </Button>
        {form.formState.errors.envVars?.root && (
          <FieldError>{form.formState.errors.envVars.root.message}</FieldError>
        )}
      </FieldSet>

      {/* 字段数组：通知邮箱 */}
      <FieldSet>
        <FieldLegend variant="label">通知邮箱</FieldLegend>
        <FieldGroup>
          {emailFields.map((f, i) => (
            <Controller
              key={f.id}
              name={`emails.${i}.address`}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  orientation="horizontal"
                  data-invalid={fieldState.invalid}
                >
                  <Input
                    {...field}
                    id={`email-${i}`}
                    type="email"
                    placeholder="name@example.com"
                    aria-label={`第 ${i + 1} 个通知邮箱`}
                    aria-invalid={fieldState.invalid}
                  />
                  {emailFields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`删除第 ${i + 1} 个邮箱`}
                      onClick={() => removeEmail(i)}
                    >
                      <XIcon />
                    </Button>
                  )}
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          ))}
        </FieldGroup>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addEmail({ address: "" })}
          disabled={emailFields.length >= 5}
        >
          添加邮箱
        </Button>
        {form.formState.errors.emails?.root && (
          <FieldError>{form.formState.errors.emails.root.message}</FieldError>
        )}
      </FieldSet>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "处理中…" : "开通实例"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => form.reset()}
          disabled={!isDirty}
        >
          重置
        </Button>
      </div>

      {/* 二次确认弹窗：确认后才真正提交 */}
      <ConfirmLaunchDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isSubmitting={isSubmitting}
        summary={{
          name: form.watch("name") || "(未命名)",
          region: form.watch("region"),
          plan: form.watch("plan"),
        }}
        onConfirm={() => form.handleSubmit(submit)()}
      />
    </form>
  );
}
```

> **异步唯一性预检**（实例名）为节省篇幅未内联，完整实现见第 9.5 节方式 A（schema 内 async `superRefine` + 防抖 + AbortController）。它属于**体验层**，最终唯一性判定仍由服务端 10.5 完成。

---

## 10.5 服务端：同一份 schema + 业务校验（第 8 章）

```ts
// src/server/routes/instances.ts（Express 风格，与前端口语一致的 TS/async）
import express from "express";
import { LaunchSchema } from "@/features/launch/launch-schema"; // ← 复用同一份

export const router = express.Router();

router.post("/api/instances", async (req, res) => {
  // 幂等：同一 Idempotency-Key 只处理一次
  const key = req.header("Idempotency-Key");
  if (key && (await store.seen(key)))
    return res.status(200).json({ ok: true, deduped: true });

  // ① 结构校验（复用 schema）
  const parsed = LaunchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path,
        message: i.message,
      })),
    });
  }

  // ② 业务校验（只有服务端能做：唯一性 / 配额 / 权限）
  const data = parsed.data;
  if (await db.instance.findByName(data.name)) {
    return res
      .status(409)
      .json({
        ok: false,
        errors: [{ path: ["name"], message: "该实例名已被占用" }],
      });
  }
  if (!(await quota.canCreate(req.user, data.plan))) {
    return res
      .status(403)
      .json({
        ok: false,
        errors: [{ path: [], message: "配额不足，请升级套餐" }],
      });
  }

  // ③ 建实例
  const instance = await db.instance.create(data);
  if (key) await store.mark(key);
  return res.status(201).json({ ok: true, instance });
});
```

前端 `applyServerErrors`（第 8.6）会把 `errors[].path` join 成点号路径落到字段，空 path 落 `root`。**闭环完成**。

---

## 10.6 端到端测试走查

按顺序验证，每条都对应一个能力点：

1. **设计系统**：切换深色模式，确认所有控件颜色随 token 变化，无硬编码色（第 2 章）；
2. **可访问-弹窗**：键盘走查确认弹窗（focus trap / Esc / 返回焦点 / 初始焦点在取消）（第 4 章）；
3. **可访问-字段**：开 VoiceOver，聚焦各字段能念出 label + 必填；报错能主动播报（第 4 章）；
4. **客户端校验**：留空提交，错误落到每个字段，焦点跳到第一个错误（第 8 章）；
5. **条件字段**：勾选自动扩缩容显示阈值；取消后提交，阈值不再被校验（第 9 章）；
6. **跨字段**：min > max，错误显示在 max；改 min 后 max 错误重算（第 9 章）；
7. **字段数组**：增删环境变量/邮箱，删中间项值不串行（第 9 章）；
8. **异步预检**：输入已占用的名字，防抖后显示"已被占用"（第 9 章）；
9. **服务端校验**：绕过前端直接 `curl` 发非法 body，服务端用同 schema 拒绝（第 8 章）；
10. **服务端错误回显**：提交被占用名，409 的错误落到 name 字段；配额不足落到表单顶部 root（第 8 章）；
11. **防重复提交**：慢接口下狂点确认，只产生一条请求/一个实例（第 7 章）；
12. **成功重置**：开通成功后表单回到 pristine，幂等键更新（第 7 章）。

---

## 10.7 逐项验收清单（对照你的核心概念清单）

下面是你在学习目标里列出的**核心概念清单**，逐条给出「在哪学、怎么算通过」。全部打勾即达成目标。

### A. shadcn/ui：可拷入并修改的组件源码/分发方式

- [ ] **理解源码分发**：能说清 `shadcn add` 是把源码复制进 `src/components/ui/`，`package.json` 无 shadcn 依赖（第 2.1）；
- [ ] **维护组件源码**：能读懂 button.tsx / field.tsx 源码结构（第 2.4、2.5）；
- [ ] **维护 tokens**：能只改 `--primary` 等 CSS 变量全局换肤 + 深色模式（第 2.3）；
- [ ] **维护 variants**：能用 `cva` 读懂/新增 variant（第 2.4）；
- [ ] **自定义边界**：能按「className / 业务封装 / 加 variant / 改源码」四层做最小侵入决策（第 2.6）。

### B. Base UI primitives

- [ ] **受控/非受控**：能区分并各写一遍，知道接 RHF 要用受控（第 3.5）；
- [ ] **组合式 API**：能用 `render` prop 组合自定义组件（转发 ref + 铺 props），并说出与 Radix `asChild` 的差异（第 3.4）；
- [ ] **弹窗/菜单/Popover/Select**：能拼出四者并描述其结构（Root/Trigger/Portal/Positioner/Popup）（第 3.3、3.6）；
- [ ] **焦点管理**：能说清 `initialFocus`/`finalFocus`/`modal`（第 3.7、4.6）；
- [ ] **键盘行为**：能描述方向键/Home/End/Enter/Esc/字母跳转（第 3.6、3.7）。

### C. 可访问性

- [ ] **label 与控件关联**：`htmlFor`/`id`、Base UI Field 自动关联、`aria-label(ldby)`（第 4.1）；
- [ ] **ARIA 状态**：正确使用 `aria-invalid`/`aria-required`/`aria-describedby`（第 4.2）；
- [ ] **错误描述**：`role="alert"` + `aria-describedby` 完整链路（第 4.3）；
- [ ] **focus trap**：`modal` 默认锁焦点，键盘走查焦点不外泄（第 4.4）；
- [ ] **escape 关闭**：确认 Esc 生效，不用禁 Esc 做强制留存（第 4.5）；
- [ ] **返回焦点**：`finalFocus` 默认回 Trigger，危险弹窗初始焦点放安全项（第 4.6）。

### D. React Hook Form

- [ ] **register**：原生 input 注册 + 值转换（第 6.3）；
- [ ] **Controller**：受控/自定义组件桥接，读懂 field/fieldState（第 6.4）；
- [ ] **useForm**：拿到控制器，理解 handleSubmit「先校验后回调」（第 6.2）；
- [ ] **formState**：errors/isDirty/isValid/isSubmitting/touchedFields 驱动 UI（第 6.6）；
- [ ] **defaultValues**：设初值，优先于 Zod `.default()`（第 6.5）；
- [ ] **reset**：重置到初值/新值（第 6.8）；
- [ ] **watch**：订阅值做条件渲染（第 6.7）；
- [ ] **setValue**：联动赋值 + shouldValidate/Dirty/Touch（第 6.7）。

### E. 表单生命周期

- [ ] **初始化**：同步 `defaultValues` / 异步 `reset(data)`（第 7.2）；
- [ ] **dirty/touched**：区分「改没改」与「碰没碰」并用于 UI（第 7.3）；
- [ ] **提交中**：`isSubmitting` 禁用 + loading（第 7.4）；
- [ ] **成功后重置**：`reset()` 回 pristine（第 7.5）；
- [ ] **服务端错误**：`setError` 回填字段级 + root 级（第 7.6、8.6）；
- [ ] **重复提交防护**：UI 禁用 + useRef 锁 + 幂等键三层（第 7.7）。

### F. 复杂字段与高级校验

- [ ] **字段数组**：`useFieldArray` + `field.id` 作 key（第 9.2）；
- [ ] **嵌套对象**：点号路径寻址 + 嵌套 errors（第 9.1）；
- [ ] **条件字段**：watch 显隐 + shouldUnregister/superRefine 让校验跟随（第 9.3）；
- [ ] **跨字段校验**：refine/superRefine + trigger 重算（第 9.4）；
- [ ] **异步校验**：防抖 + onBlur + 竞态防护 + 检查中状态（第 9.5）；
- [ ] **字段级错误**：三类错误精确落到路径并可访问展示（第 9.6）。

### G. Zod

- [ ] **object / string / number / enum**：描述表单数据（第 5.2）；
- [ ] **optional / nullable / default**：区分三者与推导类型（第 5.3）；
- [ ] **refine / superRefine**：单字段/跨字段/多错误（第 5.4）；
- [ ] **transform**：数据转换 + `z.coerce`（第 5.5）；
- [ ] **safeParse**：不抛异常的校验 + `error.issues`（第 5.6）；
- [ ] **z.input 与 z.output**：转换前后类型可不同，`z.infer===z.output`（第 5.5）；
- [ ] **zodResolver 接入 RHF**：三泛型解决 input≠output（第 8.2、8.3）；
- [ ] **客户端校验是体验不是安全边界**：能解释并落到「服务端复用同 schema」（第 8.1、8.5、8.8）。

> 全部打勾 = 你已达成学习目标：**能构建可访问的设计系统组件和复杂表单，并建立客户端校验、服务端校验与错误显示闭环。**

---

## 10.8 常见坑总表（全书汇总）

| 领域     | 高频坑                     | 一句话解法                                      |
| -------- | -------------------------- | ----------------------------------------------- |
| 环境     | `@/` 找不到                | vite + tsconfig 两处都配 alias                  |
| token    | 改了色没生效/深色不对      | 改 `:root` **和** `.dark` 的变量                |
| 定制     | 升级覆盖了改动             | 定制放业务封装层，少动 `ui/*`                   |
| Base UI  | 自定义 Trigger 无焦点/点击 | forwardRef + 铺 props                           |
| Base UI  | 受控组件点了不动           | `value` 必配 `onValueChange`                    |
| a11y     | 提交后读屏无反馈           | 错误用 `role="alert"`                           |
| a11y     | 弹窗焦点外泄/丢失          | 用默认 `modal` + `finalFocus`                   |
| Zod      | 数字校验总失败             | `z.coerce.number()`                             |
| Zod      | input≠output 类型报错      | 三泛型 `useForm<z.input,unknown,z.output>`      |
| RHF      | 数组项值串行               | key 用 `field.id`                               |
| RHF      | 条件字段仍被校验           | `shouldUnregister` 或条件卸载                   |
| RHF      | 改 A 后 B 错误不更新       | `trigger("B")`                                  |
| 闭环     | 服务端错误不显示           | `path.join(".")` + 核对字段名 + 空 path 落 root |
| 闭环     | 前端过后端拒               | 服务端用同 schema + 业务校验                    |
| 生命周期 | 连点创建多条               | UI 禁用 + useRef 锁 + 幂等键                    |

---

## 10.9 下一步延伸

学完本教程后，可继续深入：

- **多步表单（Wizard）**：用 RHF 的 `FormProvider`/`useFormContext` 跨步骤共享，每步一个 schema 分片；
- **文件上传**：Base UI 无内置，配合受控 `Controller` + 自定义上传组件 + 服务端校验大小/类型；
- **国际化错误**：把 Zod message 换成 i18n key，resolver 层统一翻译；
- **性能**：大表单用 `useWatch` 精准订阅、拆分字段组件、`memo` 化；
- **测试**：用 Vitest + Testing Library 测校验闭环；用 axe/playwright 做 a11y 自动检测；
- **RHF v8**：关注 React Compiler 下的 formState 订阅变化；
- **服务端框架**：把 10.5 的 Express 换成 Next.js Server Actions / Remix action，schema 复用逻辑不变（Base UI 的 `Form` 甚至直接支持 `useActionState` 的 `errors`）。

---

## 10.10 结语

回到最初的目标：

> **能构建可访问的设计系统组件和复杂表单，并建立客户端校验、服务端校验与错误显示闭环。**

你现在应该能清晰地说出这条链路：

**shadcn/ui（拥有源码，Base UI 地基）→ 可访问组件（label/ARIA/focus/键盘）→ Zod（数据契约，input/output 分离）→ RHF（表单状态机，register/Controller/生命周期）→ zodResolver（客户端校验=体验）→ 服务端同 schema（校验=安全边界）→ setError 批量回填（错误闭环）**。

每一环都能独立验收，串起来就是一个专业级、可访问、前后端一致的复杂表单。把它做进你的下一个真实项目里，才算真正学会。

---

上一章：[← 第 9 章：复杂字段与高级校验](./09-advanced-fields.md) ｜ 返回：[教程总目录](./README.md)
