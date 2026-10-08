import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";

interface Props {
  /** If true, creates a draft post in the new collection after creation. */
  withPost?: boolean;
  onClose: () => void;
  onConfirm: (input: { name: string; emoji: string | null; withPost: boolean }) => void;
}

export function NewCollectionDialog({ withPost = false, onClose, onConfirm }: Props) {
  const [emoji, setEmoji] = useState("");
  const [name, setName] = useState("");
  const [alsoPost, setAlsoPost] = useState(withPost);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    queueMicrotask(() => nameRef.current?.focus());
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onConfirm({ name: n, emoji: emoji.trim() || null, withPost: alsoPost });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-[440px] max-w-[92vw] rounded-xl border border-secondary bg-secondary p-6 shadow-2xl ring-1 ring-primary"
      >
        <h2 className="type-heading text-primary">New collection</h2>
        <p className="mt-1 text-sm text-secondary">
          Give it an emoji and a name. You can edit the description later from the collection page.
        </p>

        <div className="mt-5 flex items-start gap-3">
          <label className="flex flex-col">
            <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
              Emoji
            </span>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="🙂"
              className="w-16 rounded-lg border border-secondary bg-primary px-3 py-2 text-center text-2xl outline-none focus:border-tertiary"
            />
          </label>
          <label className="flex flex-1 flex-col">
            <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-quaternary">
              Name
            </span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Briefs"
              className="rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none focus:border-tertiary"
            />
          </label>
        </div>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={alsoPost}
            onChange={(e) => setAlsoPost(e.target.checked)}
            className="size-4 cursor-pointer accent-primary"
          />
          Also create a first draft post
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <Button size="sm" color="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" color="primary" type="submit" isDisabled={!name.trim()}>
            Create
          </Button>
        </div>
      </form>
    </div>
  );
}
