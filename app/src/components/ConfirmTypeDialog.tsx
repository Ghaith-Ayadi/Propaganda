import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";

interface Props {
  title: string;
  message: React.ReactNode;
  /** The user must type this exactly to enable the confirm button. */
  confirmation: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmTypeDialog({
  title,
  message,
  confirmation,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onClose,
}: Props) {
  const [v, setV] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  const match = v.trim() === confirmation;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
      >
        <h2 className="type-heading text-primary">{title}</h2>
        <div className="mt-2 text-sm text-secondary">{message}</div>
        <div className="mt-4 text-xs text-tertiary">
          Type <span className="rounded bg-primary_hover px-1.5 py-0.5 font-mono text-primary">{confirmation}</span> to confirm.
        </div>
        <Input
          size="sm"
          ref={inputRef}
          value={v}
          onChange={(val) => setV(val)}
          wrapperClassName="mt-2"
          placeholder={confirmation}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" color="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            color={destructive ? "primary-destructive" : "primary"}
            isDisabled={!match}
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
