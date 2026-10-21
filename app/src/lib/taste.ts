// The tenant's taste profile (public.taste_profiles): the Pitcher's summary of
// what the tenant said yes and no to, and the tenant's own notes. Members read
// both; they write only the notes (the summary is the Pitcher's). Read and
// written straight on the server, not synced: only the agents use it.

import { useCallback, useEffect, useState } from "react";
import { coded } from "@/lib/errors";
import { siteId } from "@/lib/scope";
import { must, sb } from "@/lib/supabase";

export interface TasteProfile {
  /** Written by the Pitcher before each batch; "" until the first batch is reviewed. */
  summary: string;
  /** Everyone on the tenant shares these. */
  notes: string;
}

export async function loadTaste(): Promise<TasteProfile> {
  try {
    const rows = await must(sb.from("taste_profiles").select("summary, notes").eq("site", siteId()).limit(1));
    const row = (rows as TasteProfile[])[0];
    return { summary: row?.summary ?? "", notes: row?.notes ?? "" };
  } catch (err) {
    throw coded("TASTE-PROFILE", err, "Couldn't load your taste notes.");
  }
}

export async function saveTasteNotes(notes: string): Promise<void> {
  try {
    // Members may update only `notes`, so an upsert (which also sets `site`) is refused
    // once the row exists. Update first; insert when there was no row to update.
    const site = siteId();
    const clean = notes.trim().slice(0, 4000);
    const updated = await must(sb.from("taste_profiles").update({ notes: clean }).eq("site", site).select("site"));
    if ((updated as unknown[]).length === 0) await must(sb.from("taste_profiles").insert({ site, notes: clean }));
  } catch (err) {
    throw coded("TASTE-PROFILE", err, "Couldn't save your taste notes. Try again.");
  }
}

/** The profile, loaded once per mount; null while loading. */
export function useTaste(): { taste: TasteProfile | null; error: unknown; saveNotes: (notes: string) => Promise<void> } {
  const [taste, setTaste] = useState<TasteProfile | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    loadTaste()
      .then((t) => live && setTaste(t))
      .catch((err) => {
        if (!live) return;
        setError(err);
        setTaste({ summary: "", notes: "" });
      });
    return () => {
      live = false;
    };
  }, []);

  const saveNotes = useCallback(async (notes: string) => {
    await saveTasteNotes(notes);
    setTaste((t) => ({ summary: t?.summary ?? "", notes: notes.trim().slice(0, 4000) }));
  }, []);

  return { taste, error, saveNotes };
}
