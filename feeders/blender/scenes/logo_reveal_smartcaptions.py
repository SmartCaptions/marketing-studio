"""SmartCaptions logo reveal: three stacked isometric plates drawn on, 90 frames, alpha.

Geometry: two chevron bands (orange=profit, amber=rare) over a diamond base plate
(blue=brand), each extruded as a POLY spline tube with bevel_factor_end draw-on.
"""

import argparse
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BRAND = json.loads((ROOT / "brands" / "smartcaptions.json").read_text())

FPS = 30
FRAMES = 90
SIZE = 4.0 / 24.0  # svg unit -> blender unit (viewBox 0..24, mark spans 4 units)


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0):
    h = hex_color.lstrip("#")
    return tuple(srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4)) + (
        alpha,
    )


def sv(x: float, y: float, z: float = 0.0):
    """Map svg coords (0..24, y down) to scene coords centered at origin, y up."""
    return ((x - 12.0) * SIZE, (12.0 - y) * SIZE, z)


# strength=1.0: higher values clip brand hues under the Standard view transform
def emission_material(name: str, color, strength: float = 1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True  # noqa: vulture
    nodes = mat.node_tree.nodes
    nodes.clear()
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color  # noqa: vulture
    em.inputs["Strength"].default_value = strength  # noqa: vulture
    out = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat


def poly_curve(name: str, points, cyclic: bool, bevel: float, mat) -> bpy.types.Object:
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"  # noqa: vulture
    curve.bevel_depth = bevel  # noqa: vulture
    curve.bevel_resolution = 6  # noqa: vulture
    curve.use_fill_caps = True  # noqa: vulture
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for pt, (x, y, z) in zip(spline.points, points):
        pt.co = (x, y, z, 1.0)  # noqa: vulture
    spline.use_cyclic_u = cyclic  # noqa: vulture
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def polygon_outline(xy_pts, z_offset: float = 0.0, overshoot: int = 3):
    """Build non-cyclic POLY spline point list for a filled polygon's outline.

    Closed by repeating the first point, then overshooting by <overshoot> extra
    points: PLAYBOOK requirement — the closing tube swallows both flat end-caps
    and avoids the visible notch at pointed features (verified on DashClaw shield).
    bevel_factor_end draw-on only works on non-cyclic splines (Blender 5.1.2).
    """
    pts = [sv(x, y, z_offset) for (x, y) in xy_pts]
    return pts + [pts[0]] + pts[1 : 1 + overshoot]


def keyframe_draw_on(obj, start: int, end: int) -> None:
    """Animate curve bevel_factor_end 0 -> 1 between start and end frames."""
    curve = obj.data
    curve.bevel_factor_end = 0.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=start)
    curve.bevel_factor_end = 1.0  # noqa: vulture
    curve.keyframe_insert("bevel_factor_end", frame=end)


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--animation", action="store_true")
    return parser.parse_args(argv)


def build_scene() -> None:
    scene = bpy.context.scene
    # NOTE: scene.collection.objects only lists objects directly in the master
    # collection; the factory Cube/Light/Camera live in a child collection and
    # would survive that loop. Clear bpy.data.objects directly.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    scene.render.engine = "BLENDER_EEVEE"  # noqa: vulture
    scene.render.film_transparent = True  # noqa: vulture
    scene.render.resolution_x = 1080  # noqa: vulture
    scene.render.resolution_y = 1080  # noqa: vulture
    scene.render.fps = FPS  # noqa: vulture
    scene.frame_start = 1  # noqa: vulture
    scene.frame_end = FRAMES  # noqa: vulture
    scene.view_settings.view_transform = "Standard"  # noqa: vulture
    scene.render.image_settings.file_format = "PNG"  # noqa: vulture
    scene.render.image_settings.color_mode = "RGBA"  # noqa: vulture

    # Colors from brand JSON; emission strength=1.0 avoids channel-clipping
    mat_blue = emission_material(
        "brand_blue", hex_rgba(BRAND["colors"]["brand"]), strength=1.0
    )
    mat_amber = emission_material(
        "brand_amber", hex_rgba(BRAND["colors"]["rare"]), strength=1.0
    )
    mat_orange = emission_material(
        "brand_orange", hex_rgba(BRAND["colors"]["profit"]), strength=1.0
    )

    # Tube radius (~1.0 svg unit at 1x scale; tighter than noban to match thin plate aesthetic)
    stroke = 0.042

    # ── Plate geometry sampled from SmartCaptionsMark.tsx SVG paths ──────────
    # (viewBox 0..24, y-down; polygon vertices listed clockwise from SVG path M)

    # Bottom plate: diamond, brand blue — solid base of the isometric S
    # SVG path: M12 12.6 20.2 16.7 12 20.8 3.8 16.7 Z
    diamond_xy = [(12, 12.6), (20.2, 16.7), (12, 20.8), (3.8, 16.7)]

    # Middle plate: chevron band, amber — middle step of the S
    # SVG path: M4 10.7 12 6.7 20 10.7 20 12.9 12 8.9 4 12.9 Z
    mid_xy = [(4, 10.7), (12, 6.7), (20, 10.7), (20, 12.9), (12, 8.9), (4, 12.9)]

    # Top plate: chevron band, orange — floating lightest tier of the S
    # SVG path: M4 6.4 12 2.4 20 6.4 20 8.6 12 4.6 4 8.6 Z
    top_xy = [(4, 6.4), (12, 2.4), (20, 6.4), (20, 8.6), (12, 4.6), (4, 8.6)]

    # Z offsets create visible layer separation; camera is along +Z axis
    diamond = poly_curve(
        "diamond", polygon_outline(diamond_xy, z_offset=0.00), False, stroke, mat_blue
    )
    mid_chev = poly_curve(
        "mid_chev", polygon_outline(mid_xy, z_offset=0.16), False, stroke, mat_amber
    )
    top_chev = poly_curve(
        "top_chev", polygon_outline(top_xy, z_offset=0.32), False, stroke, mat_orange
    )

    parent = bpy.data.objects.new("mark", None)
    bpy.context.scene.collection.objects.link(parent)
    for obj in [diamond, mid_chev, top_chev]:
        obj.parent = parent

    # ── Draw-on choreography (30 fps, 90 frames) ─────────────────────────────
    # Bottom-to-top reveal: diamond first, then the two chevron bands
    keyframe_draw_on(diamond,  6, 30)
    keyframe_draw_on(mid_chev, 22, 52)
    keyframe_draw_on(top_chev, 40, 68)

    # ── 3D settle: isometric-tilt pose -> straight-on ─────────────────────────
    parent.rotation_euler = (0.22, -0.35, 0.12)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=1)
    parent.rotation_euler = (0.0, 0.0, 0.0)  # noqa: vulture
    parent.keyframe_insert("rotation_euler", frame=80)

    # ── Camera ────────────────────────────────────────────────────────────────
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85  # noqa: vulture
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0.0, 0.0, 9.0)  # noqa: vulture
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam  # noqa: vulture


def main() -> None:
    args = parse_args()
    build_scene()
    scene = bpy.context.scene
    if args.animation:
        scene.render.filepath = f"{args.out}/frame_"  # noqa: vulture
        bpy.ops.render.render(animation=True)
    else:
        frame = args.frame or 1
        scene.frame_set(frame)
        scene.render.filepath = f"{args.out}/frame_{frame:04d}.png"  # noqa: vulture
        bpy.ops.render.render(write_still=True)


main()
