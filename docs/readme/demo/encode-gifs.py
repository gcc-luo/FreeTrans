"""Encode the recorded browser frames; no retouching or interface redrawing."""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "docs" / "readme"
FRAMES = ROOT / ".tmp" / "readme-demo" / "frames.json"

for name, frames in json.loads(FRAMES.read_text(encoding="utf-8")).items():
    # One shared palette keeps text and panel colors steady between frames.
    with Image.open(frames[len(frames) // 2]["path"]) as sample:
        palette = sample.convert("RGB").quantize(colors=192)
    encoded = []
    for frame in frames:
        with Image.open(frame["path"]) as source:
            encoded.append(source.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE))
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
    for image in encoded:
        image.close()
    palette.close()
