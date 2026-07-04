# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "transformers @ git+https://github.com/huggingface/transformers.git", "accelerate", "librosa", "soundfile", "numpy"]
#
# [[tool.uv.index]]
# name = "pytorch-cu124"
# url = "https://download.pytorch.org/whl/cu124"
# explicit = true
#
# [tool.uv.sources]
# torch = { index = "pytorch-cu124" }
# ///
"""
Qwen3-ASR resident STT worker (#326 自ホスト STT backend の常駐プロセス側).

server/src/services/sttBackend.js の local backend (STT_BACKEND=local / TRANSCRIPTION_MODE=organon)
が localhost:8123 にこの worker を叩く。モデルを一度だけロードして常駐し、per-clip は generate のみ。

  GET  /health      -> {"ok": true, "loaded": true, "model": ...}
  POST /transcribe  {"path": "<audio path>", "glossary": "<optional>"} -> {"text","total_ms","gen_ms"}

★ glossary 契約: 未指定 / 空 なら「素の認識」(system="Japanese")。
  = organon モードは補正段(gpt-4o-mini+organon)で固有名詞を直すので、decode 時 glossary は使わず
    Qwen生をクリーンに取る (Day48 Exp6: Qwen は訂正可能な誤り方をする → clean raw が最良の substrate)。
  glossary を明示指定した場合のみ decode 時 biasing を効かせる (legacy 実験用途)。

起動: cd server/scripts && uv run qwen_worker.py   (別ターミナルで常駐させる)
env : QWEN_WORKER_PORT (default 8123) / QWEN_MODEL (default Qwen/Qwen3-ASR-0.6B-hf)
"""
import os, sys, json, time, glob, torch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from transformers import AutoProcessor, Qwen3ASRForConditionalGeneration

MODEL = os.environ.get("QWEN_MODEL", "Qwen/Qwen3-ASR-0.6B-hf")
PORT = int(os.environ.get("QWEN_WORKER_PORT", "8123"))

print(f"[worker] cuda={torch.cuda.is_available()} "
      f"({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}) model={MODEL}", flush=True)
t0 = time.perf_counter()
proc = AutoProcessor.from_pretrained(MODEL)
model = Qwen3ASRForConditionalGeneration.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="auto")
print(f"[worker] model loaded in {time.perf_counter()-t0:.2f}s (one-time)", flush=True)


def transcribe(path, glossary):
    # glossary 空 = 素の認識 (organon モードの clean raw)。指定時のみ decode 時 biasing。
    sys_text = "Japanese" if not glossary else (
        "Japanese\n固有名詞（会社/人名/地名/機械, 綴りを保持）: " + glossary)
    chat = [[
        {"role": "system", "content": [{"type": "text", "text": sys_text}]},
        {"role": "user", "content": [{"type": "audio", "path": path}]},
    ]]
    t_all = time.perf_counter()
    inputs = proc.apply_chat_template(chat, tokenize=True, return_dict=True).to(model.device, model.dtype)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t_gen = time.perf_counter()
    with torch.inference_mode():
        out = model.generate(**inputs, max_new_tokens=256)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    gen_ms = (time.perf_counter() - t_gen) * 1000
    gen = out[:, inputs["input_ids"].shape[1]:]
    text = proc.decode(gen, return_format="transcription_only")[0].strip()
    return text, (time.perf_counter() - t_all) * 1000, gen_ms


# warmup so the first real request isn't penalized by lazy CUDA init
try:
    v = glob.glob(r"C:\app\tealus-media\voices\*.wav")
    if v:
        transcribe(v[0], "")
        print("[worker] warmup done", flush=True)
except Exception as e:
    print(f"[worker] warmup skipped: {e}", flush=True)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "loaded": True, "model": MODEL})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(n) or b"{}")
        path = req.get("path")
        glossary = req.get("glossary", "")  # ★ default 空 = 素の認識
        if not path or not os.path.exists(path):
            return self._send(400, {"error": f"path missing or not found: {path}"})
        try:
            text, total_ms, gen_ms = transcribe(path, glossary)
            self._send(200, {"text": text, "total_ms": round(total_ms, 1), "gen_ms": round(gen_ms, 1)})
        except Exception as e:
            self._send(500, {"error": f"{type(e).__name__}: {e}"})


print(f"[worker] listening on http://127.0.0.1:{PORT}  (GET /health, POST /transcribe)", flush=True)
ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
