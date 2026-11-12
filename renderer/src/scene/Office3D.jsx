import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { buildAvatarRig, poseRig, RIG } from "./avatarRig.js";
import { lookFor } from "./employeeLook.js";
import {
  DESK_LAYOUT,
  ROOM,
  pointAlongRoute,
  walkDurationMs,
  walkRouteFor,
} from "./navigation.js";
import { paintDeskScreen, screenForDesk } from "./deskScreen.js";

/**
 * The eight desk bays in the Blender room. The layout lives in navigation.js
 * (the aisle graph depends on it); re-exported here because the scene and its
 * callers have always imported it from this module.
 */
export { DESK_LAYOUT };

/** Where the coffee trip ends: beside the left-front machine, clear of the counter. */
const COFFEE_STAND = { x: ROOM.coffeeStand.x, z: ROOM.coffeeStand.z };

/** @param {import("./deskScreen.js").DeskScreen} screen */
function screenTexture(screen) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  paintDeskScreen(ctx, screen.kind, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * A desk nameplate — the only place a person's name appears in the room
 * (ticket 18: no floating labels). A small angled plaque on the desk top,
 * painted with the employee's name so the office stays readable without any
 * overlay text.
 *
 * @param {string} name
 */
function buildNameplate(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  const group = new THREE.Group();
  if (!ctx) return { group, texture: null };

  // brushed brass face with an engraved, letter-spaced name
  const face = ctx.createLinearGradient(0, 0, 0, canvas.height);
  face.addColorStop(0, "#d9c393");
  face.addColorStop(0.5, "#c8ac74");
  face.addColorStop(1, "#b3945c");
  ctx.fillStyle = face;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(96,72,34,0.55)";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

  const label = String(name ?? "").trim() || "—";
  let size = 74;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  do {
    ctx.font = `600 ${size}px "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
    if (ctx.measureText(label).width <= canvas.width - 90) break;
    size -= 6;
  } while (size > 26);

  ctx.fillStyle = "rgba(255,248,230,0.55)";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4);
  ctx.fillStyle = "#4a3a1e";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.1, 0.022),
    [
      new THREE.MeshStandardMaterial({ color: 0x8d7444, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x8d7444, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x8d7444, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: 0x8d7444, roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: 0x7d6739, roughness: 0.55 }),
    ],
  );
  plaque.castShadow = true;
  plaque.rotation.x = -0.22;
  group.add(plaque);
  return { group, texture };
}

/**
 * Free the GPU resources of a removed employee (geometry, materials, the
 * nameplate's canvas texture). Called whenever a person leaves a desk or is
 * rebuilt with a different look.
 *
 * @param {{ group: THREE.Object3D, nameplate?: { group: THREE.Object3D, texture: THREE.Texture | null } | null }} avatar
 */
function disposeRig(avatar) {
  avatar.group.traverse((node) => {
    const mesh = /** @type {THREE.Mesh} */ (node);
    mesh.geometry?.dispose?.();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose?.());
    else material?.dispose?.();
  });
  if (avatar.nameplate) {
    avatar.nameplate.texture?.dispose?.();
    avatar.nameplate.group.traverse((node) => {
      const mesh = /** @type {THREE.Mesh} */ (node);
      mesh.geometry?.dispose?.();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          const mapped = /** @type {any} */ (entry);
          if (mapped.map) mapped.map = null;
          entry.dispose?.();
        }
      } else {
        const mapped = /** @type {any} */ (material);
        if (mapped?.map) mapped.map = null;
        material?.dispose?.();
      }
    });
  }
}

/**
 * @param {{
 *   desks: import("../App.jsx").DeskData[],
 *   deskStates: Map<number, import("../App.jsx").DeskState>,
 *   onProject: (positions: Record<number, { x: number, y: number, width: number, height: number, hitLeft: number, hitTop: number, clipPath: string }>) => void,
 *   offDuty?: boolean,
 *   showNameplates?: boolean,
 *   onError?: (message: string) => void,
 *   controlsRef?: React.MutableRefObject<{ zoomIn: () => void, zoomOut: () => void, reset: () => void } | null>,
 *   onView?: (view: { zoom: number, percent: number, canZoomIn: boolean, canZoomOut: boolean }) => void,
 * }} props
 */
export function Office3D({ desks, deskStates, onProject, offDuty = false, showNameplates = true, onError, controlsRef, onView }) {
  const hostRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const projectRef = React.useRef(onProject);
  projectRef.current = onProject;
  const errorRef = React.useRef(onError);
  errorRef.current = onError;
  const viewRef = React.useRef(onView);
  viewRef.current = onView;
  const offDutyRef = React.useRef(offDuty);
  offDutyRef.current = offDuty;
  const platesRef = React.useRef(showNameplates);
  platesRef.current = showNameplates;
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
      projectRef.current(projected);
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

    /**
     * Place one employee for this frame.
     *
     * Seated: hips at the chair, facing the monitor. Walking: the aisle route
     * from navigation.js, step by step, facing down the path. The phase
     * timestamps are the same values the state machine used, so the body and
     * the monitor can never disagree about what is happening.
     *
     * @param {any} avatar
     * @param {number} deskIndex
     * @param {import("../App.jsx").DeskState | null} state
     * @param {number} now
     */
    function placeAvatar(avatar, deskIndex, state, now) {
      const layout = DESK_LAYOUT[deskIndex];
      if (!layout) return;
      const motion = state?.motion;
      const posture = motion?.posture ?? "idle";
      const phase = motion?.tripPhase ?? null;
      const destination = motion?.destination ?? null;
      const started = motion?.phaseStartedAt ?? motion?.anchor ?? now;
      const seatedZ = layout.z + ROOM.chairZ;
      const seated = { x: layout.x, z: seatedZ };

      let mode = /** @type {import("./avatarRig.js").RigMode} */ ("sit");
      let x = seated.x;
      let z = seated.z;
      let y = RIG.seatedHipY;
      let yaw = 0;
      let carrying = /** @type {null | "coffee" | "water"} */ (null);
      let walking = false;

      if (posture === "coffee" || posture === "water") {
        const target = destination ?? posture;
        const route = walkRouteFor(deskIndex, target);
        const walkMs = walkDurationMs(deskIndex, target);
        const stand = target === "coffee" ? ROOM.coffeeStand : ROOM.waterStand;
        if (phase === "to-target" || phase === "returning") {
          const elapsed = Math.max(0, now - started);
          const progress = Math.min(1, elapsed / walkMs);
          const t = phase === "returning" ? 1 - progress : progress;
          const point = pointAlongRoute(route, t);
          x = point.x;
          z = point.z;
          y = RIG.standingHipY;
          // a gentle sway while walking; the route heading wins on long legs
          yaw = point.facing;
          mode = "walk";
          walking = true;
          carrying = phase === "returning" ? target : null;
        } else if (phase === "at-target") {
          x = stand.x;
          z = stand.z;
          y = RIG.standingHipY;
          yaw = stand.facing;
          mode = "stand";
          carrying = target;
        }
        if (phase === "sipping") {
          carrying = target;
        }
      }

      avatar.group.position.set(x, y, z);
      avatar.group.rotation.y = yaw;
      poseRig(avatar.rig, { mode, posture, walking, carrying, now });

      // A small bob sells the walk without moving the feet through the floor.
      if (walking) {
        avatar.group.position.y += Math.abs(Math.sin(now / 95)) * 0.018;
      }
    }

    /** @param {import("../App.jsx").DeskData} desk @param {any} state @param {number} index */
    function syncOne(desk, state, index) {
      const layout = DESK_LAYOUT[index];
      if (!layout) return;
      const occupant = desk.occupant;
      if (occupant) {
        let avatar = avatars.get(desk.id);
        const look = lookFor(occupant);
        if (!avatar || avatar.employeeId !== occupant.id || avatar.lookId !== look.id) {
          if (avatar) {
            scene.remove(avatar.group);
            disposeRig(avatar);
          }
          const rig = buildAvatarRig(look);
          avatar = { group: rig.group, rig, lookId: look.id, employeeId: occupant.id, nameplate: null };
          scene.add(rig.group);
          avatars.set(desk.id, avatar);
        }
        if (!avatar.nameplate || avatar.name !== occupant.name) {
          if (avatar.nameplate) {
            scene.remove(avatar.nameplate.group);
            avatar.nameplate.texture?.dispose?.();
          }
          const plate = buildNameplate(occupant.name);
          plate.group.position.set(layout.x + 0.52, 0.795, layout.z + 0.3);
          plate.group.rotation.y = 0.16;
          scene.add(plate.group);
          avatar.nameplate = plate;
          avatar.name = occupant.name;
        }
        avatar.nameplate.group.visible = platesRef.current;
        placeAvatar(avatar, index, state, Date.now());
      } else {
        const avatar = avatars.get(desk.id);
        if (avatar) {
          scene.remove(avatar.group);
          disposeRig(avatar);
          avatars.delete(desk.id);
        }
      }

      // Dynamic monitor picture, painted on a JS plane just in front of the
      // Blender monitor. Empty desks and off-duty offices get a truly black
      // screen; a seated idle/slacking employee sees the Windows desktop.
      const screen = screens.get(index + 1);
      if (screen) {
        const model = screenForDesk({
          occupant,
          offDuty: offDutyRef.current,
          activity: state?.activity ?? null,
        });
        if (screen.key !== model.kind) {
          const texture = screenTexture(model);
          if (texture) {
            if (screen.texture) screen.texture.dispose();
            screen.texture = texture;
            screen.material.map = texture;
            screen.material.color.set(0xffffff);
            screen.material.needsUpdate = true;
            screen.key = model.kind;
          }
        }
      }
    }

    function sync(/** @type {import("../App.jsx").DeskData[]} */ nextDesks, /** @type {Map<number, any>} */ nextStates, /** @type {boolean} */ nextOffDuty = offDutyRef.current) {
      offDutyRef.current = nextOffDuty;
      setDeskVisibility(nextDesks.length);
      const active = new Set(nextDesks.map((desk) => desk.id));
      for (const [deskId, avatar] of avatars) {
        if (active.has(deskId)) continue;
        scene.remove(avatar.group);
        disposeRig(avatar);
        avatars.delete(deskId);
      }
      nextDesks.forEach((desk, index) => syncOne(desk, nextStates.get(desk.occupant?.id ?? -1), index));
      renderer.render(scene, camera);
    }

    apiRef.current = { sync, project: projectDesks, nameplates: () => [...avatars.values()] };
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
          const material = new THREE.MeshBasicMaterial({ color: 0x050607, toneMapped: false });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.43), material);
          mesh.position.set(layout.x, 1.15, layout.z - 0.125);
          mesh.renderOrder = 3;
          scene.add(mesh);
          screens.set(index + 1, { mesh, material, texture: null, key: "" });
        }
        // The window sky/skyline is modelled in office.glb (an emissive sky
        // plane, trees and clouds), so the scene does not paint a second one.
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
    // the next React probe (observed on this Windows/Electron build), and a
    // hidden/lost display surface can stall requestAnimationFrame. Resize
    // synchronously; the rAF is only a follow-up for a late layout pass.
    let resizeRaf = 0;
    const onWindowResize = () => {
      resize();
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
      // Continuous avatar motion: walk interpolation, breathing, phone sway and
      // minesweeper taps. React only changes posture/phase; this loop owns the
      // frame-level interpolation.
      const now = Date.now();
      const desks = desksRef.current;
      for (let index = 0; index < desks.length; index += 1) {
        const desk = desks[index];
        const avatar = avatars.get(desk.id);
        if (!avatar) continue;
        const state = desk.occupant ? statesRef.current.get(desk.occupant.id) ?? null : null;
        placeAvatar(avatar, index, state, now);
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
    if (apiRef.current) apiRef.current.sync(desks, deskStates, offDuty);
  }, [desks, deskStates, offDuty]);

  // 票 18: the nameplate is a physical object now, so the 名牌 preference hides
  // it in the scene instead of a DOM label.
  useEffect(() => {
    for (const avatar of apiRef.current?.nameplates() ?? []) {
      if (avatar.nameplate) avatar.nameplate.group.visible = showNameplates;
    }
  }, [showNameplates]);

  return <div className="office-3d" data-testid="office-3d" data-desk-count={desks.length} ref={hostRef} />;
}
