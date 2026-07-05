# /// script
# requires-python = ">=3.10"
# dependencies = ["pykakasi"]
# ///
# #327 読み backfill の変換ヘルパ。stdin に term の JSON 配列を受け、{term: ひらがな読み} を stdout に返す。
# DB は触らない（呼び出し側 JS が pool/.env で更新）。pykakasi via `uv run`。
import sys, json, pykakasi

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
kks = pykakasi.kakasi()


def hira(s):
    return "".join(i["hira"] for i in kks.convert(s))


terms = json.load(sys.stdin)
json.dump({t: hira(t) for t in terms}, sys.stdout, ensure_ascii=False)
