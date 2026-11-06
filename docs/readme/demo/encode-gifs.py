"""Encode the recorded browser frames; no retouching or interface redrawing."""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "docs" / "readme"
FRAMES = ROOT / ".tmp" / "readme-demo" / "frames.json"

for name, frames in json.loads(FRAMES.read_text(encoding="utf-8")).items():
    images = [Image.open(frame["path"]).convert("RGB") for frame in frames]
    # One shared palette keeps text and panel colors steady between frames.
    palette = images[len(images) // 2].quantize(colors=192)
    encoded = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
    destination = OUTPUT / f"{name}-demo.gif"
    encoded[0].save(
        destination,
        save_all=True,
        append_images=encoded[1:],
        duration=[frame["duration"] for frame in frames],
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"{destination.name}: {len(frames)} frames, {sum(frame['duration'] for frame in frames) / 1000:.1f}s")
    for image in images + encoded:
        image.close()
