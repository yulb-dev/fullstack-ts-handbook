import { Form, data, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getConcert, updateConcert } from "../../api";
import type { Concert } from "../../api";

type ActionResult =
  | { ok: false; errors: Record<string, string>; values: Record<string, string> }
  | undefined;

// loader：载入原值；不存在则 404（第 3、6 章）
export async function loader({ params, request }: LoaderFunctionArgs) {
  const concert = await getConcert(params.concertId!, { signal: request.signal });
  if (!concert) throw data("找不到这场演唱会", { status: 404 });
  return { concert };
}

// action：校验 + 更新 + redirect（第 4 章）
export async function action({ request, params }: ActionFunctionArgs) {
  const fd = await request.formData();
  const title = String(fd.get("title") ?? "").trim();
  const date = String(fd.get("date") ?? "");

  const errors: Record<string, string> = {};
  if (title.length < 3) errors.title = "标题至少 3 个字符";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = "日期格式应为 YYYY-MM-DD";

  if (Object.keys(errors).length > 0) {
    return { ok: false as const, errors, values: { title, date } };
  }

  await updateConcert(params.concertId!, { title, date });
  return redirect(`/concerts/${params.city}/${params.concertId}`);
}

export default function EditConcert() {
  const { concert } = useLoaderData() as { concert: Concert };
  const actionData = useActionData() as ActionResult;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const errors = actionData?.errors ?? {};
  const values = actionData?.values ?? { title: concert.title, date: concert.date };

  return (
    <div>
      <h1>编辑演唱会</h1>
      <Form method="post">
        <p>
          <label>
            标题：
            <input name="title" defaultValue={values.title} aria-invalid={!!errors.title} />
          </label>
          {errors.title && <span className="field-error">{errors.title}</span>}
        </p>
        <p>
          <label>
            日期：
            <input name="date" defaultValue={values.date} aria-invalid={!!errors.date} />
          </label>
          {errors.date && <span className="field-error">{errors.date}</span>}
        </p>
        <button type="submit" disabled={submitting}>
          {submitting ? "保存中…" : "保存"}
        </button>
      </Form>
    </div>
  );
}
