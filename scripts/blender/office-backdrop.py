"""Render the Cubicle office backdrop.

Run:
  blender --background --python scripts/blender/office-backdrop.py

Output: renderer/public/office/backdrop.png (1600x1100, opaque).
The 2D desk/person layer is painted over this plate by OfficeFloor.jsx, so
the room is deliberately empty of workstations: only architecture, light,
plants, storage and a rug are modelled.
"""

import math
import os
import random

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "renderer", "public", "office", "backdrop.png")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
random.seed(14)

# ── clean scene ──────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = OUT
scene.render.fps = 24
scene.eevee.taa_render_samples = 64
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.1

# ── helpers ──────────────────────────────────────────────────────────────────
def mat(name, color, roughness=0.6, metallic=0.0, emission=None, emission_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return m


def box(name, size, loc, material, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0], size[1], size[2])
    ob.data.materials.append(material)
    if bevel > 0:
        mod = ob.modifiers.new("soft edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return ob


def cyl(name, radius, depth, loc, material, vertices=32, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(material)
    return ob


def vcyl(name, radius, height, loc, material, vertices=32):
    """Cylinder with its depth along +Y (the room's vertical axis)."""
    return cyl(name, radius, height, loc, material, vertices, (math.pi / 2, 0, 0))


def ico(name, radius, loc, material, subdivisions=2, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.data.materials.append(material)
    return ob


def plane(name, size, loc, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0], size[1], 1)
    ob.data.materials.append(material)
    return ob


# ── materials ───────────────────────────────────────────────────────────────
plaster = mat("plaster", (0.78, 0.72, 0.61), 0.85)
plaster_warm = mat("plaster warm", (0.82, 0.74, 0.61), 0.9)
oak = mat("oak", (0.45, 0.28, 0.14), 0.55)
oak_light = mat("oak light", (0.62, 0.43, 0.24), 0.55)
oak_dark = mat("oak dark", (0.31, 0.19, 0.10), 0.6)
floor_mat = mat("floor oak", (0.63, 0.46, 0.29), 0.62)
floor_mat2 = mat("floor oak 2", (0.58, 0.41, 0.25), 0.64)
floor_mat3 = mat("floor oak 3", (0.68, 0.51, 0.33), 0.6)
rug_mat = mat("rug", (0.67, 0.55, 0.41), 0.98)
rug_red = mat("rug stripe", (0.47, 0.24, 0.17), 0.92)
sage = mat("sage", (0.31, 0.38, 0.29), 0.7)
sage_light = mat("sage light", (0.45, 0.52, 0.38), 0.75)
terracotta = mat("terracotta", (0.61, 0.31, 0.20), 0.82)
brass = mat("brass", (0.70, 0.52, 0.26), 0.3, 0.85)
black = mat("black", (0.07, 0.065, 0.055), 0.45)
charcoal = mat("charcoal", (0.16, 0.15, 0.13), 0.65)
cream = mat("cream", (0.88, 0.82, 0.70), 0.75)
paper = mat("paper", (0.91, 0.86, 0.75), 0.9)
glass = mat("glass", (0.34, 0.44, 0.44), 0.15, 0.0)
water = mat("water", (0.35, 0.49, 0.48), 0.2)
leaf = mat("leaf", (0.20, 0.32, 0.18), 0.8)
leaf2 = mat("leaf 2", (0.26, 0.40, 0.22), 0.82)
leaf3 = mat("leaf 3", (0.32, 0.45, 0.25), 0.8)
cloud = mat("cloud", (0.90, 0.91, 0.86), 0.95, emission=(0.95, 0.92, 0.84), emission_strength=0.08)
skyline = mat("skyline", (0.35, 0.47, 0.38), 0.85)
skin = mat("skin", (0.54, 0.35, 0.24), 0.75)
book_colors = [
    (0.34, 0.22, 0.16), (0.24, 0.31, 0.28), (0.58, 0.42, 0.23),
    (0.47, 0.25, 0.19), (0.27, 0.27, 0.31), (0.63, 0.52, 0.36),
    (0.41, 0.46, 0.35), (0.30, 0.17, 0.13),
]
book_mats = [mat(f"book {i}", c, 0.7) for i, c in enumerate(book_colors)]

# ── architecture ────────────────────────────────────────────────────────────
# floor base
box("floor", (11.0, 0.12, 7.2), (0, -0.06, 3.15), oak_dark)
# plank strips; each strip is a long board running toward the camera
board_w = 0.225
for i in range(46):
    x = -5.25 + (i + 0.5) * board_w
    shade = [floor_mat, floor_mat2, floor_mat3][i % 3]
    box(f"plank {i}", (board_w - 0.005, 0.018, 7.1), (x, 0.008, 3.15), shade)
    # fine butt joints, staggered so the floor does not read as a grid
    for j in range(3):
        z = 0.3 + ((i * 0.37 + j * 2.3) % 6.4)
        box(f"joint {i}-{j}", (board_w - 0.004, 0.002, 0.012), (x, 0.019, z), oak_dark)

# back wall and baseboard / wainscot
box("back wall", (11.0, 4.6, 0.14), (0, 2.3, -0.08), plaster)
box("wainscot", (10.96, 1.05, 0.055), (0, 0.525, 0.015), oak_light, 0.02)
box("wainscot cap", (10.96, 0.08, 0.08), (0, 1.08, 0.06), oak, 0.02)
box("baseboard", (10.96, 0.16, 0.10), (0, 0.08, 0.08), cream, 0.015)
# slender battens on the upper wall give the room a built-in, panelled feel
for i in range(18):
    x = -5.3 + i * 0.62
    box(f"batten {i}", (0.028, 2.1, 0.03), (x, 2.15, 0.012), plaster_warm, 0.008)

# ── window ──────────────────────────────────────────────────────────────────
wx, wy, ww, wh = -2.45, 2.62, 2.75, 1.42
# recess + sky plane
box("window recess", (ww - 0.16, wh - 0.16, 0.04), (wx, wy, 0.045), black)
sky_node = bpy.data.materials.new("sky")
sky_node.use_nodes = True
nt = sky_node.node_tree
nodes, links = nt.nodes, nt.links
output = nodes.get("Material Output")
bsdf = nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = 0.2
coord = nodes.new("ShaderNodeTexCoord")
sep = nodes.new("ShaderNodeSeparateXYZ")
ramp = nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.78, 0.82, 0.76, 1)
ramp.color_ramp.elements[1].color = (0.30, 0.53, 0.68, 1)
links.new(coord.outputs["Generated"], sep.inputs["Vector"])
links.new(sep.outputs["Y"], ramp.inputs["Fac"])
em = nodes.new("ShaderNodeEmission")
em.inputs["Strength"].default_value = 0.55
links.new(ramp.outputs["Color"], em.inputs["Color"])
links.new(em.outputs["Emission"], output.inputs["Surface"])
plane("window sky", (ww - 0.20, wh - 0.20), (wx, wy, 0.07), sky_node)
# a soft skyline and clouds, just behind the mullions
for i, (cx, cy, cw) in enumerate([(-3.35, 2.10, 0.34), (-2.95, 2.16, 0.30), (-2.55, 2.06, 0.38), (-1.85, 2.12, 0.32)]):
    ico(f"skyline tree {i}", 0.24, (cx, cy, 0.075), skyline, 1, (cw, 0.9, 0.15))
for i, (cx, cy) in enumerate([(-3.15, 3.08), (-2.45, 2.96), (-1.72, 3.12)]):
    ico(f"sky cloud {i}", 0.14, (cx, cy, 0.074), cloud, 2, (1.5, 0.40, 0.10))
# frame
for name, size, loc in [
    ("window top", (ww, 0.10, 0.10), (wx, wy + wh / 2, 0.08)),
    ("window bottom", (ww, 0.10, 0.10), (wx, wy - wh / 2, 0.08)),
    ("window left", (0.10, wh, 0.10), (wx - ww / 2, wy, 0.08)),
    ("window right", (0.10, wh, 0.10), (wx + ww / 2, wy, 0.08)),
    ("window mullion", (0.045, wh, 0.07), (wx, wy, 0.08)),
    ("window transom", (ww, 0.04, 0.07), (wx, wy + 0.15, 0.08)),
]:
    box(name, size, loc, charcoal, 0.012)
# a soft sill
box("window sill", (ww + 0.16, 0.10, 0.22), (wx, wy - wh / 2 - 0.03, 0.16), cream, 0.02)
# small plant on sill
vcyl("sill pot", 0.13, 0.22, (wx - ww / 2 + 0.28, wy - wh / 2 + 0.16, 0.14), terracotta)
for i in range(4):
    ang = i * 1.3
    ico(f"sill leaf {i}", 0.075, (wx - ww / 2 + 0.28 + math.cos(ang) * 0.10, wy - wh / 2 + 0.32, 0.28 + math.sin(ang) * 0.05), leaf2, 1, (0.5, 1.4, 0.14))

# ── rug ────────────────────────────────────────────────────────────────────
box("rug", (5.2, 0.018, 3.2), (0.0, 0.025, 2.2), rug_mat, 0.06)
for i in range(5):
    box(f"rug line {i}", (4.35, 0.006, 0.022), (0, 0.036, 1.15 + i * 0.6), rug_red if i in (0, 4) else cream)

# ── right storage / bookshelf ───────────────────────────────────────────────
sx, sz = 3.15, 0.28
box("shelf back", (2.1, 2.35, 0.08), (sx, 1.2, sz), oak_dark, 0.02)
for y in (0.32, 0.92, 1.52, 2.12):
    box(f"shelf board {y}", (2.15, 0.055, 0.40), (sx, y, sz + 0.18), oak_light, 0.015)
for side in (-1, 1):
    box(f"shelf side {side}", (0.06, 2.3, 0.40), (sx + side * 1.04, 1.2, sz + 0.18), oak_light, 0.015)
# books, boxes and a small plant
for shelf_i, y in enumerate((0.37, 0.97, 1.57, 2.17)):
    x = sx - 0.88
    while x < sx + 0.85:
        w = random.uniform(0.07, 0.13)
        h = random.uniform(0.18, 0.30)
        d = random.uniform(0.17, 0.24)
        if random.random() < 0.18:
            box(f"box {shelf_i}-{x:.2f}", (w + 0.04, 0.14, d), (x + w / 2, y + 0.07, sz + 0.11), cream, 0.01)
        else:
            box(f"book {shelf_i}-{x:.2f}", (w, h, d), (x + w / 2, y + h / 2, sz + 0.10), random.choice(book_mats), 0.004)
        x += w + 0.018
# trailing plant cascading from shelf top
vcyl("shelf plant pot", 0.18, 0.26, (sx + 0.55, 2.5, sz + 0.30), cream)
for i in range(8):
    a = i * 0.8
    ico(f"shelf leaf {i}", 0.16, (sx + 0.55 + math.cos(a) * 0.22, 2.45, sz + 0.44 + math.sin(a) * 0.14), leaf, 1, (0.5, 1.5, 0.18))

# ── left sideboard / credenza ───────────────────────────────────────────────
cx, cz = -3.3, 0.34
box("credenza", (2.0, 0.92, 0.52), (cx, 0.46, cz), oak, 0.03)
for i in range(2):
    box(f"credenza door {i}", (0.92, 0.78, 0.025), (cx - 0.49 + i * 0.98, 0.46, cz + 0.27), oak_light, 0.01)
    cyl(f"credenza knob {i}", 0.025, 0.04, (cx - 0.49 + i * 0.98 + 0.3, 0.46, cz + 0.29), brass, 16)
# lamp on the credenza
vcyl("lamp base", 0.16, 0.04, (cx + 0.35, 0.95, cz + 0.30), brass)
vcyl("lamp stem", 0.025, 0.45, (cx + 0.35, 1.17, cz + 0.30), brass)
bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.30, radius2=0.12, depth=0.28, location=(cx + 0.35, 1.45, cz + 0.30), rotation=(-math.pi / 2, 0, 0))
lamp_shade = bpy.context.object
lamp_shade.data.materials.append(cream)
# little stack of books / ceramic vase
box("credenza books", (0.34, 0.05, 0.24), (cx - 0.45, 1.02, cz + 0.39), book_mats[2], 0.006)
vcyl("credenza vase", 0.12, 0.26, (cx - 0.05, 1.03, cz + 0.38), terracotta)
for i in range(4):
    vcyl(f"vase stem {i}", 0.012, 0.35, (cx - 0.05 + i * 0.03, 1.22, cz + 0.39), sage, 8)

# ── floor plant, left corner ────────────────────────────────────────────────
px, pz = -4.05, 1.0
vcyl("big pot", 0.28, 0.55, (px, 0.28, pz), terracotta, 32)
for i in range(11):
    a = i * 0.72
    rr = 0.32 + (i % 3) * 0.08
    ico(f"monstera leaf {i}", 0.26, (px + math.cos(a) * rr, 0.62 + (i % 4) * 0.09, pz + math.sin(a) * 0.22), [leaf, leaf2, leaf3][i % 3], 1, (0.38, 1.7, 0.12))

# ── wall art / clock ─────────────────────────────────────────────────────────
for i, (x, y, w, h, m) in enumerate([
    (0.3, 2.85, 0.62, 0.82, terracotta),
    (1.05, 2.78, 0.46, 0.58, sage),
    (0.5, 1.72, 0.92, 0.46, cream),
]):
    box(f"art frame {i}", (w, h, 0.04), (x, y, 0.08), oak_dark, 0.01)
    box(f"art paper {i}", (w - 0.08, h - 0.08, 0.012), (x, y, 0.105), m)
# abstract print on the large frame
for j in range(3):
    box(f"art mark {j}", (0.12, 0.04, 0.006), (0.16 + j * 0.12, 2.55 + j * 0.18, 0.115), charcoal)
# wall clock
cyl("clock face", 0.23, 0.04, (1.65, 2.05, 0.10), cream, 32)
cyl("clock rim", 0.245, 0.02, (1.65, 2.05, 0.085), brass, 32)
box("clock hand h", (0.10, 0.018, 0.012), (1.69, 2.05, 0.13), charcoal, 0)
box("clock hand m", (0.018, 0.15, 0.012), (1.65, 2.1, 0.132), charcoal, 0)

# ── pendant lamps (cords end near the top edge) ────────────────────────────
for i, x in enumerate((-2.4, 0.0, 2.4)):
    vcyl(f"pendant cord {i}", 0.012, 1.2, (x, 4.0, 1.55), black, 8)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.24, radius2=0.10, depth=0.24, location=(x, 3.38, 1.55), rotation=(-math.pi / 2, 0, 0))
    shade = bpy.context.object
    shade.name = f"pendant shade {i}"
    shade.data.materials.append(cream)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.10, location=(x, 3.26, 1.55))
    bulb = bpy.context.object
    bulb.data.materials.append(mat(f"bulb {i}", (1.0, 0.72, 0.42), 0.2, emission=(1.0, 0.62, 0.30), emission_strength=3.0))

# ── lighting ────────────────────────────────────────────────────────────────
world = bpy.data.worlds.new("room world")
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.36, 0.37, 0.34, 1)
bg.inputs["Strength"].default_value = 0.35
scene.world = world

# big soft window light
bpy.ops.object.light_add(type="AREA", location=(wx - 2.0, wy + 0.3, 2.0))
window_light = bpy.context.object
window_light.data.energy = 760
window_light.data.size = 4.0
window_light.data.color = (1.0, 0.82, 0.62)
window_light.rotation_euler = (math.radians(70), 0, math.radians(-35))
# warm key from camera side
bpy.ops.object.light_add(type="AREA", location=(3.6, 2.8, 3.0))
key = bpy.context.object
key.data.energy = 180
key.data.size = 5.0
key.data.color = (1.0, 0.86, 0.69)
key.rotation_euler = (math.radians(60), 0, math.radians(25))
# cool fill
bpy.ops.object.light_add(type="AREA", location=(-3.8, 1.8, 3.6))
fill = bpy.context.object
fill.data.energy = 70
fill.data.size = 4.0
fill.data.color = (0.66, 0.78, 0.84)
fill.rotation_euler = (math.radians(75), 0, math.radians(-15))
# low rim / floor bounce
bpy.ops.object.light_add(type="AREA", location=(0.7, 0.4, 4.2))
bounce = bpy.context.object
bounce.data.energy = 55
bounce.data.size = 5.0
bounce.data.color = (1.0, 0.74, 0.52)
bounce.rotation_euler = (math.radians(110), 0, 0)

# ── camera ──────────────────────────────────────────────────────────────────
bpy.ops.object.camera_add(location=(0.0, 1.72, 6.35))
cam = bpy.context.object
cam.data.lens = 27
cam.data.sensor_width = 36
# Look-at with the room's actual up axis (+Y). Blender's to_track_quat uses
# world Z as the up reference, which would roll this Y-up scene onto its side.
target = Vector((0.0, 1.45, 1.20))
forward = (target - cam.location).normalized()
right = forward.cross(Vector((0.0, 1.0, 0.0))).normalized()
up = right.cross(forward).normalized()
cam.rotation_euler = Matrix((right, up, -forward)).transposed().to_euler()
scene.camera = cam

# ── render ──────────────────────────────────────────────────────────────────
bpy.ops.render.render(write_still=True)
print(f"rendered {OUT}")
