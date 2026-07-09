"""Health probe: renders the factory default cube, 1 frame, 320x240."""

import argparse
import sys

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int, default=1)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"  # noqa: vulture
    scene.render.resolution_x = 320  # noqa: vulture
    scene.render.resolution_y = 240  # noqa: vulture
    scene.render.image_settings.file_format = "PNG"  # noqa: vulture
    scene.render.filepath = f"{args.out}/frame_"  # noqa: vulture
    if args.animation:
        scene.frame_start = 1  # noqa: vulture
        scene.frame_end = 1  # noqa: vulture
        bpy.ops.render.render(animation=True)
    else:
        scene.frame_set(args.frame)
        scene.render.filepath = f"{args.out}/frame_{args.frame:04d}.png"  # noqa: vulture
        bpy.ops.render.render(write_still=True)


main()
