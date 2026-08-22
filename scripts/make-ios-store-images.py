"""App Store用のiPhoneスクリーンショットを作る。

develop/store-kit/frames.pyをパチカウントのiOS素材向けに調整したもの。
元画像は変更せず、見出し・背景・角丸を加えた1284x2778のRGB PNGを作る。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "store" / "ios" / "original" / "1.2.0"
OUTPUT = ROOT / "assets" / "store" / "ios" / "1.2.0"

SIZE = (1284, 2778)
FONT = Path(r"C:\Windows\Fonts\NotoSansJP-VF.ttf")
FONT_WEIGHT = "Black"

BACKGROUND = "#13213A"
TEXT = "#FFFFFF"
ACCENT = "#2EA8FF"

SHOTS = [
    ("IMG_0023.PNG", "ios-01-auto.png", "回転数と玉数から\n回転率を自動計算"),
    ("IMG_0024.PNG", "ios-02-history.png", "記録した回転率を\nひと目で確認"),
    ("IMG_0025.PNG", "ios-03-detail.png", "遊技データを\n詳しく振り返る"),
    ("IMG_0026.PNG", "ios-04-settings.png", "よく使う数値を\nボタンに設定"),
]

# 実機画像のステータスバーとTestFlightの戻り表示を除く。
CROP_TOP = 140

CAPTION_TOP = 0.068
CAPTION_SIZE = 0.075
CAPTION_MIN = 0.052
CAPTION_MARGIN = 0.070
LINE_GAP = 1.30

RULE_WIDTH = 0.140
RULE_HEIGHT = 0.007
RULE_GAP = 0.012

SHOT_WIDTH = 0.82
SHOT_TOP = 0.205
SHOT_RADIUS = 0.026


def load_font(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT, size)
    font.set_variation_by_name(FONT_WEIGHT)
    return font


def fitted_font(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    max_width: int,
    base_size: int,
    minimum_size: int,
) -> ImageFont.FreeTypeFont:
    size = base_size
    while size > minimum_size:
        font = load_font(size)
        if max(draw.textlength(line, font=font) for line in lines) <= max_width:
            return font
        size -= 2
    return load_font(minimum_size)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    return mask


def build(source: Path, output: Path, caption: str) -> None:
    width, height = SIZE
    canvas = Image.new("RGB", SIZE, BACKGROUND)
    draw = ImageDraw.Draw(canvas)

    lines = caption.split("\n")
    margin = round(width * CAPTION_MARGIN)
    font = fitted_font(
        draw,
        lines,
        width - margin * 2,
        round(width * CAPTION_SIZE),
        round(width * CAPTION_MIN),
    )
    line_height = round(font.size * LINE_GAP)
    y = round(height * CAPTION_TOP)
    for line in lines:
        draw.text((width / 2, y), line, font=font, fill=TEXT, anchor="ma")
        y += line_height

    rule_width = round(width * RULE_WIDTH)
    rule_height = round(width * RULE_HEIGHT)
    rule_y = y + round(height * RULE_GAP)
    draw.rounded_rectangle(
        (
            (width - rule_width) // 2,
            rule_y,
            (width + rule_width) // 2,
            rule_y + rule_height,
        ),
        radius=rule_height // 2,
        fill=ACCENT,
    )

    screenshot = Image.open(source).convert("RGB")
    screenshot = screenshot.crop((0, CROP_TOP, screenshot.width, screenshot.height))
    screenshot_width = round(width * SHOT_WIDTH)
    screenshot_height = round(screenshot_width * screenshot.height / screenshot.width)
    screenshot = screenshot.resize(
        (screenshot_width, screenshot_height), Image.Resampling.LANCZOS
    )
    screenshot_x = (width - screenshot_width) // 2
    screenshot_y = round(height * SHOT_TOP)
    canvas.paste(
        screenshot,
        (screenshot_x, screenshot_y),
        rounded_mask(screenshot.size, round(width * SHOT_RADIUS)),
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=True)


def make_sheet(paths: list[Path]) -> None:
    thumbnail_width = 280
    gap = 20
    thumbnails = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        thumbnail_height = round(thumbnail_width * image.height / image.width)
        thumbnails.append(
            image.resize(
                (thumbnail_width, thumbnail_height), Image.Resampling.LANCZOS
            )
        )

    sheet_width = gap + len(thumbnails) * (thumbnail_width + gap)
    sheet_height = gap * 2 + max(image.height for image in thumbnails)
    sheet = Image.new("RGB", (sheet_width, sheet_height), "#F0F0F3")
    x = gap
    for image in thumbnails:
        sheet.paste(image, (x, gap))
        x += thumbnail_width + gap
    sheet.save(OUTPUT / "sheet-ios.png", format="PNG", optimize=True)


def main() -> None:
    outputs = []
    for source_name, output_name, caption in SHOTS:
        source = RAW / source_name
        if not source.exists():
            raise FileNotFoundError(f"元画像がありません: {source}")
        output = OUTPUT / output_name
        build(source, output, caption)
        outputs.append(output)
        print(f"{source_name} -> {output_name} ({SIZE[0]}x{SIZE[1]})")
    make_sheet(outputs)
    print(f"できた: {OUTPUT}")


if __name__ == "__main__":
    main()
