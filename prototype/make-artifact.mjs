// Turns dist/index.html into one artifact-shaped page: the host supplies the
// doctype, <html>, <head> and <body>, so drop those and the metas it already sets.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const head = html
  .match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/\s*<meta[^>]*>/g, "")
  .replace(/\s*<script src="https:\/\/cdnjs[^"]*"><\/script>/g, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
writeFileSync("artifact.html", `${head.trim()}\n${body.trim()}\n`);
