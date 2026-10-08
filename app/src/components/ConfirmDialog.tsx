import { useEffect } from "react";
import { Button } from "@/components/base/buttons/button";

interface Props {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
      >
        <h2 className="type-heading text-primary">{title}</h2>
        {message && <div className="mt-2 text-sm text-secondary">{message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" color="tertiary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            color={destructive ? "primary-destructive" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
