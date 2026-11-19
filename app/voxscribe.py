#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""VoxScribe 核心转写 CLI：本地音视频 -> 文字 / 字幕，可选 Ollama 润色。"""
from __future__ import annotations

import argparse
import gc
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
else:
    ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
OUTPUT_DIR = ROOT / "output"
LOG_DIR = ROOT / "logs"
OLLAMA_DIR = ROOT / "ollama"
OLLAMA_EXE = OLLAMA_DIR / "ollama.exe"
OLLAMA_HOST = os.environ.get("VOXSCRIBE_OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("VOXSCRIBE_OLLAMA_MODEL", "qwen2.5:7b")

LOCAL_MODELS = {
    "large-v3-turbo": MODELS_DIR / "faster-whisper-large-v3-turbo",
    "large-v3": MODELS_DIR / "faster-whisper-large-v3",
    "medium": MODELS_DIR / "faster-whisper-medium",
    "small": MODELS_DIR / "faster-whisper-small",
}

DEFAULT_PROMPT_ZH = "以下是普通话的句子。"

POLISH_PROMPT = """你是一名中文文字编辑。下面是语音识别的原始文本，可能存在同音错别字、漏字、断句不当。
请在完全保留原意和内容顺序的前提下：
1. 修正明显的同音错别字与专有名词错误；
2. 补全标点，按语义分段；
3. 删除无意义的重复语气词和识别噪声；
4. 不总结、不扩写、不评论。
只输出整理后的正文。"""


def log(msg: str) -> None:
    print(msg, flush=True)


def decode_audio(path: Path, sample_rate: int = 16000):
    """用 PyAV 解码任意音视频为 16k 单声道 float32，避免外部 ffmpeg 依赖。"""
    import av
    import numpy as np

    chunks = []
    with av.open(str(path), mode="r") as container:
        if not container.streams.audio:
            raise RuntimeError("文件里没有音频轨道")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))

    if not chunks:
        raise RuntimeError("音轨解码为空")
    pcm = np.concatenate(chunks).astype("float32") / 32768.0
    return pcm


def ts(seconds: float, sep: str = ",") -> str:
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", sep)


def resolve_model(name: str) -> str:
    local = LOCAL_MODELS.get(name)
    if local and (local / "model.bin").exists():
        return str(local)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return name


CUDA_BIN_DIRS = [
    r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.8\bin",
    r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9\bin",
    r"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin",
]


def ensure_cuda_path() -> None:
    """直接双击 exe 启动时没有 .bat 设置 PATH，这里补齐 CUDA 运行库路径。"""
    cur = os.environ.get("PATH", "")
    for d in CUDA_BIN_DIRS:
        if os.path.isdir(d) and d.lower() not in cur.lower():
            cur = d + ";" + cur
    os.environ["PATH"] = cur


def load_model(name: str, device: str, compute_type: str):
    ensure_cuda_path()
    from faster_whisper import WhisperModel

    attempts = []
    if device in ("auto", "cuda"):
        attempts += [("cuda", compute_type or "float16"), ("cuda", "int8_float16")]
    attempts += [("cpu", "int8")]

    last_err = None
    for dev, ct in attempts:
        try:
            t0 = time.time()
            model = WhisperModel(
                resolve_model(name),
                device=dev,
                compute_type=ct,
                download_root=str(MODELS_DIR),
                cpu_threads=max(4, (os.cpu_count() or 8) // 2),
            )
            log(f"[模型] {name} 已加载：{dev}/{ct}，耗时 {time.time() - t0:.1f}s")
            return model, dev, ct
        except Exception as e:  # noqa: BLE001
            last_err = e
            log(f"[警告] {dev}/{ct} 加载失败：{type(e).__name__}: {e}")
    raise RuntimeError(f"模型加载失败：{last_err}")


def _split_text(text: str, max_chars: int) -> list[str]:
    """按句末标点 -> 逗号 -> 硬切，把长句拆成适合字幕阅读的短行。"""
    def by_marks(s: str, marks: str) -> list[str]:
        parts, buf = [], ""
        for ch in s:
            buf += ch
            if ch in marks:
                parts.append(buf)
                buf = ""
        if buf.strip():
            parts.append(buf)
        return [p.strip() for p in parts if p.strip()]

    lines = []
    for sent in by_marks(text, "。！？；!?;"):
        for clause in by_marks(sent, "，,、：:"):
            if len(clause) <= max_chars:
                lines.append(clause)
            else:
                lines.extend(clause[i : i + max_chars] for i in range(0, len(clause), max_chars))
    return lines or [text.strip()]


def split_for_srt(segments, max_sec: float = 12.0, max_chars: int = 20) -> list[dict]:
    """把超长段落拆成可读字幕行，时间按字数比例分配。"""
    out = []
    for seg in segments:
        dur = float(seg["end"]) - float(seg["start"])
        text = seg["text"].strip()
        if dur <= max_sec and len(text) <= max_chars:
            out.append(seg)
            continue
        parts = _split_text(text, max_chars)
        merged, buf = [], ""
        for p in parts:
            if not buf:
                buf = p
            elif len(buf) + len(p) <= max_chars:
                buf += p
            else:
                merged.append(buf)
                buf = p
        if buf:
            merged.append(buf)
        parts = merged
        if len(parts) <= 1:
            out.append(seg)
            continue
        total = sum(len(p) for p in parts)
        t = float(seg["start"])
        for p in parts:
            d = dur * len(p) / total
            out.append({"start": t, "end": t + d, "text": p})
            t += d
    return out


def build_srt(segments) -> str:
    lines = []
    for i, seg in enumerate(split_for_srt(segments), 1):
        lines.append(str(i))
        lines.append(f"{ts(seg['start'])} --> {ts(seg['end'])}")
        lines.append(seg["text"].strip())
        lines.append("")
    return "\n".join(lines)


def build_txt(segments, with_ts: bool) -> str:
    if with_ts:
        return "\n".join(f"[{ts(s['start'], '.')[:-1]}] {s['text'].strip()}" for s in segments)
    return "\n".join(s["text"].strip() for s in segments if s["text"].strip())


def _drop_prompt_echo(segments: list[dict], prompt: str | None) -> list[dict]:
    """剔除模型把 initial_prompt 原样复读的幻觉片段（多出现在开头静音处）。"""
    if not prompt:
        return segments
    import difflib

    core = prompt.strip().rstrip("。！？，,.")
    if not core:
        return segments
    kept = []
    for s in segments:
        text = s["text"].strip()
        if text and s["start"] <= 90:
            hit = any(text.count(core[:n]) >= 2 for n in (6, 8, 10) if len(core) >= n)
            if not hit and len(text) <= len(core) * 2:
                hit = difflib.SequenceMatcher(None, text, core).ratio() > 0.6
            if hit:
                continue
        kept.append(s)
    return kept


def transcribe_one(src: Path, args, model) -> dict:
    lang = None if args.lang == "auto" else args.lang
    prompt = args.prompt
    if prompt is None and (lang in (None, "zh")):
        prompt = DEFAULT_PROMPT_ZH

    t0 = time.time()
    audio = decode_audio(src)
    segments_iter, info = model.transcribe(
        audio,
        language=lang,
        task="transcribe",
        beam_size=args.beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
        condition_on_previous_text=False,
        initial_prompt=prompt,
        hotwords=getattr(args, "hotwords", None),
        no_speech_threshold=0.6,
        temperature=[0.0, 0.2, 0.4],
    )
    log(f"[识别] 语言={info.language} (置信度 {info.language_probability:.2f})，时长 {info.duration / 60:.1f} 分钟")

    segments = []
    last_report = 0.0
    for seg in segments_iter:
        segments.append({"start": seg.start, "end": seg.end, "text": seg.text})
        now = time.time()
        if now - last_report > 2 or seg.end >= info.duration - 1:
            log(f"[{ts(seg.start, '.')[:-1]} -> {ts(seg.end, '.')[:-1]}] {seg.text.strip()}")
            last_report = now

    elapsed = time.time() - t0
    segments = _drop_prompt_echo(segments, prompt)
    speed = (info.duration / elapsed) if elapsed > 0 else 0
    log("")
    log(f"[识别完成] {src.name}：{len(segments)} 段，用时 {elapsed:.1f}s，约 {speed:.1f}x 实时")
    return {
        "src": src,
        "segments": segments,
        "language": info.language,
        "duration": info.duration,
        "elapsed": elapsed,
    }


def _unique_dir(root: Path, stem: str) -> Path:
    """同名目录已存在时追加 (2)、(3)…，不覆盖旧结果。"""
    cand = root / stem
    if not cand.exists():
        return cand
    i = 2
    while (root / f"{stem} ({i})").exists():
        i += 1
    return root / f"{stem} ({i})"


TITLE_PROMPT = (
    "根据下面的语音转写内容，起一个简洁的中文标题，概括这段内容的主题。"
    "要求：8 到 18 个字，不加引号，不加句号，不要解释，只输出标题本身。"
)


def _safe_name(s: str, limit: int = 40) -> str:
    s = re.sub(r'[\\/:*?"<>|\r\n\t]+', " ", s or "")
    s = re.sub(r"\s+", " ", s).strip(" .，。！？、；：“”\"'《》「」")
    if len(s) > limit:
        s = s[:limit].rstrip(" .，。！？、；：")
    return s


def _heuristic_title(text: str) -> str:
    """没有可用模型时，取第一句较完整的话作为标题。"""
    t = re.sub(r"\s+", "", text or "")
    for sep in "。！？!?；;":
        t = t.replace(sep, "|")
    parts = [p.strip("，,、 ") for p in t.split("|") if len(p.strip("，,、 ")) >= 6]
    if not parts:
        return t[:24]
    return max(parts[:8], key=len)[:24]


def ollama_title(text: str, model: str = OLLAMA_MODEL) -> str:
    prompt = f"{TITLE_PROMPT}\n\n内容：\n{text[:800]}\n\n标题："
    try:
        out = _ollama_generate(prompt, model, timeout=180)
    except Exception:  # noqa: BLE001
        return ""
    line = next((ln.strip() for ln in out.splitlines() if ln.strip()), "")
    return _safe_name(line.strip("\"“”'‘’《》「」 "), 30)


def title_for(segments: list[dict], polished: str | None, args) -> str:
    """按转写内容生成文件夹名；模型不可用时退回首句启发式。"""
    body = (polished or "").strip()
    if not body:
        body = "\n".join(s["text"] for s in segments[:60]).strip()
    if not body:
        return ""
    model = getattr(args, "polish_model", OLLAMA_MODEL)
    if ollama_alive(1.0) and _has_model(model):
        t = ollama_title(body, model)
        if t:
            return t
    return _safe_name(_heuristic_title(body), 30)


def write_outputs(res: dict, args, polished: str | None = None) -> list[Path]:
    src = res["src"]
    segments = res["segments"]
    root = Path(args.out_dir) if args.out_dir else OUTPUT_DIR
    root.mkdir(parents=True, exist_ok=True)
    stem = src.stem
    if getattr(args, "flat", False):
        out_dir = root
    else:
        folder = title_for(segments, polished, args) or stem
        out_dir = _unique_dir(root, folder)
        out_dir.mkdir(parents=True, exist_ok=True)
        if out_dir.name != folder:
            log(f"[输出] 已有同名结果，本次另存为「{out_dir.name}」")
        elif folder != stem:
            log(f"[输出] 文件夹按内容命名为「{folder}」")
    formats = [f.strip().lower() for f in args.format.split(",") if f.strip()]
    written = []
    if "txt" in formats:
        p = out_dir / f"{stem}.txt"
        p.write_text(build_txt(segments, args.timestamps), encoding="utf-8-sig")
        written.append(p)
    if "srt" in formats:
        p = out_dir / f"{stem}.srt"
        p.write_text(build_srt(segments), encoding="utf-8-sig")
        written.append(p)
    if "json" in formats:
        p = out_dir / f"{stem}.json"
        p.write_text(
            json.dumps(
                {"source": str(src), "language": res["language"], "duration": res["duration"], "segments": segments},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        written.append(p)
    if polished:
        p = out_dir / f"{stem}.润色.txt"
        p.write_text(polished, encoding="utf-8-sig")
        written.append(p)
    for p in written:
        log(f"[输出] {p}")
    return written


LAYOUT_MARK = ".layout-v2.done"


def migrate_flat_outputs(root: Path | None = None) -> int:
    """把旧版平铺在输出根目录的结果归入各自的子文件夹（只执行一次）。"""
    root = Path(root) if root else OUTPUT_DIR
    if not root.exists():
        return 0
    mark = root / LAYOUT_MARK
    if mark.exists():
        return 0
    groups: dict[str, list[Path]] = {}
    for f in root.iterdir():
        if not f.is_file() or f.name == LAYOUT_MARK:
            continue
        if f.name.endswith(".润色.txt"):
            base = f.name[: -len(".润色.txt")]
        elif f.suffix.lower() in (".txt", ".srt", ".json"):
            base = f.stem
        else:
            continue
        groups.setdefault(base, []).append(f)

    moved = 0
    for base, files in groups.items():
        target = _unique_dir(root, base)
        target.mkdir(parents=True, exist_ok=True)
        for f in files:
            try:
                f.rename(target / f.name)
                moved += 1
            except Exception as e:  # noqa: BLE001
                log(f"[整理] 跳过 {f.name}：{e}")
    if moved:
        log(f"[整理] 已把 {moved} 个历史结果归入 {len(groups)} 个子文件夹")
    try:
        mark.write_text("ok", encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    return moved



# ---------------- Ollama 润色 ----------------

def ollama_alive(timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=timeout) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def _tags() -> list[str]:
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        return [m.get("name", "") for m in data.get("models", [])]
    except Exception:  # noqa: BLE001
        return []


def _has_model(model: str) -> bool:
    names = _tags()
    want = model if ":" in model else f"{model}:latest"
    return want in names or model in names


def _extract_ollama() -> bool:
    """首次运行时把 ollama.zip 解压到本地目录。"""
    if OLLAMA_EXE.exists():
        return True
    zip_path = OLLAMA_DIR / "ollama.zip"
    if not zip_path.exists():
        log("[润色] 缺少本地 AI 引擎安装包，已跳过润色")
        return False
    import zipfile

    log("[润色] 首次使用，正在准备本地 AI 引擎，约需一两分钟…")
    t0 = time.time()
    OLLAMA_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        infos = z.infolist()
        total = len(infos)
        for i, info in enumerate(infos, 1):
            z.extract(info, OLLAMA_DIR)
            if i % 20 == 0 or i == total:
                log(f"[润色] 解压 {i}/{total}")
    log(f"[润色] AI 引擎就绪，用时 {time.time() - t0:.1f}s")
    return OLLAMA_EXE.exists()


def _pull_model(model: str) -> bool:
    log(f"[润色] 首次使用需要准备语言模型（约 4.7 GB），仅此一次，请保持网络连接…")
    payload = json.dumps({"model": model, "stream": True}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/pull", data=payload, headers={"Content-Type": "application/json"}
    )
    last = -10.0
    try:
        with urllib.request.urlopen(req, timeout=None) as r:
            for raw in r:
                line = raw.decode("utf-8", "ignore").strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:  # noqa: BLE001
                    continue
                if obj.get("error"):
                    log(f"[润色] 模型下载失败：{obj['error']}")
                    return False
                total = obj.get("total") or 0
                done = obj.get("completed") or 0
                if total:
                    pct = done * 100.0 / total
                    if pct - last >= 10:
                        last = pct
                        log(f"[润色] 模型下载 {pct:.0f}%（{done / 1e9:.1f} / {total / 1e9:.1f} GB）")
                elif obj.get("status"):
                    log(f"[润色] {obj['status']}")
    except Exception as e:  # noqa: BLE001
        log(f"[润色] 模型下载中断：{type(e).__name__}: {e}")
        return False
    if _has_model(model):
        log("[润色] 语言模型已就绪")
        return True
    log("[润色] 模型未完成下载")
    return False


def ensure_ollama(model: str = OLLAMA_MODEL, wait: float = 90.0) -> bool:
    """确保本地 AI 引擎可用：必要时解压、启动服务、补齐模型。"""
    if not ollama_alive():
        if not _extract_ollama():
            return False
        env = os.environ.copy()
        env["OLLAMA_MODELS"] = str(OLLAMA_DIR / "models")
        env.setdefault("OLLAMA_KEEP_ALIVE", "10m")
        (OLLAMA_DIR / "models").mkdir(parents=True, exist_ok=True)
        try:
            subprocess.Popen(
                [str(OLLAMA_EXE), "serve"],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=0x08000000 if os.name == "nt" else 0,
            )
        except Exception as e:  # noqa: BLE001
            log(f"[润色] AI 引擎启动失败：{e}")
            return False
        deadline = time.time() + wait
        while time.time() < deadline:
            if ollama_alive(1.0):
                log(f"[润色] AI 引擎已就绪")
                break
            time.sleep(1.0)
        else:
            log(f"[润色] AI 引擎启动超时，本次跳过润色")
            return False

    if not _has_model(model):
        return _pull_model(model)
    return True


def _ollama_generate(prompt: str, model: str, timeout: float = 600.0) -> str:
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.2, "num_ctx": 4096},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/generate", data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    return (data.get("response") or "").strip()


def polish_segments(segments, model: str = OLLAMA_MODEL) -> str:
    """按约 1200 字分段交给本地模型润色，返回整理后的正文。"""
    paragraphs, buf = [], ""
    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue
        buf += text if not buf else "\n" + text
        if len(buf) >= 1200:
            paragraphs.append(buf)
            buf = ""
    if buf:
        paragraphs.append(buf)

    out = []
    total = len(paragraphs)
    for i, chunk in enumerate(paragraphs, 1):
        log(f"[润色] 第 {i}/{total} 段…")
        try:
            out.append(_ollama_generate(f"{POLISH_PROMPT}\n\n原文：\n{chunk}", model))
        except Exception as e:  # noqa: BLE001
            log(f"[润色] 第 {i} 段失败：{type(e).__name__}: {e}")
            out.append(chunk)
    return "\n\n".join(out)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    parser = argparse.ArgumentParser(description="VoxScribe 本地音视频转文字（faster-whisper）")
    parser.add_argument("files", nargs="+", help="音视频文件路径，可多个")
    parser.add_argument("--model", default="large-v3", choices=["large-v3", "large-v3-turbo", "medium", "small"])
    parser.add_argument("--lang", default="zh", help="语言代码，zh/en/ja/... 或 auto")
    parser.add_argument("--format", default="txt,srt", help="输出格式，逗号分隔：txt,srt,json")
    parser.add_argument("--out-dir", default=None, help="输出目录，默认 <项目目录>/output")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    parser.add_argument("--compute-type", default="float16")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--hotwords", default=None, help="热词，如人名/专业术语，用空格分隔")
    parser.add_argument("--timestamps", action="store_true", help="txt 中带时间戳")
    parser.add_argument("--flat", action="store_true", help="结果平铺在输出目录（旧行为）；默认每个文件单独子文件夹")
    parser.add_argument("--prompt", default=None, help="initial_prompt，可提升简体与标点")
    parser.add_argument("--polish", action="store_true", help="用本地 Ollama 大模型润色文本")
    parser.add_argument("--polish-model", default=OLLAMA_MODEL, help="Ollama 模型名")
    args = parser.parse_args()

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    migrate_flat_outputs()
    sources = []
    for f in args.files:
        p = Path(f).expanduser()
        if p.is_dir():
            for ext in ("*.mp4", "*.mkv", "*.mov", "*.flv", "*.avi", "*.webm", "*.mp3", "*.wav", "*.m4a", "*.flac", "*.aac", "*.ogg"):
                sources += sorted(p.glob(ext))
        elif p.exists():
            sources.append(p)
        else:
            log(f"[跳过] 文件不存在：{p}")

    if not sources:
        log("没有可处理的音视频文件。")
        return 2

    model, dev, ct = load_model(args.model, args.device, args.compute_type)
    results = []
    for src in sources:
        log("")
        log(f"===== {src.name} =====")
        try:
            results.append(transcribe_one(src, args, model))
        except Exception as e:  # noqa: BLE001
            log(f"[失败] {src.name}：{type(e).__name__}: {e}")

    del model
    gc.collect()

    polish_ready = args.polish and ensure_ollama(args.polish_model)
    for res in results:
        polished = None
        if polish_ready:
            log(f"[润色] {res['src'].name} 交给 {args.polish_model} 整理…")
            polished = polish_segments(res["segments"], args.polish_model)
        write_outputs(res, args, polished)

    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
