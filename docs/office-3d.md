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
renderer/src/OfficeFloor.jsx         (DOM nameplates/status lights projected over the canvas)
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
- **React DOM** owns the hit areas, nameplates, status lights, empty bay
  affordances and amenity tags. Their positions come from projecting 3D
  anchors (`Office3D -> onProject`), so the labels stay glued to the 3D room
  at any window size. There are no state-text bubbles: posture animations,
  monitor content and the status light communicate the state.
- Monitor screens use a per-desk `CanvasTexture`; pass/fail/test states paint
  the whole screen green/red/amber.
- If WebGL or the GLB fails, `OfficeFloor` falls back to the 2D SVG workstation
  art over `backdrop.png`; interaction and e2e selectors stay identical.

## Desk screens and idle states

`renderer/src/scene/deskScreen.js` is the single screen contract shared by the
Three.js textures, the 2D fallback and `data-screen` in e2e:

| desk state | screen |
| --- | --- |
| no occupant, or company duty phase `off` | pure black |
| occupied, not running (idle / phone / minesweeper / coffee) | Windows desktop (wallpaper + icons + taskbar) |
| programmer/tester working | code editor |
| PM working | office document / table |
| shell tool running | terminal |
| tests running / pass / fail | test runner / pass / fail console |

The off-duty phase is polled from the existing `schedule.get` IPC every second
(`App.jsx`), so the monitor follows the real duty runtime; it is not inferred
from timestamps in the view. The 3D planes and the 2D SVG fallback both consume
`screenForDesk()`, so an empty bay cannot show a “standby” picture.

## Idle animation

After 9s without a run (`idleMotion.js`) an occupied desk rolls one of three
slack states with `Math.random` (injectable in tests):

- `phone` — 12s seated, phone prop, slight lean/bob, Windows desktop.
- `minesweeper` — 12s seated, alternating hand taps, Windows desktop.
- `coffee` — 2.5s walk to the left-front espresso bar, 5s at the machine,
  2.5s walk back, 10s seated with a cup, then idle. A new idle cycle begins
  after the return; any real work event immediately pulls the employee back to
  the desk. The monitor stays on the Windows desktop for every coffee phase.

The 3D avatar adds legs (hidden while seated), a phone and a paper cup. The
walk is interpolated every frame from the state phase timestamps, so the
500ms React tick only changes posture/phase; it does not step the position.
Coffee starts beside the counter at `(-3.42, 4.92)`, clear of the counter
occlusion seen in the first pass.

## Viewport and inspection zoom

The room keeps the authored `640:440` composition but no longer caps at
`980px`:

```css
width: min(max(calc(100vw - 240px), 82vw), calc((100vh - 30px) * 640 / 440));
```

At 1280×800 the room is roughly `1038×714` (instead of the old `980×674`); at
1920×1080 it is `1474×1013`. The minimum `900×600` window still gets `727×499`,
and the zoom cluster clears the ⚙ settings button.

The camera is optical, not a CSS transform of the room:

- `100%` is the auto-fit view; `400%` is the inspection limit; buttons move by
  ×1.25. `−` is disabled at 100%.
- Wheel over the room zooms continuously around the pointer. The target shifts
  on the plane through the current target so the point under the cursor stays
  approximately fixed. Wheel outside the room is not captured.
- Above 100%, a left drag past 5px pan anywhere in the scene (including a desk
  or label). A drag swallows the following click; a normal click still hires
  or opens chat. Pan is disabled at 100%.
- The camera target is clamped to the room's usable furniture band
  (`x ±4.25`, `z 0.75–5.15`), so a fully zoomed view cannot slide into empty
  world space. A double click on the background, and the top-right “适应”
  button, reset to 100%.
- The zoom survives window resizes and company/project-group switches. It is
  session state, not a persisted preference; a fresh app launch starts at 100%.

DOM labels keep their readable font size; the invisible `.desk-hit` shell is a
clipped quad of the projected desk top, so it grows with the camera but does
not overlap the next bay (a plain bounding box made one label open another
desk at 400%). `Office3D` computes the label anchor, the projected quad and
the clip path in `projectDesks()`. When WebGL fails, the zoom controls are
hidden and wheel zoom is disabled with the static fallback.

E2E coverage lives in `scripts/e2e-08-runner.mjs`: 100/125/400%,
pointer-anchored wheel, wheel outside, drag+click threshold, 100% no-pan,
resize persistence, 1920/900 thresholds, 400% hit-ownership, and
company-switch retention. Human evidence lives in
`tmp/ui-shot/shots/16-zoom-*.png`.
