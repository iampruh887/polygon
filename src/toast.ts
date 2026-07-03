import { useSyncExternalStore } from 'react';

// Tiny module-level toast store. Call toast('Saved') from anywhere — no context
// threading. ToastHost subscribes and renders. Auto-dismisses each after ~2.6s.

export type ToastKind = 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const l of listeners) l();
}

export function toast(message: string, kind: ToastKind = 'success'): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 2600);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => toasts,
  );
}
