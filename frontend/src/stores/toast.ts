import { create } from "zustand";

export type ToastTone = "default" | "success" | "error";
type Toast = { id: number; message: string; tone: ToastTone };

type ToastState = {
  toast: Toast | null;
  show: (message: string, tone?: ToastTone) => void;
  /** id 를 주면 그 알림일 때만 닫는다 (사라지는 중에 새 알림이 오면 새 알림을 지우지 않게) */
  hide: (id?: number) => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, tone = "default") => set({ toast: { id: nextId++, message, tone } }),
  hide: (id) => set((state) => (id === undefined || state.toast?.id === id ? { toast: null } : state)),
}));

export const toast = (message: string, tone?: ToastTone) => useToastStore.getState().show(message, tone);
