// The app's fonts (Inter for the UI, Source Serif 4 for post and
// knowledge-base text; index.css under html.ppgd-app). Loaded by the pages
// that use them (the editor, the release notes), not in index.css, so blogs
// never download them.
export function loadAppFonts(): void {
  document.documentElement.classList.add("ppgd-app");
  if (document.getElementById("ppgd-app-fonts")) return;
  const link = document.createElement("link");
  link.id = "ppgd-app-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400..600&display=swap";
  document.head.appendChild(link);
}
