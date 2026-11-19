"""生成 VoxScribe 应用图标（多尺寸 ico），供 exe 与窗口共用。"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)
SIZE = 256
SS = 4  # 超采样倍数

img = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底板 + 上浅下深的蓝色渐变
radius = int(SIZE * SS * 0.22)
grad = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
top = (86, 148, 255)
bottom = (48, 92, 190)
for y in range(SIZE * SS):
    t = y / (SIZE * SS - 1)
    gd.line(
        [(0, y), (SIZE * SS, y)],
        fill=(
            int(top[0] + (bottom[0] - top[0]) * t),
            int(top[1] + (bottom[1] - top[1]) * t),
            int(top[2] + (bottom[2] - top[2]) * t),
            255,
        ),
    )
mask = Image.new("L", (SIZE * SS, SIZE * SS), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE * SS - 1, SIZE * SS - 1], radius=radius, fill=255)
img.alpha_composite(Image.composite(grad, Image.new("RGBA", grad.size, (0, 0, 0, 0)), mask))

# 白色声波竖条，简洁且在小尺寸下可辨认
bars = [0.30, 0.52, 0.74, 0.52, 0.30]
bw = int(SIZE * SS * 0.075)
gap = int(SIZE * SS * 0.052)
total = len(bars) * bw + (len(bars) - 1) * gap
x0 = (SIZE * SS - total) // 2
cy = SIZE * SS // 2
for i, h in enumerate(bars):
    bh = int(SIZE * SS * h)
    x = x0 + i * (bw + gap)
    d.rounded_rectangle(
        [x, cy - bh // 2, x + bw, cy + bh // 2],
        radius=bw // 2,
        fill=(255, 255, 255, 255),
    )

ico_path = OUT_DIR / "icon.ico"
img.resize((SIZE, SIZE), Image.LANCZOS).save(
    ico_path,
    format="ICO",
    sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
)
print("saved", ico_path, ico_path.stat().st_size, "bytes")
