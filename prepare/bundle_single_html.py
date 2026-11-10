"""Write the whole site as one self-contained HTML file.
usage (from this folder):  python3 bundle_single_html.py [out.html]      default: ../od-dashboard.html
Inlines css/style.css and every script, including all months in data/od-YYYY-MM.js."""
import glob, os, re, sys

def main(build, out):
    html = open(os.path.join(build, "index.html")).read()
    css = open(os.path.join(build, "css", "style.css")).read()
    html = html.replace('<link rel="stylesheet" href="css/style.css">', "<style>\n" + css + "\n</style>")
    def inline(path):
        return "<script>\n" + open(os.path.join(build, path)).read().replace("</script", "<\\/script") + "\n</script>"
    html = html.replace('<script src="js/config.local.js" onerror="void 0"></script>\n', "")
    months = "\n".join(inline(os.path.relpath(p, build)) for p in sorted(glob.glob(os.path.join(build, "data", "od-????-??.js"))))
    html = html.replace('<script src="data/od-manifest.js"></script>', inline("data/od-manifest.js") + "\n" + months)
    for src in re.findall(r'<script src="([^"]+)"></script>', html):
        html = html.replace('<script src="%s"></script>' % src, inline(src))
    with open(out, "w") as fh:
        fh.write(html)
    print("wrote", out, round(os.path.getsize(out) / 1e6, 2), "MB")

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(os.path.join(here, ".."), sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "od-dashboard.html"))
