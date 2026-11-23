import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'
export interface Toast {
  id: number
  text: string
  kind: ToastKind
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let next = 1

/** Short confirmations in the bottom-right corner: 3s for info, 6s for errors. */
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = next++
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] })
    window.setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = (text: string, kind?: ToastKind) => useToasts.getState().push(text, kind)
