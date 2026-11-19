"""打包 VoxScribe 为独立 exe（onedir），输出到 release\\VoxScribe\\。"""
from pathlib import Path

from PyInstaller.__main__ import run

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "release"
WORK = ROOT / "_buildwork"
ASSETS = ROOT / "assets"
APP = ROOT / "app"

args = [
    str(APP / "voxscribe_gui.py"),
    "--name", "VoxScribe",
    "--noconfirm",
    "--clean",
    "--windowed",
    "--icon", str(ASSETS / "icon.ico"),
    "--paths", str(APP),
    "--add-data", f"{ASSETS / 'icon.ico'};.",
    "--collect-all", "tkinterdnd2",
    "--collect-all", "faster_whisper",
    "--collect-all", "ctranslate2",
    "--collect-all", "av",
    "--collect-all", "onnxruntime",
    "--exclude-module", "torch",
    "--exclude-module", "torchaudio",
    "--exclude-module", "matplotlib",
    "--exclude-module", "scipy",
    "--exclude-module", "pandas",
    "--exclude-module", "IPython",
    "--distpath", str(OUT),
    "--workpath", str(WORK),
    "--specpath", str(WORK),
]
run(args)
print("BUILD DONE")
