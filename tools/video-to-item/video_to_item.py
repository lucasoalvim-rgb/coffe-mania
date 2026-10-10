"""Turns a video of one character on a light background into an animated room item.

    python tools/video-to-item/video_to_item.py VIDEO.mp4 --classname young_wizard \
        --id 3400001 --name "Pequeno Bruxo" --price 800

Needs ffmpeg on PATH (or --ffmpeg), numpy and scipy.

What it does
- Reads every frame of the video and finds the foreground of each: pixels that differ from
  the background (the median of the frame border) and belong to a large connected piece,
  which also drops the watermark. Light areas of the art that are fully enclosed (highlights,
  pale cheeks) stay; enclosed holes that look like background (the lenses of glasses, gaps
  between wings) are cut.
- Cleans the edge without touching the inside: the outer 2 px, which mix the art with the
  white of the video, take the color of the nearest inner pixel, and the alpha is a small
  blur of the mask pulled 1 px inward, so no white fringe is left.
- Finds the two frames that look most alike (the body and the props around it, such as a
  flying ball, each scored on its own) and loops between them. The body's last --crossfade
  frames dissolve into the ones just before the start, so the end flows into the beginning
  without a jump; fast props are left undissolved to avoid ghost copies. The loop is then
  sampled at --fps.
- Crops every frame to the same box (so the animation keeps its position), scales it with
  premultiplied alpha at --resolution times the room size, and packs the frames in one sprite
  sheet with a transparent gutter so mipmaps never bleed one frame into the next.
- Writes game/public/assets/items/<classname>/ with frame-000.png (the still, also the
  store icon), animation.webp (the sheet) and item.json. Then run `npm run assets:room`.
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

GUTTER = 4  # transparent room pixels around every frame in the sheet (times --resolution)
MAX_TEXTURE = 4096  # widely supported GPU texture side
# An enclosed hole whose average distance to the background color is below this is background...
HOLE_BACKGROUND_MEAN = 20
# ...and only if it is big enough: smaller ones are glints of the art (the shine of an eye, 60 px, or of the golden ball, 230 px); the lens is 390+.
HOLE_BACKGROUND_MIN_AREA = 300


def run_ffmpeg(ffmpeg: str, video: Path, folder: Path) -> list[Path]:
    """Every frame of the video, at its own rate (the loop is searched at full temporal resolution)."""
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(video), str(folder / 'f%04d.png')], check=True)
    return sorted(folder.glob('f*.png'))


def source_fps(ffmpeg: str, video: Path) -> float:
    probe = Path(ffmpeg).with_name('ffprobe' + Path(ffmpeg).suffix)
    rate = subprocess.run([str(probe) if probe.exists() else 'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                           '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', str(video)],
                          check=True, capture_output=True, text=True).stdout.strip()
    num, _, den = rate.partition('/')
    return float(num) / float(den or 1)


def find_loop(regions: list[np.ndarray], min_share: float, crossfade: int, step: int) -> tuple[int, int]:
    """The pair of frames (start, end) that look most alike, end - start a multiple of the
    output step and covering at least min_share of the video, so playing start..end-1 and then
    start again is no bigger a change than one ordinary frame.

    Each region (the body, the props flying around it) is scored against its own ordinary
    frame-to-frame change: a small fast prop would otherwise be drowned by the large body."""
    count = len(regions[0])
    flats = [region.reshape(count, -1) for region in regions]
    steps = [max(1e-6, float(np.abs(flat[1:] - flat[:-1]).mean())) for flat in flats]
    best = (math.inf, 0, count)
    for start in range(crossfade, count):
        for end in range(start + int(min_share * count), count):
            if (end - start) % step:
                continue
            difference = max(float(np.abs(flat[start] - flat[end]).mean()) / ordinary for flat, ordinary in zip(flats, steps))
            if difference < best[0]:
                best = (difference, start, end)
    return best[1], best[2]


def largest_piece(mask: np.ndarray) -> np.ndarray:
    labels, count = ndi.label(mask, structure=np.ones((3, 3)))
    if not count:
        return mask
    return labels == 1 + int(np.argmax(ndi.sum(mask, labels, range(1, count + 1))))


def foreground(rgb: np.ndarray, threshold: int, min_area: int) -> np.ndarray:
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    background = np.median(border, axis=0)
    distance = np.abs(rgb.astype(int) - background).max(axis=2)
    mask = distance > threshold
    labels, count = ndi.label(mask, structure=np.ones((3, 3)))
    if count:
        sizes = ndi.sum(mask, labels, range(1, count + 1))
        keep = np.zeros(count + 1, dtype=bool)
        keep[1:] = sizes >= min_area
        mask = keep[labels]
    # Enclosed holes: lights and pale skin stay unless they really look like the background.
    holes, holes_count = ndi.label(~mask, structure=np.ones((3, 3)))
    if holes_count:
        border_labels = np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]]))
        means = ndi.mean(distance, holes, range(1, holes_count + 1))
        areas = ndi.sum(np.ones_like(distance), holes, range(1, holes_count + 1))
        fill = np.zeros(holes_count + 1, dtype=bool)
        # Lenses and gaps in the art average 8-13 away from the background; pale skin, 30 or more.
        fill[1:] = (means > HOLE_BACKGROUND_MEAN) | (areas < HOLE_BACKGROUND_MIN_AREA)
        fill[border_labels] = False
        mask = mask | fill[holes]
    return mask


def clean_edges(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """RGBA with inner colors pushed to the edge and a soft alpha, no white fringe."""
    inner = ndi.binary_erosion(mask, iterations=2)
    if not inner.any():
        inner = mask
    _, nearest = ndi.distance_transform_edt(~inner, return_indices=True)
    colors = rgb[nearest[0], nearest[1]]
    pulled_in = ndi.binary_erosion(mask, iterations=1)
    alpha = np.clip(ndi.gaussian_filter(pulled_in.astype(float), 0.8) * 1.15, 0, 1)
    out = np.dstack([colors, (alpha * 255).round().astype(np.uint8)])
    return out.astype(np.uint8)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('video', type=Path)
    parser.add_argument('--classname', required=True)
    parser.add_argument('--id', type=int, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--price', type=int, default=800)
    parser.add_argument('--kind', default='decor')
    parser.add_argument('--fps', type=int, default=15)
    parser.add_argument('--height', type=float, default=200, help='character height in room pixels (the tile is 160 x 80)')
    parser.add_argument('--feet', type=float, default=54, help='y of the feet below the top corner of the tile (its center is 40)')
    parser.add_argument('--threshold', type=int, default=36)
    parser.add_argument('--resolution', type=int, default=2, help='sheet pixels per room pixel')
    parser.add_argument('--crossfade', type=int, default=4, help='video frames dissolved into the start of the loop')
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg') or 'ffmpeg')
    parser.add_argument('--out', type=Path, default=Path(__file__).resolve().parents[2] / 'game/public/assets/items')
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as temp:
        paths = run_ffmpeg(args.ffmpeg, args.video, Path(temp))
        if not paths:
            sys.exit('O ffmpeg não extraiu quadros.')
        step = max(1, round(source_fps(args.ffmpeg, args.video) / args.fps))

        # Pass 1: masks and the common crop box.
        masks = [foreground(np.asarray(Image.open(path).convert('RGB')), args.threshold, 600) for path in paths]
        union = np.zeros_like(masks[0])
        body_box = np.zeros_like(masks[0])
        for mask in masks:
            union |= mask
            body_box |= largest_piece(mask)
        ys, xs = np.where(union)
        left, right, top, bottom = xs.min() - 4, xs.max() + 5, ys.min() - 4, ys.max() + 5
        by, bx = np.where(body_box)
        body_rect = (bx.min(), by.min(), bx.max() + 1, by.max() + 1)

        # Small thumbnails of the body and of everything else (props such as a flying ball).
        bodies, props = [], []
        for path in paths:
            pixels = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)[top:bottom, left:right].copy()
            body = pixels[body_rect[1] - top:body_rect[3] - top, body_rect[0] - left:body_rect[2] - left]
            bodies.append(np.asarray(Image.fromarray(body.astype(np.uint8)).resize((64, 128), Image.BILINEAR), dtype=np.float32))
            pixels[body_rect[1] - top:body_rect[3] - top, body_rect[0] - left:body_rect[2] - left] = 0
            props.append(np.asarray(Image.fromarray(pixels.astype(np.uint8)).resize((96, 192), Image.BILINEAR), dtype=np.float32))
        loop_start, loop_end = find_loop([np.stack(bodies), np.stack(props)], 0.6, args.crossfade, step)

        def premultiplied(index: int) -> np.ndarray:
            rgba = clean_edges(np.asarray(Image.open(paths[index]).convert('RGB')), masks[index])[top:bottom, left:right]
            rgba = rgba.astype(np.float32) / 255
            rgba[..., :3] *= rgba[..., 3:4]
            return rgba

        # Pass 2: the loop's frames. The body's last frames dissolve into those just before the
        # start, so it flows into the beginning as if the video went on. Fast props are not
        # dissolved (two half-transparent copies would show); the chosen pair already matches them.
        frames = []
        for index in range(loop_start, loop_end, step):
            frame = premultiplied(index)
            lead = index - (loop_end - args.crossfade)
            if lead >= 0:
                other = loop_start - args.crossfade + lead
                body = largest_piece(masks[index]) | largest_piece(masks[other])
                body = ndi.gaussian_filter(ndi.binary_dilation(body, iterations=6).astype(np.float32), 2)[top:bottom, left:right]
                weight = ((lead + 1) / (args.crossfade + 1) * np.clip(body, 0, 1))[..., None]
                frame = frame * (1 - weight) + premultiplied(other) * weight
            frames.append(frame)

    # The largest piece of the first frame is the character: its width centers the item.
    labels, count = ndi.label(masks[loop_start], structure=np.ones((3, 3)))
    biggest = 1 + int(np.argmax(ndi.sum(masks[loop_start], labels, range(1, count + 1))))
    body_xs = np.where((labels == biggest).any(axis=0))[0]
    body_top = np.where((labels == biggest).any(axis=1))[0].min()
    body_center = (body_xs.min() + body_xs.max()) / 2
    body_height = (bottom - 5) - body_top
    scale = args.height / body_height
    width, height = math.ceil((right - left) * scale), math.ceil((bottom - top) * scale)

    def to_image(frame: np.ndarray, size: tuple[int, int]) -> Image.Image:
        rgba = (np.clip(frame, 0, 1) * 255).round().astype(np.uint8)
        return Image.fromarray(rgba, 'RGBa').resize(size, Image.LANCZOS).convert('RGBA')

    folder = args.out / args.classname
    folder.mkdir(parents=True, exist_ok=True)
    to_image(frames[0], (width, height)).save(folder / 'frame-000.png', optimize=True)

    # The sheet is drawn at --resolution times the room size and scaled down by the game, so the
    # character stays sharp when the camera zooms out (mipmaps start from more detail).
    resolution = args.resolution
    cell_w = (width + 2 * GUTTER) * resolution
    cell_h = (height + 2 * GUTTER) * resolution
    columns = min(len(frames), MAX_TEXTURE // cell_w)
    rows = math.ceil(len(frames) / columns)
    if rows * cell_h > MAX_TEXTURE:
        sys.exit(f'A folha passaria de {MAX_TEXTURE} px; reduza --fps, --height ou --resolution.')
    sheet = Image.new('RGBA', (columns * cell_w, rows * cell_h), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.paste(to_image(frame, (width * resolution, height * resolution)),
                    ((index % columns) * cell_w + GUTTER * resolution, (index // columns) * cell_h + GUTTER * resolution))
    # Lossy WebP (lossless alpha): the frames come from a compressed video already, and the sheet
    # is about a quarter of the PNG.
    sheet.save(folder / 'animation.webp', 'WEBP', quality=92, alpha_quality=100, method=6)
    (folder / 'animation.png').unlink(missing_ok=True)

    manifest = {
        'id': args.id, 'classname': args.classname, 'name': args.name, 'type': 3, 'kind': args.kind,
        'priceGold': args.price, 'purchasable': True, 'sizeX': 1, 'sizeY': 1,
        'itemHeight': round(args.height * 0.9, 1),
        'parts': [{
            'file': 'frame-000.png', 'width': width, 'height': height,
            'left': round(-(body_center - left) * scale, 1), 'top': round(args.feet - (bottom - 5 - top) * scale, 1),
        }],
        'animation': {
            'file': 'animation.webp', 'fps': args.fps, 'frames': len(frames), 'columns': columns,
            'frameWidth': width, 'frameHeight': height, 'gutter': GUTTER, 'resolution': resolution,
        },
    }
    (folder / 'item.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Laço: quadros {loop_start} a {loop_end - 1} do vídeo; {len(frames)} quadros de {width}x{height} '
          f'(folha em {resolution}x: {sheet.width}x{sheet.height}): {folder}')


if __name__ == '__main__':
    main()
