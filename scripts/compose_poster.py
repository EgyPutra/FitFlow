from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "public/assets/fitflow-promo-hero.png"
DASHBOARD = ROOT / "Pasted 2026-09-20 at 12.39.20 AM.png"
WORKOUT = ROOT / "Pasted 2026-09-20 at 12.39.07 AM.png"
OUTPUT = ROOT / "public/assets/fitflow-promo-hero-real-ui.png"


def rounded_paste(base, source, box, radius, shadow=False):
    x, y, width, height = box
    fitted = source.resize((width, height), Image.Resampling.LANCZOS)

    if shadow:
        shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        shadow_mask = Image.new("L", (width, height), 0)
        ImageDraw.Draw(shadow_mask).rounded_rectangle(
            (0, 0, width - 1, height - 1), radius=radius, fill=190
        )
        shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(12))
        shadow_layer.paste((15, 18, 28, 110), (x + 7, y + 12), shadow_mask)
        base.alpha_composite(shadow_layer)

    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, width - 1, height - 1), radius=radius, fill=255
    )
    base.paste(fitted, (x, y), mask)


def main():
    base = Image.open(BASE).convert("RGBA")
    dashboard = Image.open(DASHBOARD).convert("RGB")
    workout = Image.open(WORKOUT).convert("RGB")

    # Keep the actual web pixels. Crop only the browser's wide empty margins and
    # lower overflow so the real dashboard reads clearly inside the laptop.
    dashboard_crop = dashboard.crop((430, 0, 2080, 1290))
    rounded_paste(base, dashboard_crop, (578, 145, 818, 640), radius=18)

    # Isolate the real workout sheet tightly so its fields remain readable.
    workout_crop = workout.crop((1005, 600, 1560, 1318))
    rounded_paste(base, workout_crop, (1240, 228, 386, 578), radius=15, shadow=True)

    # Crisp outline reconnects the screenshot with the poster's comic framing.
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle(
        (1231, 221, 1631, 811), radius=18, outline=(12, 14, 20, 255), width=5
    )

    base.convert("RGB").save(OUTPUT, quality=96)
    print(OUTPUT)


if __name__ == "__main__":
    main()
