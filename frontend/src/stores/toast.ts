import { create } from "zustand";

export type ToastTone = "default" | "success" | "error";
type Toast = { id: number; message: string; tone: ToastTone };

type ToastState = {
  toast: Toast | null;
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toast: null,
  show: (message, tone = "default") => set({ toast: { id: nextId++, message, tone } }),
  hide: () => set({ toast: null }),
}));

export const toast = (message: string, tone?: ToastTone) => useToastStore.getState().show(message, tone);
