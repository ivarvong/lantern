from __future__ import annotations

"""Strict check for an SVG frame from lantern.

One JSON object per line: svg, width, background, and paints ("hex" or "any").
Writes "ok" or "error: ..." for each line. Exit status is 0; callers read the lines.
"""
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2000/svg}"
TAGS = {NS + "svg", NS + "rect", NS + "path"}
SVG_ATTRS = {"xmlns", "width", "height", "viewBox"}
RECT_ATTRS = {"x", "y", "width", "height", "fill"}
PATH_ATTRS = {
    "d", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linejoin", "stroke-linecap", "opacity", "stroke-dasharray",
    "stroke-dashoffset", "transform",
}
COLOR = re.compile(r"^#[0-9a-f]{6}$|^none$")
# XML 1.0 Char. A Python str has no unpaired surrogates.
ILLEGAL = re.compile(r"[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\U00010000-\U0010FFFF]")


def check(req: dict) -> str:
    raw = req["svg"]
    if not isinstance(raw, str):
        return "error: svg"
    if ILLEGAL.search(raw):
        return "error: illegal xml character"
    if "<!" in raw or "<?" in raw:
        return "error: markup"
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        return "error: parse " + str(e)
    paints = req.get("paints", "any")
    rects: list[ET.Element] = []

    def walk(el: ET.Element) -> str | None:
        if el.tag not in TAGS:
            return "element " + el.tag
        allowed = SVG_ATTRS if el.tag == NS + "svg" else RECT_ATTRS if el.tag == NS + "rect" else PATH_ATTRS
        for name in el.attrib:
            if name.lower().startswith("on") or name not in allowed:
                return "attribute " + name
        if el.tag == NS + "rect":
            rects.append(el)
            if el.attrib.get("fill") != req["background"]:
                return "background " + el.attrib.get("fill", "")
        if el.tag == NS + "path" and paints == "hex":
            for key in ("fill", "stroke"):
                if key in el.attrib and not COLOR.match(el.attrib[key]):
                    return "paint " + el.attrib[key]
        for child in list(el):
            err = walk(child)
            if err:
                return err
        return None

    err = walk(root)
    if err:
        return "error: " + err
    if root.attrib.get("width") != str(req["width"]):
        return "error: width " + root.attrib.get("width", "")
    if len(rects) != 1:
        return "error: rect count " + str(len(rects))
    return "ok"


def main() -> None:
    code = 0
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            ans = check(json.loads(line))
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            ans = "error: " + str(e)
        sys.stdout.write(ans + "\n")
        if ans != "ok":
            code = 1
    sys.stdout.flush()
    if "--fail" in sys.argv and code:
        sys.exit(code)


if __name__ == "__main__":
    main()
