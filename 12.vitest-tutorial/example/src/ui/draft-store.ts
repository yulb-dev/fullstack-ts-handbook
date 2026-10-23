import { create } from "zustand";

/**
 * 表单草稿 store（客户端状态）。
 * 模块级单例在测试里是隔离陷阱：第 8 章演示每个测试前重置状态的做法。
 */
export interface DraftState {
  draftTitle: string;
  setDraftTitle: (title: string) => void;
  clearDraft: () => void;
}

export const useDraftStore = create<DraftState>()((set) => ({
  draftTitle: "",
  setDraftTitle: (title) => set({ draftTitle: title }),
  clearDraft: () => set({ draftTitle: "" }),
}));

/** 测试辅助：把 store 恢复到初始状态（在生产代码中定义，避免测试各自复制初始值） */
export const initialDraftState = { draftTitle: "" } as const;
