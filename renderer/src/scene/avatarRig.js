/**
 * The employee rig — a small, jointed low-poly person for the 3D office.
 *
 * Ticket 18 replaced the old "torso capsule + floating head" blob with a real
 * hierarchy: hips → torso → shoulders → arms, and hips → thighs → shins →
 * feet. Every joint is a pivot, so one rig both sits in the chair (thighs
 * forward, shins down, hands on the keyboard) and walks the aisles without
 * swapping models — that is what stops the chair/desk clipping.
 *
 * All measurements are metres, tuned to the Blender room: seat top 0.58,
 * desk top 0.74, chair back z+0.72…0.81. The rig's forward is -z (they face
 * the monitor), so the camera behind them sees their back and hair.
 *
 * @typedef {import("./employeeLook.js").EmployeeLook} EmployeeLook
 * @typedef {"sit" | "walk" | "stand"} RigMode
 * @typedef {{ x: number, z: number }} RigPosition
 */

import * as THREE from "three";

/** Joint heights and lengths, in one place so the poses stay consistent. */
export const RIG = {
  seatedHipY: 0.6,
  standingHipY: 1.02,
  thigh: 0.44,
  shin: 0.5,
  // Torso long enough that the shoulders clear the 1.09 m chair backrest —
  // the old short torso left only a floating head above the chair.
  shoulderY: 0.55,
  headY: 0.72,
  upperArm: 0.32,
  forearm: 0.3,
};

/** @param {EmployeeLook["build"]} build @returns {number} */
function torsoRadius(build) {
  if (build === "slim") return 0.132;
  if (build === "broad") return 0.168;
  return 0.15;
}

/**
 * @param {string | number} color
 * @param {number} [roughness]
 */
function mat(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

/**
 * Build one employee. The caller positions the group and picks the pose each
 * frame; nothing here reads React state.
 *
 * @param {EmployeeLook} look
 */
export function buildAvatarRig(look) {
  const group = new THREE.Group();
  group.name = `Employee_${look.id}`;

  const skin = mat(look.skin, 0.78);
  const shirt = mat(look.top, 0.9);
  const trouser = mat(look.bottom, 0.92);
  const shoe = mat(look.shoes, 0.7);
  const hair = mat(look.hair, 0.86);
  const dark = mat(0x24282c, 0.6);
  const radius = torsoRadius(look.build) * look.height;

  // ── hips + torso ────────────────────────────────────────────────────────
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.86, 0.09, 3, 12), trouser);
  hips.rotation.z = Math.PI / 2;
  hips.position.set(0, 0.02, 0);
  hips.scale.set(1, 1, 0.82);
  hips.castShadow = true;
  group.add(hips);

  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 0.06, 0);
  group.add(torsoPivot);

  // Tapered body: wider at the chest than the waist reads as a person, not a pill.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.02, radius * 0.86, RIG.shoulderY * look.height, 14, 1),
    shirt,
  );
  torso.position.set(0, RIG.shoulderY * 0.5 * look.height, 0);
  torso.castShadow = true;
  torsoPivot.add(torso);

  // rounded shoulders, so the silhouette does not end in a hard cylinder cut
  const shoulders = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.52, radius * 1.75, 3, 10),
    shirt,
  );
  shoulders.rotation.z = Math.PI / 2;
  shoulders.position.set(0, RIG.shoulderY * look.height - 0.02, 0);
  shoulders.scale.set(1, 1, 0.9);
  shoulders.castShadow = true;
  torsoPivot.add(shoulders);

  // collar
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.5, radius * 0.62, 0.035, 12),
    mat(new THREE.Color(look.top).offsetHSL(0, -0.05, 0.12).getStyle()),
  );
  collar.position.set(0, RIG.shoulderY * look.height + 0.005, 0);
  torsoPivot.add(collar);

  // ── head ────────────────────────────────────────────────────────────────
  const headPivot = new THREE.Group();
  headPivot.position.set(0, RIG.shoulderY * look.height + 0.05, 0);
  torsoPivot.add(headPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.08, 10), skin);
  neck.position.set(0, 0.02, 0);
  headPivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin);
  head.scale.set(1, 1.08, 1.02);
  head.position.set(0, 0.15, -0.005);
  head.castShadow = true;
  headPivot.add(head);

  // ears — a tiny detail that makes the head read as a head from the side
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), skin);
    ear.position.set(side * 0.102, 0.15, 0.005);
    ear.scale.set(0.6, 1, 0.8);
    headPivot.add(ear);
  }

  // hair: a cap plus a style-specific mass behind the head
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.113, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hair,
  );
  cap.position.set(0, 0.152, 0.004);
  cap.scale.set(1, 1.02, 1.04);
  cap.castShadow = true;
  headPivot.add(cap);

  if (look.hairStyle === "buzz") {
    cap.scale.set(1.0, 0.86, 1.0);
    cap.position.y = 0.158;
  } else if (look.hairStyle === "bun") {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), hair);
    bun.position.set(0, 0.2, 0.104);
    headPivot.add(bun);
  } else if (look.hairStyle === "ponytail") {
    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.16, 3, 8), hair);
    tail.position.set(0, 0.1, 0.118);
    tail.rotation.x = -0.35;
    headPivot.add(tail);
  } else if (look.hairStyle === "long") {
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.076, 0.15, 3, 10), hair);
    back.position.set(0, 0.06, 0.068);
    back.scale.set(1, 1, 0.7);
    headPivot.add(back);
  } else if (look.hairStyle === "curly") {
    for (const [cx, cy, cz, r] of [
      [-0.068, 0.225, 0.01, 0.055],
      [0.068, 0.225, 0.01, 0.055],
      [0, 0.248, 0.035, 0.058],
      [-0.045, 0.235, 0.09, 0.05],
      [0.045, 0.235, 0.09, 0.05],
    ]) {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), hair);
      curl.position.set(cx, cy, cz);
      headPivot.add(curl);
    }
  }

  // ── decor ───────────────────────────────────────────────────────────────
  if (look.decor === "glasses") {
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 5, 12), dark);
      lens.position.set(side * 0.043, 0.152, -0.1);
      headPivot.add(lens);
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.1), dark);
      temple.position.set(side * 0.097, 0.155, -0.045);
      headPivot.add(temple);
    }
  } else if (look.decor === "headset") {
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.03, 12), dark);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.108, 0.15, 0.01);
      headPivot.add(cup);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.011, 6, 18, Math.PI), dark);
    band.position.set(0, 0.16, 0.01);
    headPivot.add(band);
  } else if (look.decor === "cap") {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.104, 0.012, 14, 1, false, 0, Math.PI), dark);
    brim.position.set(0, 0.2, -0.05);
    brim.rotation.x = -0.05;
    brim.scale.set(1, 1, 1.35);
    headPivot.add(brim);
  } else if (look.decor === "tie") {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.014), mat(0xb8863c, 0.62));
    tie.position.set(0, RIG.shoulderY * look.height - 0.16, -radius * 0.95);
    tie.rotation.x = 0.06;
    torsoPivot.add(tie);
  }

  /**
   * One arm: shoulder pivot → upper arm → elbow pivot → forearm + hand.
   * @param {number} side -1 left, 1 right
   */
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (radius * 0.92), RIG.shoulderY * look.height - 0.04, 0);
    torsoPivot.add(shoulder);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.046, RIG.upperArm - 0.092, 3, 10), shirt);
    upper.position.set(0, -RIG.upperArm / 2, 0);
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.set(0, -RIG.upperArm, 0);
    shoulder.add(elbow);

    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.039, RIG.forearm - 0.078, 3, 10), skin);
    fore.position.set(0, -RIG.forearm / 2, 0);
    fore.castShadow = true;
    elbow.add(fore);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.043, 10, 8), skin);
    hand.position.set(0, -RIG.forearm - 0.01, 0);
    hand.scale.set(0.9, 1.1, 0.75);
    elbow.add(hand);

    return { shoulder, elbow, hand };
  }

  const armL = buildArm(-1);
  const armR = buildArm(1);

  /**
   * One leg: hip pivot → thigh → knee pivot → shin + foot.
   * @param {number} side -1 left, 1 right
   */
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, -0.03, 0);
    group.add(hip);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.071, RIG.thigh - 0.142, 3, 12), trouser);
    thigh.position.set(0, -RIG.thigh / 2, 0);
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -RIG.thigh, 0);
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, RIG.shin - 0.104, 3, 10), trouser);
    shin.position.set(0, -RIG.shin / 2, 0);
    shin.castShadow = true;
    knee.add(shin);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.07, 0.22), shoe);
    foot.position.set(0, -RIG.shin - 0.015, -0.055);
    foot.castShadow = true;
    knee.add(foot);

    return { hip, knee, foot };
  }

  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // ── props ───────────────────────────────────────────────────────────────
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.145, 0.012),
    new THREE.MeshStandardMaterial({
      color: 0x1c2126,
      emissive: 0x9ec9f2,
      emissiveIntensity: 0.55,
      roughness: 0.32,
    }),
  );
  phone.visible = false;
  armR.elbow.add(phone);

  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.042, 0.034, 0.1, 12),
    mat(0xefe6d6, 0.55),
  );
  cup.visible = false;
  armR.elbow.add(cup);

  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.04, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0x7fc4dd, roughness: 0.22, transparent: true, opacity: 0.82 }),
  );
  const bottleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.03, 10), mat(0xd8e4ea, 0.5));
  bottleCap.position.y = 0.085;
  bottle.add(bottleCap);
  bottle.visible = false;
  armR.elbow.add(bottle);

  return {
    group,
    look,
    joints: { hips, torsoPivot, headPivot, armL, armR, legL, legR },
    props: { phone, cup, bottle },
  };
}

/** @param {THREE.Object3D} node @param {number} x @param {number} y @param {number} z */
function rot(node, x, y, z) {
  node.rotation.set(x, y, z);
}

/**
 * Small deterministic wobble so a still pose still breathes.
 * @param {number} now @param {number} period @param {number} amplitude
 */
function breathe(now, period, amplitude) {
  return Math.sin(now / period) * amplitude;
}

/**
 * Pose the rig for one instant.
 *
 * The pose is decided as joint angles first, then applied once — that way the
 * held props (phone, cup, bottle) can counter-rotate against the arm and stay
 * upright in the world, which a per-branch early return made impossible.
 *
 * @param {ReturnType<typeof buildAvatarRig>} rig
 * @param {{
 *   mode: RigMode,
 *   posture: string,
 *   walking: boolean,
 *   carrying: "coffee" | "water" | null,
 *   now: number,
 * }} input
 */
export function poseRig(rig, { mode, posture, walking, carrying, now }) {
  const { torsoPivot, headPivot, armL, armR, legL, legR } = rig.joints;
  const { phone, cup, bottle } = rig.props;

  /** @type {{ lean: number, headX: number, armL: [number, number, number], armR: [number, number, number], elbowL: number, elbowR: number, hipL: [number, number, number], hipR: [number, number, number], kneeL: number, kneeR: number, prop: "phone" | "coffee" | "water" | null }} */
  const pose = {
    lean: 0,
    headX: 0,
    armL: [0, 0, -0.08],
    armR: [0, 0, 0.08],
    elbowL: 0.1,
    elbowR: 0.1,
    hipL: [0, 0, -0.02],
    hipR: [0, 0, 0.02],
    kneeL: 0,
    kneeR: 0,
    prop: null,
  };

  if (mode === "walk" || walking) {
    const swing = Math.sin(now / 95) * 0.55;
    pose.hipL = [swing, 0, -0.02];
    pose.hipR = [-swing, 0, 0.02];
    pose.kneeL = -Math.max(0, -swing) * 0.9;
    pose.kneeR = -Math.max(0, swing) * 0.9;
    pose.armL = [-swing * 0.7, 0, -0.1];
    pose.armR = [swing * 0.7, 0, 0.1];
    pose.elbowL = 0.25;
    pose.elbowR = 0.25;
    pose.lean = -0.04;
    pose.prop = carrying;
  } else if (mode === "stand") {
    // at the machine: knees soft, hands relaxed, a slow weight shift
    const sway = breathe(now, 900, 0.03);
    pose.hipL = [-0.03, 0, -0.02 + sway];
    pose.hipR = [0.03, 0, 0.02 - sway];
    pose.kneeL = 0.05;
    pose.kneeR = 0.05;
    pose.armL = [0.15, 0, -0.14];
    pose.armR = [0.15, 0, 0.14];
    pose.elbowL = 0.35;
    pose.elbowR = 0.35;
    pose.lean = 0.02;
    pose.prop = carrying;
  } else {
    // ── seated ───────────────────────────────────────────────────────────
    // Thighs forward onto the seat, shins down to the floor: the chair and the
    // body share the same volume instead of intersecting.
    pose.hipL = [1.42, 0.04, -0.03];
    pose.hipR = [1.42, -0.04, 0.03];
    pose.kneeL = -1.38;
    pose.kneeR = -1.38;
    pose.lean = 0.08;

    if (posture === "phone") {
      pose.lean = -0.14;
      pose.headX = 0.16;
      pose.armL = [0.82, 0, -0.3];
      pose.armR = [0.82, 0, 0.3];
      pose.elbowL = 1.42;
      pose.elbowR = 1.42;
      pose.prop = "phone";
    } else if (posture === "minesweeper") {
      const tap = Math.max(0, Math.sin(now / 160)) * 0.12;
      pose.armL = [0.62, 0, -0.14];
      pose.elbowL = 0.6;
      pose.armR = [0.66 + tap, 0, 0.2];
      pose.elbowR = 0.55 - tap;
      pose.headX = 0.06;
    } else if (posture === "coffee" || posture === "water") {
      const sip = Math.max(0, Math.sin(now / 1500)) ** 2;
      pose.armL = [0.55, 0, -0.14];
      pose.elbowL = 0.62;
      pose.armR = [0.55, 0, 0.2];
      pose.elbowR = 0.85 + sip * 1.1;
      pose.headX = -sip * 0.1;
      pose.prop = posture;
    } else if (posture === "work") {
      const typing = breathe(now, 130, 0.04);
      pose.armL = [0.62 + typing, 0, -0.16];
      pose.armR = [0.62 - typing, 0, 0.16];
      pose.elbowL = 0.62;
      pose.elbowR = 0.62;
      pose.headX = 0.05;
    } else {
      const breath = breathe(now, 1300, 0.015);
      pose.lean = 0.08 + breath;
      pose.armL = [0.32, 0, -0.24];
      pose.armR = [0.32, 0, 0.24];
      pose.elbowL = 0.95;
      pose.elbowR = 0.95;
    }
  }

  // ── apply ──────────────────────────────────────────────────────────────
  torsoPivot.rotation.set(pose.lean, 0, 0);
  headPivot.rotation.set(pose.headX, 0, 0);
  armL.shoulder.rotation.set(...pose.armL);
  armR.shoulder.rotation.set(...pose.armR);
  armL.elbow.rotation.set(pose.elbowL, 0, 0);
  armR.elbow.rotation.set(pose.elbowR, 0, 0);
  legL.hip.rotation.set(...pose.hipL);
  legR.hip.rotation.set(...pose.hipR);
  legL.knee.rotation.set(pose.kneeL, 0, 0);
  legR.knee.rotation.set(pose.kneeR, 0, 0);

  // Props ride in the right hand. They are children of the elbow joint, so
  // cancel the arm's X rotation to keep the cup upright and the phone facing
  // the employee instead of lying flat along the forearm.
  const armX = pose.armR[0] + pose.elbowR;
  const handY = -RIG.forearm - 0.03;
  phone.visible = pose.prop === "phone";
  cup.visible = pose.prop === "coffee";
  bottle.visible = pose.prop === "water";
  for (const prop of [phone, cup, bottle]) {
    prop.position.set(0.01, handY, 0.03);
    prop.rotation.set(-armX + 0.18, 0, 0);
  }
  if (pose.prop === "phone") {
    phone.rotation.set(-armX + 0.55, 0, 0);
    phone.position.set(0.0, handY - 0.02, 0.05);
  }
}
