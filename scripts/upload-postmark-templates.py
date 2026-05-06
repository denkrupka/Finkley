#!/usr/bin/env python3
"""
Создаёт/обновляет шаблоны в Postmark через API из docs/email-templates/.

Subject и alias парсятся из HTML-комментария в начале каждого файла:
  <!--
    Postmark template alias: <alias>
    Subject: <тема письма>
    ...
  -->

Если шаблон с таким alias уже существует — обновляется (PUT), иначе создаётся (POST).
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = ROOT / "docs" / "email-templates"
TOKEN = "a5d80101-eb60-474c-ae98-02cc8a1cf98e"
API = "https://api.postmarkapp.com"


def request(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": TOKEN,
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8")
        raise RuntimeError(f"HTTP {e.code} {path}: {body_text}") from e


def parse_meta(html: str) -> tuple[str, str]:
    """Достаёт alias и subject из комментария в начале HTML."""
    alias_m = re.search(r"alias:\s*(\S+)", html)
    subj_m = re.search(r"Subject:\s*([^\r\n]+)", html)
    if not alias_m or not subj_m:
        raise ValueError("alias/subject not found in HTML header comment")
    return alias_m.group(1).strip(), subj_m.group(1).strip()


def make_text_body(html: str) -> str:
    """Очень простая HTML→text для plain-text fallback."""
    text = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n\s*\n", "\n\n", text).strip()
    return text


def main() -> int:
    existing = request("GET", "/templates?count=100&offset=0").get("Templates", [])
    by_alias = {t["Alias"]: t for t in existing if t.get("Alias")}

    created = 0
    updated = 0

    for path in sorted(TEMPLATES_DIR.glob("*.html")):
        html = path.read_text(encoding="utf-8")
        alias, subject = parse_meta(html)
        body = {
            "Name": path.stem.replace("-", " ").title(),
            "Alias": alias,
            "Subject": subject,
            "HtmlBody": html,
            "TextBody": make_text_body(html),
            "TemplateType": "Standard",
        }
        if alias in by_alias:
            tid = by_alias[alias]["TemplateId"]
            print(f"  updating  {alias!r:25}  → template id {tid}")
            request("PUT", f"/templates/{tid}", body)
            updated += 1
        else:
            print(f"  creating  {alias!r:25}")
            r = request("POST", "/templates", body)
            print(f"    new template id: {r.get('TemplateId')}")
            created += 1

    print()
    print(f"Done. Created {created}, updated {updated}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
