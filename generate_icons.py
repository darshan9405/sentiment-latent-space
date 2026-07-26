from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 48, 128]
OUT = "src/icons"

if not os.path.exists(OUT):
    os.makedirs(OUT)

for size in SIZES:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded background
    pad = max(1, size // 16)
    draw.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=size // 6,
        fill=(30, 41, 59, 255),
        outline=(59, 130, 246, 255),
        width=max(1, size // 48),
    )

    # Diamond shape
    cx, cy = size // 2, size // 2
    diamond_size = size * 0.35
    points = [
        (cx, cy - diamond_size),
        (cx + diamond_size, cy),
        (cx, cy + diamond_size),
        (cx - diamond_size, cy),
    ]
    draw.polygon(points, fill=(59, 130, 246, 255))

    # Letter S
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size // 3)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "S", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.text(
        (cx - text_w / 2, cy - text_h / 2 - text_h * 0.1),
        "S",
        font=font,
        fill=(255, 255, 255, 255),
    )

    img.save(os.path.join(OUT, f"icon{size}.png"))
    print(f"Generated icon{size}.png")
