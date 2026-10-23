import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { createConcert } from "../../api";

type ActionResult =
  | { ok: false; errors: Record<string, string>; values: Record<string, string> }
  | undefined;

// 第 4 章：服务端校验 + 错误映射 + 成功后 redirect
export async function action({ request }: ActionFunctionArgs) {
  const fd = await request.formData();
  const city = String(fd.get("city") ?? "").trim();
  const title = String(fd.get("title") ?? "").trim();
  const date = String(fd.get("date") ?? "");

  const errors: Record<string, string> = {};
  if (!city) errors.city = "城市必填";
  if (title.length < 3) errors.title = "标题至少 3 个字符";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "日期格式应为 YYYY-MM-DD";

  if (Object.keys(errors).length > 0) {
    // 出错：不 redirect，返回错误 + 用户已填的值（回填，避免丢失输入）
    return { ok: false as const, errors, values: { city, title, date } };
  }

  const concert = await createConcert({ city, title, date });
  return redirect(`/concerts/${concert.city}/${concert.id}`);
}

export default function NewConcert() {
  const actionData = useActionData() as ActionResult;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? {};

  const fields = [
    { name: "city", label: "城市" },
    { name: "title", label: "标题" },
    { name: "date", label: "日期 (YYYY-MM-DD)" },
  ] as const;

  return (
    <div>
      <h1>新建演唱会</h1>
      <Form method="post">
        {fields.map((f) => (
          <p key={f.name}>
            <label>
              {f.label}：
              <input
                name={f.name}
                defaultValue={values[f.name]}
                aria-invalid={!!errors[f.name]}
              />
            </label>
            {errors[f.name] && <span className="field-error">{errors[f.name]}</span>}
          </p>
        ))}
        <button type="submit" disabled={submitting}>
          {submitting ? "提交中…" : "创建"}
        </button>
      </Form>
    </div>
  );
}
