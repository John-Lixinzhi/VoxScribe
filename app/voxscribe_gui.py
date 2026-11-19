#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""VoxScribe 图形界面：拖放音视频 -> 本地转文字（可选 Ollama 润色）。"""
from __future__ import annotations

import os
import queue
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

_BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BASE / "app"))
sys.path.insert(0, str(_BASE / "app" / "vendor"))
import voxscribe as core  # noqa: E402

ROOT = core.ROOT

try:  # 拖放依赖，缺失时退化为文件选择
    from tkinterdnd2 import COPY, DND_FILES, TkinterDnD

    class BaseTk(TkinterDnD.Tk):
        pass

    HAS_DND = True
except Exception:  # noqa: BLE001
    COPY = "copy"  # type: ignore[assignment]
    BaseTk = tk.Tk  # type: ignore[misc,assignment]
    HAS_DND = False

BG = "#111318"
PANEL = "#1a1d25"
CARD = "#22262f"
FG = "#e8eaf0"
MUTED = "#9aa3b2"
ACCENT = "#4f8cff"
ACCENT_DARK = "#3c6fd1"
OK = "#5ad19a"

MEDIA_TYPES = [
    ("音视频文件", "*.mp4 *.mkv *.mov *.avi *.flv *.webm *.mp3 *.wav *.m4a *.flac *.aac *.ogg"),
    ("所有文件", "*.*"),
]

LANG_MAP = {"简体中文": "zh", "自动检测": "auto", "英文": "en", "日文": "ja"}
MODEL_MAP = {
    "Large v3 · 精度优先": "large-v3",
    "Large v3 Turbo · 速度优先": "large-v3-turbo",
    "Medium · 均衡": "medium",
    "Small · 轻量": "small",
}


class App(BaseTk):
    def __init__(self) -> None:
        self._dnd_ok = False
        try:
            BaseTk.__init__(self)
            self._dnd_ok = HAS_DND
        except Exception as e:  # noqa: BLE001
            # tkdnd 扩展加载失败时仍提供窗口，仅退化为按钮选择文件
            self._dnd_ok = False
            if not getattr(self, "tk", None):
                tk.Tk.__init__(self)
            self._early_error = f"DND init failed: {type(e).__name__}: {e}"
        self.report_callback_exception = self._on_tk_error
        self.title("VoxScribe · 本地音视频转文字")
        self.geometry("880x680")
        self.minsize(760, 600)
        self.configure(bg=BG)
        self.files: list[Path] = []
        self.q: queue.Queue = queue.Queue()
        self.worker: threading.Thread | None = None
        self._build_style()
        self._build_ui()
        self._set_icon()
        self._bind_dnd()
        self._audit(
            "GUI start dnd={} tkdnd={}".format(
                self._dnd_ok, getattr(self, "TkdndVersion", None)
            )
        )
        self.after(120, self._drain)

    def _on_tk_error(self, exc, val, tb) -> None:
        """任何界面回调异常都落盘，避免窗口无提示消失。"""
        import traceback

        text = "".join(traceback.format_exception(exc, val, tb))
        self._audit("UI ERROR " + text.replace("\n", " | "))
        try:
            messagebox.showerror("操作失败", f"{val}")
        except Exception:  # noqa: BLE001
            pass

    def _set_icon(self) -> None:
        """窗口与任务栏使用项目图标，避免显示 Python 默认图标。"""
        cands = []
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            cands.append(Path(meipass) / "icon.ico")
        cands.append(ROOT / "assets" / "icon.ico")
        for p in cands:
            if p.exists():
                try:
                    self.iconbitmap(default=str(p))
                    return
                except Exception:  # noqa: BLE001
                    continue

    # ---------- 外观 ----------
    def _build_style(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=FG, font=("Microsoft YaHei UI", 10))
        style.configure("Panel.TFrame", background=PANEL)
        style.configure("TLabel", background=PANEL, foreground=FG)
        style.configure("Muted.TLabel", background=PANEL, foreground=MUTED, font=("Microsoft YaHei UI", 9))
        style.configure("Title.TLabel", background=BG, foreground=FG, font=("Microsoft YaHei UI", 18, "bold"))
        style.configure("Sub.TLabel", background=BG, foreground=MUTED, font=("Microsoft YaHei UI", 9))
        style.configure("TButton", background=CARD, foreground=FG, borderwidth=0, padding=(14, 7))
        style.map("TButton", background=[("active", "#2c3140")])
        style.configure("Accent.TButton", background=ACCENT, foreground="#ffffff", font=("Microsoft YaHei UI", 10, "bold"))
        style.map("Accent.TButton", background=[("active", ACCENT_DARK), ("disabled", "#39404f")])
        style.configure("TCombobox", fieldbackground=CARD, background=CARD, foreground=FG, arrowcolor=FG)
        style.map("TCombobox", fieldbackground=[("readonly", CARD)], foreground=[("readonly", FG)])
        style.configure("Horizontal.TProgressbar", background=ACCENT, troughcolor=CARD, borderwidth=0)
        style.configure("TCheckbutton", background=PANEL, foreground=FG, focuscolor=PANEL)
        style.map("TCheckbutton", background=[("active", PANEL)])

    def _build_ui(self) -> None:
        head = tk.Frame(self, bg=BG)
        head.pack(fill="x", padx=24, pady=(20, 8))
        ttk.Label(head, text="VoxScribe", style="Title.TLabel").pack(side="left")
        ttk.Label(head, text="   本地离线 · 音视频转文字", style="Sub.TLabel").pack(side="left", pady=(8, 0))

        body = tk.Frame(self, bg=PANEL, highlightthickness=1, highlightbackground="#2b303c")
        body.pack(fill="both", expand=True, padx=24, pady=8)

        top = tk.Frame(body, bg=PANEL)
        top.pack(fill="x", padx=16, pady=(14, 4))
        ttk.Label(top, text="待转写文件").pack(side="left")
        ttk.Label(top, text="   拖放添加 · 支持批量与文件夹", style="Muted.TLabel").pack(side="left")
        self.btn_clear = ttk.Button(top, text="清空", command=self._clear)
        self.btn_clear.pack(side="right", padx=(8, 0))
        self.btn_add = ttk.Button(top, text="添加文件", command=self._add_files)
        self.btn_add.pack(side="right")

        list_wrap = tk.Frame(body, bg=BG)
        list_wrap.pack(fill="both", expand=True, padx=16, pady=(6, 10))
        self.listbox = tk.Listbox(
            list_wrap, bg=BG, fg=FG, selectbackground=ACCENT, selectforeground="#fff",
            borderwidth=0, highlightthickness=1, highlightbackground="#2b303c",
            font=("Microsoft YaHei UI", 9), activestyle="none",
        )
        self.listbox.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(list_wrap, orient="vertical", command=self.listbox.yview)
        sb.pack(side="right", fill="y")
        self.listbox.configure(yscrollcommand=sb.set)
        self.listbox.bind("<Double-Button-1>", lambda e: self._open_output())
        if self._dnd_ok:
            try:
                self.listbox.drop_target_register(DND_FILES)
                self.listbox.dnd_bind("<<Drop>>", self._on_drop)
            except Exception as e:  # noqa: BLE001
                self._audit(f"listbox DND failed: {type(e).__name__}: {e}")

        opts = tk.Frame(body, bg=PANEL)
        opts.pack(fill="x", padx=16, pady=(0, 8))
        ttk.Label(opts, text="模型").grid(row=0, column=0, sticky="w")
        self.model_var = tk.StringVar(value=list(MODEL_MAP)[0])
        ttk.Combobox(opts, textvariable=self.model_var, values=list(MODEL_MAP), state="readonly", width=24).grid(
            row=0, column=1, padx=(8, 22), sticky="w"
        )
        ttk.Label(opts, text="语言").grid(row=0, column=2, sticky="w")
        self.lang_var = tk.StringVar(value="简体中文")
        ttk.Combobox(opts, textvariable=self.lang_var, values=list(LANG_MAP), state="readonly", width=10).grid(
            row=0, column=3, padx=(8, 22), sticky="w"
        )
        ttk.Label(opts, text="输出").grid(row=0, column=4, sticky="w")
        self.fmt_var = tk.StringVar(value="文本 + 字幕")
        ttk.Combobox(
            opts, textvariable=self.fmt_var, state="readonly", width=14,
            values=["文本 + 字幕", "仅文本", "仅字幕"],
        ).grid(row=0, column=5, padx=(8, 0), sticky="w")

        polish_row = tk.Frame(body, bg=PANEL)
        polish_row.pack(fill="x", padx=16, pady=(0, 10))
        self.polish_var = tk.BooleanVar(value=True)
        self.chk_box = tk.Label(
            polish_row, text="✓", width=2, height=1, bg=ACCENT, fg="#ffffff",
            font=("Microsoft YaHei UI", 10, "bold"), cursor="hand2",
        )
        self.chk_box.pack(side="left")
        self.chk_text = tk.Label(
            polish_row, text=" AI 润色", bg=PANEL, fg=FG,
            font=("Microsoft YaHei UI", 10), cursor="hand2",
        )
        self.chk_text.pack(side="left")
        tk.Label(
            polish_row, text="本地 AI 校正错别字并整理标点", bg=PANEL, fg=MUTED,
            font=("Microsoft YaHei UI", 9),
        ).pack(side="left", padx=(14, 0))
        self.chk_box.bind("<Button-1>", lambda e: self._toggle_polish())
        self.chk_text.bind("<Button-1>", lambda e: self._toggle_polish())

        actions = tk.Frame(body, bg=PANEL)
        actions.pack(fill="x", padx=16, pady=(2, 14))
        self.btn_start = ttk.Button(actions, text="开始转写", style="Accent.TButton", command=self._start)
        self.btn_start.pack(side="left")
        self.btn_out = ttk.Button(actions, text="打开输出文件夹", command=self._open_output)
        self.btn_out.pack(side="left", padx=8)
        self.progress = ttk.Progressbar(actions, mode="indeterminate", length=180)
        self.progress.pack(side="right")
        self.status = ttk.Label(actions, text="就绪", style="Muted.TLabel")
        self.status.pack(side="right", padx=12)

        logwrap = tk.Frame(self, bg=BG)
        logwrap.pack(fill="both", expand=False, padx=24, pady=(4, 16))
        ttk.Label(logwrap, text="运行日志", style="Sub.TLabel").pack(anchor="w", pady=(0, 4))
        self.logbox = tk.Text(
            logwrap, height=11, bg="#0c0e12", fg="#c9d1e0", insertbackground=FG, borderwidth=0,
            highlightthickness=1, highlightbackground="#2b303c", font=("Consolas", 9), wrap="word",
        )
        self.logbox.pack(fill="both", expand=True)
        self.logbox.configure(state="disabled")

    def _toggle_polish(self) -> None:
        on = not self.polish_var.get()
        self.polish_var.set(on)
        self.chk_box.configure(
            text="✓" if on else "", bg=ACCENT if on else CARD,
            fg="#ffffff" if on else MUTED,
        )

    # ---------- 拖放 ----------
    def _bind_dnd(self) -> None:
        if not self._dnd_ok:
            return
        try:
            self.drop_target_register(DND_FILES)
            self.dnd_bind("<<Drop>>", self._on_drop)
        except Exception as e:  # noqa: BLE001
            self._audit(f"DND bind failed: {type(e).__name__}: {e}")

    def _on_drop(self, event):
        try:
            raw = getattr(event, "data", "") or ""
            paths = list(self.tk.splitlist(raw)) if raw else []
            self._add_paths(paths)
        except Exception as e:  # noqa: BLE001
            self._audit(f"DROP failed: {type(e).__name__}: {e}")
        return COPY if self._dnd_ok else "copy"

    # ---------- 文件列表 ----------
    def _add_files(self) -> None:
        paths = filedialog.askopenfilenames(title="选择音视频文件", filetypes=MEDIA_TYPES)
        self._add_paths(paths)

    def _add_paths(self, paths) -> None:
        added = 0
        for raw in paths:
            path = Path(str(raw))
            candidates = []
            if path.is_dir():
                for ext in ("*.mp4", "*.mkv", "*.mov", "*.avi", "*.flv", "*.webm", "*.mp3", "*.wav", "*.m4a", "*.flac", "*.aac", "*.ogg"):
                    candidates += sorted(path.glob(ext))
            elif path.is_file():
                candidates = [path]
            for c in candidates:
                if c not in self.files:
                    self.files.append(c)
                    self.listbox.insert("end", f"{c.name}    ·    {c.parent}")
                    added += 1
        if added:
            self.status.configure(text=f"已添加 {added} 个文件")
        self._audit(f"ADD {added} file(s): " + " | ".join(str(p) for p in paths))

    def _audit(self, msg: str) -> None:
        try:
            (ROOT / "logs").mkdir(parents=True, exist_ok=True)
            with open(ROOT / "logs" / "app.log", "a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
        except Exception:  # noqa: BLE001
            pass

    def _clear(self) -> None:
        self.files.clear()
        self.listbox.delete(0, "end")

    def _open_output(self) -> None:
        core.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(core.OUTPUT_DIR)  # noqa: S606

    # ---------- 运行 ----------
    def _append(self, text: str) -> None:
        self.logbox.configure(state="normal")
        self.logbox.insert("end", text + "\n")
        self.logbox.see("end")
        self.logbox.configure(state="disabled")

    def _drain(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "log":
                    self._append(payload)
                elif kind == "status":
                    self.status.configure(text=payload)
                elif kind == "done":
                    self.progress.stop()
                    self.btn_start.state(["!disabled"])
                    self.btn_add.state(["!disabled"])
                elif kind == "error":
                    self.progress.stop()
                    self.btn_start.state(["!disabled"])
                    self.btn_add.state(["!disabled"])
                    messagebox.showerror("转写失败", payload)
        except queue.Empty:
            pass
        self.after(120, self._drain)

    def _start(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        if not self.files:
            messagebox.showinfo("提示", "请先添加要转写的音视频文件。")
            return
        self.btn_start.state(["disabled"])
        self.btn_add.state(["disabled"])
        self.progress.start(12)
        self.q.put(("status", "加载模型中…"))
        files = list(self.files)
        model_name = MODEL_MAP[self.model_var.get()]
        lang = LANG_MAP[self.lang_var.get()]
        fmt = {"文本 + 字幕": "txt,srt", "仅文本": "txt", "仅字幕": "srt"}[self.fmt_var.get()]
        polish = self.polish_var.get()
        self.worker = threading.Thread(target=self._run, args=(files, model_name, lang, fmt, polish), daemon=True)
        self.worker.start()

    def _run(self, files: list[Path], model_name: str, lang: str, fmt: str, polish: bool) -> None:
        try:
            core.log = lambda m: self.q.put(("log", m))  # type: ignore[assignment]
            model, dev, ct = core.load_model(model_name, "auto", "float16")
            args = SimpleNamespace(
                lang=lang, prompt=None, beam_size=5, out_dir=None, format=fmt,
                timestamps=False, hotwords=None,
            )
            total = len(files)
            results = []
            for i, src in enumerate(files, 1):
                self.q.put(("status", f"正在转写 {i}/{total}：{src.name}"))
                self.q.put(("log", f"\n===== {src.name} ====="))
                results.append(core.transcribe_one(src, args, model))

            del model
            import gc

            gc.collect()

            polish_ready = polish and core.ensure_ollama()
            for res in results:
                text = None
                if polish_ready:
                    self.q.put(("status", f"AI 润色：{res['src'].name}"))
                    text = core.polish_segments(res["segments"])
                core.write_outputs(res, args, text)
            self.q.put(("status", "全部完成"))
        except Exception as e:  # noqa: BLE001
            self.q.put(("error", f"{type(e).__name__}: {e}"))
        finally:
            self.q.put(("done", ""))


def _selftest() -> int:
    """打包后的自检入口，用于确认依赖与模型能否加载（无窗口）。"""
    try:
        core.ensure_cuda_path()
        import av  # noqa: F401
        import ctranslate2  # noqa: F401
        import faster_whisper  # noqa: F401
        import numpy  # noqa: F401
        import tkinterdnd2  # noqa: F401
        model, dev, ct = core.load_model("large-v3-turbo", "auto", None)
        del model
        print(f"SELFTEST OK {dev}/{ct}")
        return 0
    except Exception as e:  # noqa: BLE001
        print(f"SELFTEST FAIL {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    core.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    core.migrate_flat_outputs()
    app = App()
    dropped = [a for a in sys.argv[1:] if Path(a).exists()]
    if dropped:
        app._add_paths(dropped)
    app.mainloop()
