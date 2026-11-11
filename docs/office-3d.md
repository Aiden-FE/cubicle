# 3D office scene

The main canvas is a real 3D dollhouse rendered in the renderer; there is no
pre-rendered image in the normal path.

## Pipeline

```
scripts/blender/office-scene.py
        │  blender --background --python scripts/blender/office-scene.py
        ▼
renderer/public/office/office.glb   (≈4.7 MB, materials only, no textures)
        │  GLTFLoader
        ▼
renderer/src/scene/Office3D.jsx      (Three.js, camera + lights + avatars + screens)
renderer/src/OfficeFloor.jsx         (DOM labels/bubbles projected over the canvas)
```

`scripts/blender/office-backdrop.py` is only the WebGL-failure fallback image
(`renderer/public/office/backdrop.png`).

## Editing the room

- The scene is built from primitives and named objects; no external assets or
  add-ons are required.
- The Blender scene uses **Y up** (the same convention as Three.js). The glTF
  exporter is called with `export_yup=False`; do not turn it on, or the room
  will be rotated onto its side.
- Desks are named `Desk1..Desk8_*` and laid out as two rows of four. The order
  must match:
  - `DESK_SLOTS` in `src/host/store.mjs`
  - `DESK_LAYOUT` in `renderer/src/scene/Office3D.jsx`
  - `DESK_Z = [1.55, 3.45]` / `DESK_X = [-3.45, -1.15, 1.15, 3.45]` in the
    Blender script.
- Coffee machine: left-front counter at `(-4.25, 4.8)`; water cooler: left-rear
  plinth at `(-4.30, 2.14)`. The DOM amenity tags project these same anchors
  from `Office3D.projectPoint`.
- Re-export after editing:

  ```bash
  "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" \
    --background --python scripts/blender/office-scene.py
  ```

- Rebuild the renderer (public assets are copied into `dist/renderer/office/`):

  ```bash
  npm run build:renderer
  ```

## Live layers

- **Three.js** owns the room, desks, chairs, coffee/water props, employees and
  monitor textures.
- **React DOM** owns the hit areas, nameplates, bubbles, status lights, empty
  bay affordances and amenity tags. Their positions come from projecting 3D
  anchors (`Office3D -> onProject`), so the labels stay glued to the 3D room
  at any window size.
- Monitor screens use a per-desk `CanvasTexture`; pass/fail/test states paint
  the whole screen green/red/amber.
- If WebGL or the GLB fails, `OfficeFloor` falls back to the 2D SVG workstation
  art over `backdrop.png`; interaction and e2e selectors stay identical.
