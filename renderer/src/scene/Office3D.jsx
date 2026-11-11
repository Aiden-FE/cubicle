import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { appearanceFor } from "../roleAppearance.js";

/**
 * The eight desk bays in the Blender room. This order mirrors the DB desk
 * order (row-major, back row first) and the `Desk1..Desk8_*` object names in
 * office.glb. Keep it in sync with scripts/blender/office-scene.py.
 */
export const DESK_LAYOUT = [
  { x: -3.45, z: 1.55 },
  { x: -1.15, z: 1.55 },
  { x: 1.15, z: 1.55 },
  { x: 3.45, z: 1.55 },
  { x: -3.45, z: 3.45 },
  { x: -1.15, z: 3.45 },
  { x: 1.15, z: 3.45 },
  { x: 3.45, z: 3.45 },
];

/** @type {Record<string, string>} */
const SCREEN_COLORS = {
  pass: "#68b37d",
  fail: "#cf604b",
  test: "#e0ad4f",
  read: "#d9b677",
  write: "#85b58a",
  exec: "#7baeb9",
  idle: "#0b100d",
};

/** @param {string} tone @param {string} activity */
function screenTexture(tone, activity) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 108;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const accent = SCREEN_COLORS[tone] ?? SCREEN_COLORS.write;
  ctx.fillStyle = "#132019";
  ctx.fillRect(0, 0, 192, 108);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(0, 0, 192, 108);
  ctx.globalAlpha = 1;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 192, 9);
  ctx.globalAlpha = 0.9;
  ctx.fillRect(12, 18, 34, 4);
  ctx.fillRect(12, 26, 22, 3);
  ctx.globalAlpha = 1;

  if (tone === "pass") {
    ctx.strokeStyle = "#effbef";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(58, 58);
    ctx.lineTo(86, 86);
    ctx.lineTo(138, 28);
    ctx.stroke();
  } else if (tone === "fail") {
    ctx.strokeStyle = "#ffe9e1";
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(66, 30);
    ctx.lineTo(126, 88);
    ctx.moveTo(126, 30);
    ctx.lineTo(66, 88);
    ctx.stroke();
  } else {
    const rows = activity === "read" ? [40, 55, 70, 85] : [34, 49, 64, 79, 94];
    for (let i = 0; i < rows.length; i += 1) {
      ctx.fillStyle = i % 3 === 0 ? accent : "rgba(233,244,226,0.64)";
      ctx.globalAlpha = i === rows.length - 1 ? 0.6 : 1;
      const width = i === 0 ? 78 : i % 2 === 0 ? 116 : 94;
      ctx.fillRect(22, rows[i], width, 6);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.fillRect(22, 100, 12, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A low-poly seated employee, back view. The Blender room owns desks and
 * chairs; these primitives are the live employee layer (role colour, posture
 * and busy state), so the office stays alive without a full skeletal rig.
 * @param {{ id: number, name: string, roleSnapshot: { key: string } }} occupant
 */
/** A soft daylight view behind the modelled window frame. */
function windowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const sky = ctx.createLinearGradient(0, 0, 0, 192);
  sky.addColorStop(0, "#8fb9cc");
  sky.addColorStop(0.55, "#c6dce0");
  sky.addColorStop(1, "#eef0df");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 384, 192);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  for (const [x, y, w, h] of [[34, 54, 90, 18], [80, 48, 45, 24], [240, 72, 76, 16], [270, 66, 34, 20]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#738f78";
  for (let i = 0; i < 12; i += 1) {
    const x = i * 34 - 8;
    const h = 18 + ((i * 37) % 28);
    ctx.fillRect(x, 192 - h, 30, h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A low-poly seated employee, back view. The Blender room owns desks and
 * chairs; these primitives are the live employee layer (role colour, posture
 * and busy state), so the office stays alive without a full skeletal rig.
 * @param {{ id: number, name: string, roleSnapshot: { key: string } }} occupant
 */
function buildAvatar(occupant) {
  const appearance = appearanceFor(occupant.roleSnapshot.key);
  const group = new THREE.Group();
  group.name = `Employee_${occupant.id}`;

  const top = new THREE.MeshStandardMaterial({ color: appearance.top, roughness: 0.92 });
  const skin = new THREE.MeshStandardMaterial({ color: appearance.skin, roughness: 0.82 });
  const hair = new THREE.MeshStandardMaterial({ color: appearance.hair, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202722, roughness: 0.65 });
  const phone = new THREE.MeshStandardMaterial({
    color: 0xdfe9f2,
    emissive: 0x9ec9f2,
    emissiveIntensity: 0.8,
    roughness: 0.35,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.30, 4, 10), top);
  torso.position.set(0, 0.88, 0);
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), hair);
  head.position.set(0, 1.22, 0.02);
  head.castShadow = true;
  group.add(head);
  // a sliver of skin beneath the hair, visible from the camera's high angle
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.10, 10), skin);
  neck.position.set(0, 1.09, 0.04);
  group.add(neck);

  const armGeo = new THREE.CapsuleGeometry(0.055, 0.28, 3, 8);
  /** @type {THREE.Mesh[]} */
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, top);
    arm.position.set(side * 0.18, 0.94, 0.06);
    arm.rotation.z = side * 0.72;
    arm.rotation.x = -0.35;
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
  }

  // role-readable details from behind: headset cups, a tie/scarf, glasses temples
  if (appearance.decor === "headset") {
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 10), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.13, 1.22, 0.01);
      group.add(cup);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16, Math.PI), dark);
    band.position.set(0, 1.22, 0.02);
    group.add(band);
  } else if (appearance.decor === "tie") {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.22, 0.02), new THREE.MeshStandardMaterial({ color: 0xc98a2c, roughness: 0.7 }));
    tie.position.set(0, 0.99, 0.16);
    group.add(tie);
  } else if (appearance.decor === "glasses") {
    for (const side of [-1, 1]) {
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, 0.10), dark);
      temple.position.set(side * 0.13, 1.21, 0.03);
      group.add(temple);
    }
  }

  // the phone glow is the only prop for the slack posture
  const phoneMesh = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.012), phone);
  phoneMesh.position.set(0, 0.91, 0.22);
  phoneMesh.visible = false;
  group.add(phoneMesh);

  return { group, arms, phone: phoneMesh, seatZ: 0.62 };
}

/**
 * @param {{
 *   desks: import("../App.jsx").DeskData[],
 *   deskStates: Map<number, import("../App.jsx").DeskState>,
 *   onProject: (positions: Record<number, { x: number, y: number, width: number, height: number, hitLeft: number, hitTop: number, clipPath: string }>, amenities: Record<string, { x: number, y: number }>) => void,
 *   onError?: (message: string) => void,
 *   controlsRef?: React.MutableRefObject<{ zoomIn: () => void, zoomOut: () => void, reset: () => void } | null>,
 *   onView?: (view: { zoom: number, percent: number, canZoomIn: boolean, canZoomOut: boolean }) => void,
 * }} props
 */
export function Office3D({ desks, deskStates, onProject, onError, controlsRef, onView }) {
  const hostRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const projectRef = React.useRef(onProject);
  projectRef.current = onProject;
  const errorRef = React.useRef(onError);
  errorRef.current = onError;
  const viewRef = React.useRef(onView);
  viewRef.current = onView;
  const apiRef = React.useRef(/** @type {any} */ (null));
  const desksRef = React.useRef(desks);
  const statesRef = React.useRef(deskStates);
  desksRef.current = desks;
  statesRef.current = deskStates;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const hostEl = host;
    let disposed = false;
    let raf = 0;
    let resizeObserver = null;

    /** @type {THREE.WebGLRenderer} */
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (err) {
      errorRef.current?.(err instanceof Error ? err.message : String(err));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    hostEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe8dfcf, 22, 42);
    const BASE_FOV = 34;
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 4;
    const ZOOM_STEP = 1.25;
    const CAMERA_DISTANCE = 17.5;
    const BASE_TARGET = new THREE.Vector3(0, 0.75, 2.2);
    // The room shell tops out around x=±4.7 and z=6.2. Keep the camera target
    // inside the useful furniture band so a fully zoomed view never wanders
    // into the empty world outside the dollhouse.
    const TARGET_BOUNDS = {
      minX: -4.25,
      maxX: 4.25,
      minY: 0.25,
      maxY: 2.5,
      minZ: 0.75,
      maxZ: 5.15,
    };
    const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 100);
    const target = BASE_TARGET.clone();
    // rear-right, high oblique: employees are seen from behind and the whole
    // 4×2 floor plan fits without cutting off the coffee/water corners.
    const cameraDirection = new THREE.Vector3(0.38, 0.48, 0.79).normalize();
    const cameraOffset = cameraDirection.clone().multiplyScalar(CAMERA_DISTANCE);
    camera.position.copy(target).add(cameraOffset);
    camera.lookAt(target);
    let zoom = MIN_ZOOM;

    // Soft studio lighting. The room plate carries most of the colour; these
    // lights give the mesh furniture readable form and contact shadows.
    scene.add(new THREE.HemisphereLight(0xfff0d8, 0x3b3328, 1.35));
    const sun = new THREE.DirectionalLight(0xffddb2, 2.2);
    sun.position.set(-7, 11, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xabc8d8, 0.7);
    fill.position.set(9, 7, 3);
    scene.add(fill);
    const windowLight = new THREE.PointLight(0xffd39a, 1.2, 18, 2);
    windowLight.position.set(-3, 3, 0.5);
    scene.add(windowLight);

    /** @type {Record<number, { x: number, y: number, width: number, height: number, hitLeft: number, hitTop: number, clipPath: string }>} */
    let projected = {};
    /** @type {Map<number, any>} */
    const avatars = new Map();
    /** @type {Map<number, THREE.Object3D[]>} */
    const deskObjects = new Map();
    /** @type {Map<number, { mesh: THREE.Mesh, material: THREE.MeshBasicMaterial, texture: THREE.Texture | null, key: string }>} */
    const screens = new Map();

    /** Show only the bays a project group actually owns.
     * @param {number} count
     */
    function setDeskVisibility(count) {
      for (const [index, objects] of deskObjects) {
        for (const object of objects) object.visible = index <= count;
      }
      for (const [index, screen] of screens) screen.mesh.visible = index <= count;
    }

    function projectDesks() {
      const width = hostEl.clientWidth;
      const height = hostEl.clientHeight;
      if (width === 0 || height === 0) return;
      camera.updateMatrixWorld();
      projected = {};
      const projectPoint = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
        const point = new THREE.Vector3(x, y, z);
        point.project(camera);
        return {
          x: Math.round((point.x * 0.5 + 0.5) * width),
          y: Math.round((-point.y * 0.5 + 0.5) * height),
        };
      };
      // The DOM label anchor stays at the desk's front-center. The hit shell is
      // a clipped quad of the projected desk top: a plain bounding box would
      // overlap the next desk at 400% and could make one label open another bay.
      const projectDeskHit = (/** @type {number} */ x, /** @type {number} */ z, /** @type {{ x: number, y: number }} */ anchor) => {
        const corners = [
          [x - 0.82, z - 0.48],
          [x + 0.82, z - 0.48],
          [x + 0.82, z + 0.48],
          [x - 0.82, z + 0.48],
        ].map(([px, pz]) => projectPoint(px, 0.74, pz));
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of corners) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        const clipPath = `polygon(${corners
          .map((point) => `${(((point.x - minX) / width) * 100).toFixed(1)}% ${(((point.y - minY) / height) * 100).toFixed(1)}%`)
          .join(", ")})`;
        return {
          width: Math.round(width),
          height: Math.round(height),
          hitLeft: Math.round(minX - anchor.x),
          hitTop: Math.round(minY - anchor.y),
          clipPath,
        };
      };
      desksRef.current.forEach((/** @type {any} */ desk, /** @type {number} */ index) => {
        const layout = DESK_LAYOUT[index];
        if (!layout) return;
        const anchor = projectPoint(layout.x, 0.94, layout.z + 0.30);
        const hit = projectDeskHit(layout.x, layout.z, anchor);
        projected[desk.id] = { ...anchor, ...hit };
      });
      projectRef.current(projected, {
        coffee: projectPoint(-4.22, 1.25, 5.0),
        water: projectPoint(-4.30, 1.72, 2.14),
      });
    }

    /** @param {number} value @param {number} min @param {number} max */
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function clampTarget() {
      target.x = clamp(target.x, TARGET_BOUNDS.minX, TARGET_BOUNDS.maxX);
      target.y = clamp(target.y, TARGET_BOUNDS.minY, TARGET_BOUNDS.maxY);
      target.z = clamp(target.z, TARGET_BOUNDS.minZ, TARGET_BOUNDS.maxZ);
    }

    function updateCamera() {
      camera.fov = BASE_FOV / zoom;
      camera.updateProjectionMatrix();
      camera.position.copy(target).add(cameraOffset);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    }

    function renderView() {
      updateCamera();
      projectDesks();
      renderer.render(scene, camera);
    }

    function notifyView() {
      const percent = Math.round(zoom * 100);
      viewRef.current?.({
        zoom,
        percent,
        canZoomIn: zoom < MAX_ZOOM - 0.0001,
        canZoomOut: zoom > MIN_ZOOM + 0.0001,
      });
    }

    /**
     * Zoom around a screen point. The anchor is projected onto the plane
     * through the current target; the target then shifts just enough to keep
     * that point under the cursor after the FOV changes. Clamping the target
     * inside the room makes the edge of the dollhouse a hard stop.
     * @param {number} nextZoom
     * @param {number} [clientX]
     * @param {number} [clientY]
     */
    function zoomAt(nextZoom, clientX, clientY) {
      const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(clamped - zoom) < 0.0005) return;
      const previousZoom = zoom;
      if (typeof clientX === "number" && typeof clientY === "number") {
        const rect = hostEl.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          camera.updateMatrixWorld();
          const halfHeight = CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
          const halfWidth = halfHeight * camera.aspect;
          const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
          const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const offset = right.multiplyScalar(ndcX * halfWidth).addScaledVector(up, ndcY * halfHeight);
          // Screen offset is proportional to world offset / visible width.
          // Shrink the old offset by the zoom ratio so the cursor point stays put.
          const ratio = clamped / previousZoom;
          target.addScaledVector(offset, 1 - 1 / ratio);
          clampTarget();
        }
      }
      zoom = clamped;
      renderView();
      notifyView();
    }

    /** @param {number} dx @param {number} dy */
    function panBy(dx, dy) {
      if (zoom <= MIN_ZOOM + 0.0001) return false;
      const viewportHeight = hostEl.clientHeight;
      if (viewportHeight === 0) return false;
      camera.updateMatrixWorld();
      const worldPerPixel = (2 * CAMERA_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewportHeight;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      target.addScaledVector(right, -dx * worldPerPixel);
      target.addScaledVector(up, dy * worldPerPixel);
      clampTarget();
      renderView();
      return true;
    }

    function zoomIn() {
      zoomAt(zoom * ZOOM_STEP);
    }

    function zoomOut() {
      zoomAt(zoom / ZOOM_STEP);
    }

    function resetView() {
      zoom = MIN_ZOOM;
      target.copy(BASE_TARGET);
      renderView();
      notifyView();
    }

    /** @param {import("../App.jsx").DeskData} desk @param {any} state @param {number} index */
    function syncOne(desk, state, index) {
      const layout = DESK_LAYOUT[index];
      if (!layout) return;
      const occupant = desk.occupant;
      if (occupant) {
        let avatar = avatars.get(desk.id);
        if (!avatar || avatar.employeeId !== occupant.id) {
          if (avatar) scene.remove(avatar.group);
          avatar = buildAvatar(occupant);
          avatar.employeeId = occupant.id;
          avatar.group.position.set(layout.x, 0.04, layout.z + 0.78);
          scene.add(avatar.group);
          avatars.set(desk.id, avatar);
        }
        const posture = state?.motion?.posture ?? "idle";
        const busy = state?.activity?.activity !== null && state?.activity?.activity !== undefined;
        avatar.group.visible = posture !== "coffee";
        avatar.group.position.set(layout.x, 0.04, layout.z + (posture === "slack" ? 0.86 : 0.78));
        avatar.group.rotation.x = posture === "slack" ? -0.12 : 0;
        avatar.phone.visible = posture === "slack";
        for (const arm of avatar.arms) arm.rotation.x = busy ? -0.55 : -0.35;
      } else {
        const avatar = avatars.get(desk.id);
        if (avatar) {
          scene.remove(avatar.group);
          avatars.delete(desk.id);
        }
      }

      // Dynamic monitor picture, painted on a JS plane just in front of the
      // Blender monitor. The GLB screen stays as the physical bezel/back.
      const screen = screens.get(index + 1);
      if (screen) {
        const tone = state?.activity?.screenTone ?? "idle";
        const activity = state?.activity?.activity ?? "idle";
        const key = `${tone}:${activity}`;
        if (screen.key !== key) {
          const texture = screenTexture(tone, activity);
          if (texture) {
            if (screen.texture) screen.texture.dispose();
            screen.texture = texture;
            screen.material.map = texture;
            screen.material.needsUpdate = true;
            screen.key = key;
          }
        }
      }
    }

    function sync(/** @type {import("../App.jsx").DeskData[]} */ nextDesks, /** @type {Map<number, any>} */ nextStates) {
      setDeskVisibility(nextDesks.length);
      const active = new Set(nextDesks.map((desk) => desk.id));
      for (const [deskId, avatar] of avatars) {
        if (active.has(deskId)) continue;
        scene.remove(avatar.group);
        avatars.delete(deskId);
      }
      nextDesks.forEach((desk, index) => syncOne(desk, nextStates.get(desk.occupant?.id ?? -1), index));
      renderer.render(scene, camera);
    }

    apiRef.current = { sync, project: projectDesks };
    if (controlsRef) controlsRef.current = { zoomIn, zoomOut, reset: resetView };
    notifyView();

    const loader = new GLTFLoader();
    loader.load(
      "./office/office.glb",
      (/** @type {any} */ gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((/** @type {any} */ node) => {
          if (/** @type {any} */ (node).isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        scene.add(model);
        model.traverse((/** @type {any} */ node) => {
          const match = /^Desk(\d+)_/.exec(node.name);
          if (!match) return;
          const index = Number(match[1]);
          if (!deskObjects.has(index)) deskObjects.set(index, []);
          deskObjects.get(index)?.push(node);
        });
        // live monitor planes (screen state per desk)
        for (let index = 0; index < DESK_LAYOUT.length; index += 1) {
          const layout = DESK_LAYOUT[index];
          const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.43), material);
          mesh.position.set(layout.x, 1.15, layout.z - 0.125);
          mesh.renderOrder = 3;
          scene.add(mesh);
          screens.set(index + 1, { mesh, material, texture: null, key: "" });
        }
        const sky = windowTexture();
        if (sky) {
          const skyMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2.52, 1.20),
            new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }),
          );
          skyMesh.position.set(-2.45, 2.62, 0.072);
          scene.add(skyMesh);
        }
        sync(desksRef.current, statesRef.current);
        projectDesks();
        renderer.render(scene, camera);
      },
      undefined,
      (/** @type {any} */ err) => {
        if (disposed) return;
        errorRef.current?.(err instanceof Error ? err.message : String(err));
      },
    );

    const resize = () => {
      const width = hostEl.clientWidth;
      const height = hostEl.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (apiRef.current) apiRef.current.project();
      renderer.render(scene, camera);
    };
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(hostEl);
    // A window resize does not always fire the element ResizeObserver before
    // the next React probe (observed on this Windows/Electron build). Belt and
    // braces: reproject from the window event too, coalesced to one frame.
    let resizeRaf = 0;
    const onWindowResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(resize);
    };
    window.addEventListener("resize", onWindowResize);
    resize();

    const room = hostEl.parentElement;
    /** @type {{ id: number, startX: number, startY: number, lastX: number, lastY: number, moved: boolean } | null} */
    let activePointer = null;
    let suppressClickUntil = 0;

    /** @param {EventTarget | null} target */
    function isZoomControl(target) {
      return target instanceof Element && target.closest(".zoom-controls") !== null;
    }

    /** @param {WheelEvent} event */
    function onWheel(event) {
      if (event.deltaY === 0 || isZoomControl(event.target)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? hostEl.clientHeight : 1);
      const bounded = Math.max(-480, Math.min(480, delta));
      event.preventDefault();
      zoomAt(zoom * Math.exp(-bounded * 0.0012), event.clientX, event.clientY);
    }

    /** @param {PointerEvent} event */
    function onPointerDown(event) {
      if (event.button !== 0 || zoom <= MIN_ZOOM + 0.0001 || isZoomControl(event.target)) return;
      activePointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
    }

    /** @param {PointerEvent} event */
    function onPointerMove(event) {
      if (!activePointer || event.pointerId !== activePointer.id) return;
      const totalDx = event.clientX - activePointer.startX;
      const totalDy = event.clientY - activePointer.startY;
      if (!activePointer.moved) {
        if (Math.hypot(totalDx, totalDy) < 5) return;
        activePointer.moved = true;
        room?.classList.add("room-panning");
        try {
          room?.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointers (and some pen/touch stacks) may not own an
          // active pointer; the window-level listeners below still finish it.
        }
      }
      event.preventDefault();
      const dx = event.clientX - activePointer.lastX;
      const dy = event.clientY - activePointer.lastY;
      activePointer.lastX = event.clientX;
      activePointer.lastY = event.clientY;
      panBy(dx, dy);
    }

    /** @param {PointerEvent} event */
    function finishPointer(event) {
      if (!activePointer || event.pointerId !== activePointer.id) return;
      if (activePointer.moved) suppressClickUntil = performance.now() + 200;
      activePointer = null;
      room?.classList.remove("room-panning");
      try {
        room?.releasePointerCapture(event.pointerId);
      } catch {
        // already released or synthetic pointer
      }
    }

    /** @param {MouseEvent} event */
    function onClickCapture(event) {
      if (performance.now() >= suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
    }

    /** @param {MouseEvent} event */
    function onDoubleClick(event) {
      if (isZoomControl(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".desk")) return;
      resetView();
    }

    room?.addEventListener("wheel", onWheel, { passive: false });
    room?.addEventListener("pointerdown", onPointerDown);
    room?.addEventListener("click", onClickCapture, true);
    room?.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", finishPointer, true);
    window.addEventListener("pointercancel", finishPointer, true);

    const animate = () => {
      raf = requestAnimationFrame(animate);
      // gentle idle bob for the whole office; avatars keep their own posture
      const now = performance.now();
      for (const avatar of avatars.values()) {
        const occupant = desksRef.current.find((desk) => desk.occupant?.id === avatar.employeeId)?.occupant;
        if (!occupant) continue;
        const state = statesRef.current.get(occupant.id);
        const busy = state?.activity?.activity !== null && state?.activity?.activity !== undefined;
        avatar.group.position.y = busy ? Math.sin(now / 130 + avatar.employeeId) * 0.006 : 0;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      room?.removeEventListener("wheel", onWheel);
      room?.removeEventListener("pointerdown", onPointerDown);
      room?.removeEventListener("click", onClickCapture, true);
      room?.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", finishPointer, true);
      window.removeEventListener("pointercancel", finishPointer, true);
      for (const avatar of avatars.values()) scene.remove(avatar.group);
      scene.clear();
      renderer.dispose();
      renderer.domElement.remove();
      apiRef.current = null;
      if (controlsRef) controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (apiRef.current) apiRef.current.sync(desks, deskStates);
  }, [desks, deskStates]);

  return <div className="office-3d" data-testid="office-3d" data-desk-count={desks.length} ref={hostRef} />;
}
