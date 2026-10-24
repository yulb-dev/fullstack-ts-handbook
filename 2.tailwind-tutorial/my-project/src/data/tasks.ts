import type { Task } from "../types";

/**
 * 头像用 DiceBear initials 接口，seed 即姓名首字母。
 * 注意：URL 不含任何硬编码色值，颜色由服务端生成，符合"色值只存在于 theme.css"的审计约束。
 */
const avatar = (seed: string) =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}`;

const ada = { id: "u1", name: "Ada", avatarUrl: avatar("Ada") };
const linus = { id: "u2", name: "Linus", avatarUrl: avatar("Linus") };
const grace = { id: "u3", name: "Grace", avatarUrl: avatar("Grace") };
const alan = { id: "u4", name: "Alan", avatarUrl: avatar("Alan") };

/** 看板示例数据：覆盖三种 tone、两种 priority、单/多负责人等组合 */
export const TASKS: Task[] = [
  {
    id: "t1",
    title: "设计系统 token 落地",
    summary:
      "把散落在各组件的硬编码色值收敛到 theme.css 的语义 token，并补齐深色模式变量映射。",
    tone: "doing",
    priority: "high",
    assignees: [ada, grace],
    dueDate: "2026-10-28",
    dueDateLabel: "10 月 28 日",
  },
  {
    id: "t2",
    title: "移动端导航菜单",
    summary:
      "汉堡按钮 + 条件渲染菜单，补齐 aria-expanded / aria-controls 状态同步。",
    tone: "done",
    priority: "normal",
    assignees: [linus],
    dueDate: "2026-10-24",
    dueDateLabel: "10 月 24 日",
  },
  {
    id: "t3",
    title: "任务卡片组件化",
    summary:
      "按 variant API 抽取 TaskCard，布局外置、外观内聚，tone 用完整类名映射而非动态拼接。",
    tone: "doing",
    priority: "normal",
    assignees: [ada, alan, linus],
    dueDate: "2026-10-30",
    dueDateLabel: "10 月 30 日",
  },
  {
    id: "t4",
    title: "响应式统计表",
    summary:
      "overflow-x-auto 包裹宽表格，小屏可横向滑动，min-w 防止列被挤压变形。",
    tone: "todo",
    priority: "normal",
    assignees: [grace],
    dueDate: "2026-11-02",
    dueDateLabel: "11 月 2 日",
  },
  {
    id: "t5",
    title: "生产环境构建体积核查",
    summary:
      "npm run build 后检查 CSS 产物体积，确认未使用的工具类被正确摇树。",
    tone: "todo",
    priority: "high",
    assignees: [alan],
    dueDate: "2026-11-05",
    dueDateLabel: "11 月 5 日",
  },
  {
    id: "t6",
    title: "防 FOUC 主题脚本",
    summary:
      "head 内联脚本在渲染前根据 localStorage / 系统偏好确定 .dark 类，杜绝闪屏。",
    tone: "done",
    priority: "normal",
    assignees: [linus, grace],
    dueDate: "2026-10-22",
    dueDateLabel: "10 月 22 日",
  },
];
