# Generates build/icon.icns (FrameDL): viewfinder frame + download arrow.
import subprocess, shutil, os
from PIL import Image, ImageDraw, ImageFilter

S = 4096  # supersample, downscaled to 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# macOS-style squircle-ish rounded square with gradient
m = int(S * 0.098)
box = (m, m, S - m, S - m)
grad = Image.new("RGBA", (S, S))
gp = grad.load()
c1, c2 = (88, 56, 232), (14, 190, 200)  # indigo -> teal
for y in range(S):
    for x in range(S):
        t = (x * 0.35 + y * 0.65) / S
        gp[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=int(S * 0.225), fill=255)
img.paste(grad, (0, 0), mask)

# shadow layer for glyphs
glyph = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(glyph)
W = (255, 255, 255, 255)
t = int(S * 0.045)           # stroke
L, R = int(S * 0.27), int(S * 0.73)
T, B = int(S * 0.27), int(S * 0.73)
a = int(S * 0.13)            # bracket arm length
def corner(x, y, dx, dy):
    d.rounded_rectangle((min(x, x + dx * a), y - t // 2 if dy else y, max(x, x + dx * a), y + t // 2), radius=t // 2, fill=W) if False else None
for (x, y, dx, dy) in [(L, T, 1, 1), (R, T, -1, 1), (L, B, 1, -1), (R, B, -1, -1)]:
    # horizontal arm
    x0, x1 = sorted((x, x + dx * a))
    d.rounded_rectangle((x0 - t // 2, y - t // 2, x1 + t // 2, y + t // 2), radius=t // 2, fill=W)
    # vertical arm
    y0, y1 = sorted((y, y + dy * a))
    d.rounded_rectangle((x - t // 2, y0 - t // 2, x + t // 2, y1 + t // 2), radius=t // 2, fill=W)

# download arrow
cx = S // 2
shaft_w = int(S * 0.07)
top, tip = int(S * 0.34), int(S * 0.60)
d.rounded_rectangle((cx - shaft_w // 2, top, cx + shaft_w // 2, int(S * 0.52)), radius=shaft_w // 2, fill=W)
hw = int(S * 0.115)
d.polygon([(cx - hw, int(S * 0.465)), (cx + hw, int(S * 0.465)), (cx, tip)], fill=W)
d.rounded_rectangle((cx - int(S * 0.13), int(S * 0.655) - t // 2, cx + int(S * 0.13), int(S * 0.655) + t // 2), radius=t // 2, fill=W)

sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sh.paste((10, 10, 60, 90), (0, int(S * 0.012)), glyph.split()[3])
sh = sh.filter(ImageFilter.GaussianBlur(S * 0.012))
img = Image.alpha_composite(img, sh)
img = Image.alpha_composite(img, glyph)

base = img.resize((1024, 1024), Image.LANCZOS)
os.makedirs("build", exist_ok=True)
base.save("build/icon.png")
iset = "build/icon.iconset"
shutil.rmtree(iset, ignore_errors=True); os.makedirs(iset)
for sz in (16, 32, 128, 256, 512):
    base.resize((sz, sz), Image.LANCZOS).save(f"{iset}/icon_{sz}x{sz}.png")
    base.resize((sz * 2, sz * 2), Image.LANCZOS).save(f"{iset}/icon_{sz}x{sz}@2x.png")
subprocess.run(["iconutil", "-c", "icns", iset, "-o", "build/icon.icns"], check=True)
shutil.rmtree(iset)
