from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/fitflow-feature-overview-real-ui.png"

WIDTH, HEIGHT = 2073, 759
PANEL_W = WIDTH // 4
INK = (15, 16, 20)
PAPER = (248, 246, 241)
GRID = (222, 220, 214)
CORAL = (255, 128, 108)
COBALT = (123, 115, 241)

FONT_BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"


PANELS = [
    {
        "number": "01",
        "title": "Dashboard",
        "subtitle": "See your daily rhythm\nat a glance.",
        "color": CORAL,
        "path": ROOT / "Pasted 2026-09-20 at 12.39.20 AM.png",
        "crop": (470, 0, 2110, 1313),
    },
    {
        "number": "02",
        "title": "Log a workout",
        "subtitle": "Record sets, reps, and\nprogress with ease.",
        "color": COBALT,
        "path": ROOT / "Pasted 2026-09-20 at 12.39.07 AM.png",
        "crop": (760, 250, 1800, 1318),
    },
    {
        "number": "03",
        "title": "Nutrition",
        "subtitle": "Track meals and balance\nyour daily macros.",
        "color": CORAL,
        "path": ROOT / "Screenshot 2026-09-20 at 00.39.40.png",
        "crop": (560, 0, 1990, 1318),
    },
    {
        "number": "04",
        "title": "Profile & coach",
        "subtitle": "Review progress and get\npersonal guidance.",
        "color": COBALT,
        "path": ROOT / "Screenshot 2026-09-20 at 00.39.31.png",
        "crop": (610, 0, 1960, 1318),
    },
]


def font(path, size):
    return ImageFont.truetype(path, size)


def rounded_image(image, size, radius=9):
    fitted = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.2))
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    fitted.putalpha(mask)
    return fitted


def draw_accent(draw, x, y):
    draw.line((x, y + 11, x + 19, y), fill=INK, width=4)
    draw.line((x + 6, y + 25, x + 29, y + 20), fill=INK, width=4)


def main():
    canvas = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(canvas)

    for x in range(0, WIDTH, 42):
        draw.line((x, 0, x, HEIGHT), fill=GRID, width=1)
    for y in range(0, HEIGHT, 42):
        draw.line((0, y, WIDTH, y), fill=GRID, width=1)

    number_font = font(FONT_BLACK, 30)
    title_font = font(FONT_BLACK, 43)
    subtitle_font = font(FONT_REGULAR, 23)
    status_font = font(FONT_BOLD, 11)

    for index, panel in enumerate(PANELS):
        left = index * PANEL_W
        right = WIDTH if index == 3 else left + PANEL_W
        if index:
            draw.line((left, 0, left, HEIGHT), fill=INK, width=4)

        badge = (left + 28, 17, left + 94, 80)
        draw.rounded_rectangle(badge, radius=12, fill=panel["color"], outline=INK, width=4)
        number_box = draw.textbbox((0, 0), panel["number"], font=number_font)
        number_w = number_box[2] - number_box[0]
        draw.text((left + 61 - number_w / 2, 31), panel["number"], font=number_font, fill=INK)

        title_x = left + 110
        draw.text((title_x, 14), panel["title"], font=title_font, fill=INK)
        title_bounds = draw.textbbox((title_x, 14), panel["title"], font=title_font)
        draw_accent(draw, min(title_bounds[2] + 10, right - 38), 20)
        draw.multiline_text(
            (title_x, 80), panel["subtitle"], font=subtitle_font, fill=(55, 56, 61),
            spacing=2,
        )

        frame = (left + 7, 147, right - 8, HEIGHT - 12)
        draw.rounded_rectangle(frame, radius=10, fill=(255, 255, 253), outline=INK, width=4)

        source = Image.open(panel["path"]).convert("RGB").crop(panel["crop"])
        screen_size = (frame[2] - frame[0] - 10, frame[3] - frame[1] - 10)
        screen = rounded_image(source, screen_size, radius=7)
        canvas.paste(screen, (frame[0] + 5, frame[1] + 5), screen)

        status = (left + 18, HEIGHT - 52, left + 128, HEIGHT - 20)
        draw.rounded_rectangle(status, radius=7, fill=(255, 255, 253), outline=INK, width=2)
        draw.ellipse((status[0] + 10, status[1] + 11, status[0] + 18, status[1] + 19), fill=(121, 200, 107))
        draw.text((status[0] + 24, status[1] + 9), "Real app UI", font=status_font, fill=INK)

    canvas.save(OUTPUT, quality=96)
    print(OUTPUT)


if __name__ == "__main__":
    main()
