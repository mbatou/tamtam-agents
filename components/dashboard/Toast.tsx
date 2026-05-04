"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TTL_MS = 3000;

export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      counter.current += 1;
      const id = `${Date.now()}-${counter.current}`;
      setItems((prev) => [...prev, { id, kind, message }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_TTL_MS);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "min-w-[220px] max-w-sm rounded-md border px-4 py-3 text-sm shadow-lg " +
              (t.kind === "success"
                ? "border-dakar-teal/40 bg-dakar-teal/10 text-dakar-teal"
                : t.kind === "error"
                  ? "border-dakar-error/40 bg-dakar-error/10 text-dakar-error"
                  : "border-dakar-border bg-dakar-surface text-dakar-text")
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Defensive — keeps a single missing-provider mistake from
    // crashing the whole dashboard.
    return {
      push: (msg, kind) => {
        // eslint-disable-next-line no-console
        console.warn(`[Toast outside provider] ${kind ?? "info"}: ${msg}`);
      },
    };
  }
  return ctx;
}

// Re-export the empty effect hook so callers don't need their own —
// keeps imports tidy in section components.
export { useEffect };
