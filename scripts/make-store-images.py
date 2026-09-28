"""ストア用スクリーンショットを Play / App Store の両方ぶん作る。

素のスクショ（assets/store/raw/<版>/）に見出し・背景・角丸を加えて、
ストアごとの大きさで assets/store/<版>/ に書き出す。素のほうは触らない。

  使い方:
      python scripts/make-store-images.py            # 最新の版（VERSION）
      python scripts/make-store-images.py 1.3.0      # 版を指定

出来上がり:
  play/     1350x2400（9:16。Play が勧める比率。1080x1920 以上の条件も満たす）
  ios-6.7/  1290x2796（iPhone 6.7 インチ。App Store で必須）
  ios-6.5/  1284x2778（iPhone 6.5 インチ）
  sheet-<ストア>.png は確認用に横に並べたもの（ストアには出さない）

見出しと元ファイルは下の SHOTS。並び順がストアでの表示順。
素のスクショは iPhone / Android どちらでもよい。上部のステータスバーは CROP_TOP で切る。
Pillow が要る（`pip install Pillow`）。

develop/store-kit/frames.py をこのアプリ向けに調整したもの。
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
VERSION = "1.3.0"

# 見出しは1行。長ければ字が自動で縮む。
# crop は素の高さに対する割合で [上, 下]。上はステータスバー（時計など）を切るため、
# 下は広告バナーなど見せたくない部分を切るため。None なら CROP_TOP_RATIO だけ切る
SHOTS = [
    ("01-playing.png", "01-playing.png", "遊技中に1タップで回転数を記録", None),
    ("02-detail.png", "02-detail.png", "回転率を自動計算", None),
    ("03-home.png", "03-home.png", "記録は一覧で管理・共有", [0.0, 0.825]),
    ("04-settings.png", "04-settings.png", "ボタンの数値は自由に設定", None),
]

SIZES = {
    "play": (1350, 2400),
    "ios-6.7": (1290, 2796),
    "ios-6.5": (1284, 2778),
}

FONT = Path(r"C:\Windows\Fonts\NotoSansJP-VF.ttf")
FONT_WEIGHT = "Black"

# アイコンの背景と同じ濃紺
BACKGROUND = "#13213A"
TEXT = "#FFFFFF"
ACCENT = "#2EA8FF"

# 素のスクショの上部（時計・電池などのステータスバー）を切る高さ。
# 素の高さに対する割合
CROP_TOP_RATIO = 0.06

CAPTION_TOP = 0.075
CAPTION_SIZE = 0.068
CAPTION_MIN = 0.046
CAPTION_MARGIN = 0.060
RULE_WIDTH = 0.140
RULE_HEIGHT = 0.007
RULE_GAP = 0.016

SHOT_WIDTH = 0.82
SHOT_TOP = 0.185
SHOT_RADIUS = 0.026


def load_font(size: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT, size)
    font.set_variation_by_name(FONT_WEIGHT)
    return font


def fitted_font(draw, text: str, max_width: int, base: int, minimum: int):
    size = base
    while size > minimum:
        font = load_font(size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 2
    return load_font(minimum)


def rounded_mask(size, radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    return mask


def build(source: Path, output: Path, caption: str, size, crop=None) -> None:
    width, height = size
    canvas = Image.new("RGB", size, BACKGROUND)
    draw = ImageDraw.Draw(canvas)

    margin = round(width * CAPTION_MARGIN)
    font = fitted_font(
        draw, caption, width - margin * 2,
        round(width * CAPTION_SIZE), round(width * CAPTION_MIN),
    )
    y = round(height * CAPTION_TOP)
    draw.text((width / 2, y), caption, font=font, fill=TEXT, anchor="ma")
    y += round(font.size * 1.2)

    rule_w = round(width * RULE_WIDTH)
    rule_h = round(width * RULE_HEIGHT)
    rule_y = y + round(height * RULE_GAP)
    draw.rounded_rectangle(
        ((width - rule_w) // 2, rule_y, (width + rule_w) // 2, rule_y + rule_h),
        radius=rule_h // 2, fill=ACCENT,
    )

    shot = Image.open(source).convert("RGB")
    top_ratio, bottom_ratio = (crop or [0.0, 1.0])
    crop_top = round(shot.height * max(top_ratio, CROP_TOP_RATIO))
    crop_bottom = round(shot.height * bottom_ratio)
    shot = shot.crop((0, crop_top, shot.width, crop_bottom))
    shot_w = round(width * SHOT_WIDTH)
    shot_h = round(shot_w * shot.height / shot.width)
    shot = shot.resize((shot_w, shot_h), Image.Resampling.LANCZOS)
    shot_x = (width - shot_w) // 2
    shot_y = round(height * SHOT_TOP)
    canvas.paste(shot, (shot_x, shot_y), rounded_mask(shot.size, round(width * SHOT_RADIUS)))

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, format="PNG", optimize=True)


def make_sheet(paths, output: Path) -> None:
    thumb_w, gap = 280, 20
    thumbs = []
    for path in paths:
        image = Image.open(path).convert("RGB")
        thumbs.append(image.resize((thumb_w, round(thumb_w * image.height / image.width)), Image.Resampling.LANCZOS))
    sheet = Image.new("RGB", (gap + len(thumbs) * (thumb_w + gap), gap * 2 + max(t.height for t in thumbs)), "#F0F0F3")
    x = gap
    for t in thumbs:
        sheet.paste(t, (x, gap))
        x += thumb_w + gap
    sheet.save(output, format="PNG", optimize=True)


def main() -> None:
    version = sys.argv[1] if len(sys.argv) > 1 else VERSION
    raw = ROOT / "assets" / "store" / "raw" / version
    out_root = ROOT / "assets" / "store" / version
    for store, size in SIZES.items():
        outputs = []
        for source_name, output_name, caption, crop in SHOTS:
            source = raw / source_name
            if not source.exists():
                raise FileNotFoundError(f"元画像がありません: {source}")
            output = out_root / store / output_name
            build(source, output, caption, size, crop)
            outputs.append(output)
        make_sheet(outputs, out_root / f"sheet-{store}.png")
        print(f"{store}: {len(outputs)} 枚 ({size[0]}x{size[1]}) -> {out_root / store}")


if __name__ == "__main__":
    main()
