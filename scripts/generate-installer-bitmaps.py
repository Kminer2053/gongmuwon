"""NSIS 설치 프로그램용 브랜드 비트맵 생성.

- sidebar.bmp : 164x314 — 환영/마침 페이지 좌측 사이드바
- header.bmp  : 150x57  — 설치 진행 페이지 우측 상단 헤더

브랜드: '공무원' (로컬 AI에이전트 워크플레이스). 로고는 손그림 대신
실제 앱 아이콘(src-tauri/icons/128x128.png)을 합성한다.
실행: node scripts/portable-run.mjs python scripts/generate-installer-bitmaps.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TAURI_ROOT = Path(__file__).resolve().parent.parent / "apps" / "desktop" / "src-tauri"
OUT_DIR = TAURI_ROOT / "nsis"
APP_ICON = TAURI_ROOT / "icons" / "128x128.png"

PANEL = (246, 248, 245)
INK = (43, 47, 42)
GREEN = (61, 122, 79)
SOFT = (183, 192, 182)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "malgunbd.ttf" if bold else "malgun.ttf"
    try:
        return ImageFont.truetype(rf"C:\Windows\Fonts\{name}", size)
    except OSError:
        return ImageFont.load_default()


def _app_icon(size: int) -> Image.Image:
    icon = Image.open(APP_ICON).convert("RGBA")
    return icon.resize((size, size), Image.LANCZOS)


def make_sidebar() -> None:
    img = Image.new("RGB", (164, 314), PANEL)
    d = ImageDraw.Draw(img)
    # 실제 앱 아이콘
    icon = _app_icon(72)
    img.paste(icon, (20, 24), icon)
    # 앱 이름
    d.text((20, 108), "공무원", font=_font(28, bold=True), fill=INK)
    d.text((20, 144), "로컬 AI에이전트", font=_font(13), fill=INK)
    d.text((20, 162), "워크플레이스", font=_font(13), fill=INK)
    d.line([20, 188, 144, 188], fill=SOFT, width=1)
    # 특징 3줄 (체크 + 문구)
    feats = ["로컬 우선 실행", "폐쇄망 안심", "HWPX 문서작성"]
    y = 202
    for label in feats:
        d.line([22, y + 7, 27, y + 12], fill=GREEN, width=2)
        d.line([27, y + 12, 36, y + 2], fill=GREEN, width=2)
        d.text((42, y - 2), label, font=_font(12), fill=INK)
        y += 28
    out = OUT_DIR / "sidebar.bmp"
    img.save(out, format="BMP")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


def make_header() -> None:
    img = Image.new("RGB", (150, 57), PANEL)
    d = ImageDraw.Draw(img)
    icon = _app_icon(36)
    img.paste(icon, (8, 10), icon)
    d.text((52, 10), "공무원", font=_font(17, bold=True), fill=INK)
    d.text((52, 34), "AI 워크플레이스", font=_font(10), fill=INK)
    out = OUT_DIR / "header.bmp"
    img.save(out, format="BMP")
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_sidebar()
    make_header()
