import base64, pathlib, sys
here = pathlib.Path(__file__).parent
fonts = [
  ("Crimson Pro", "CrimsonPro-Variable", "normal", "200 900"), ("Crimson Pro", "CrimsonPro-VariableItalic", "italic", "200 900"),
  ("Epilogue", "Epilogue-Variable", "normal", "100 900"), ("Epilogue", "Epilogue-VariableItalic", "italic", "100 900"),
  ("Public Sans", "PublicSans-Variable", "normal", "100 900"), ("Public Sans", "PublicSans-VariableItalic", "italic", "100 900"),
  ("JetBrains Mono", "JetBrainsMono-Variable", "normal", "100 800"),
]
faces = []
for fam, f, style, wght in fonts:
    b = base64.b64encode((here / "fonts" / f"{f}.woff2").read_bytes()).decode()
    faces.append(f"@font-face{{font-family:'{fam}';src:url(data:font/woff2;base64,{b}) format('woff2');font-style:{style};font-weight:{wght};font-display:swap}}")
font_css = "\n".join(faces)
site = (here / "site.css").read_text(); engine = (here / "engine.js").read_text(); fix = (here / "fixtures.js").read_text()
for name, text in (("site.css", site), ("engine.js", engine), ("fixtures.js", fix)):
    assert "</script" not in text.lower(), name
shell = (here / "shell.html").read_text()
body = (shell.replace("<!--FONTS-->", f'<style id="pg-fonts">\n{font_css}\n</style>')
             .replace("/*SITECSS*/", site).replace("/*ENGINE*/", engine).replace("/*FIXTURES*/", fix))
dist = here / "dist"; dist.mkdir(exist_ok=True)
(dist / "artifact.html").write_text(body)
skeleton = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
(dist / "prototype.html").write_text(skeleton + body.replace("<title>", "</head>\n<body>\n<title>", 0) + "\n</html>\n")
embed = (skeleton + f'<title>PPGD harness</title>\n<style id="pg-fonts">\n{font_css}\n</style>\n<style>{site}</style>\n<style id="theme"></style>\n<style>html,body{{margin:0}}</style>\n</head>\n<body>\n'
         f"<script>{engine}</script>\n<script>{fix}</script>\n" + (here / "embed-tail.html").read_text() + "</body>\n</html>\n")
(dist / "embed.html").write_text(embed)
for p in sorted(dist.iterdir()): print(p.name, round(p.stat().st_size / 1024), "KB")
