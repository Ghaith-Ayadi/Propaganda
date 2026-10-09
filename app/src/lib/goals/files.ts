// What kind of file a plan drop holds, from its name and type.

import type { PlanFileKind } from "./types";

export function kindOf(f: { name: string; type: string }): PlanFileKind {
  const n = f.name.toLowerCase();
  if (f.type === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (f.type.startsWith("image/")) return "image";
  if (/\.(docx?|odt|rtf|pages)$/.test(n)) return "doc";
  if (/\.(md|markdown)$/.test(n)) return "markdown";
  if (/\.(xlsx?|csv|ods|numbers)$/.test(n)) return "spreadsheet";
  return "text";
}
