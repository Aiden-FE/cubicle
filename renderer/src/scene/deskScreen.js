/**
 * Desk-screen model + canvas painter.
 *
 * The monitor is a small window into the employee's work:
 *   empty desk / company off duty -> black
 *   seated but not running            -> Windows desktop
 *   running                           -> code / office / terminal / test UI
 *
 * The screen is chosen from the same `DeskActivityState` + role snapshot as
 * the desk, so the 3D texture, the 2D fallback and e2e data-screen all agree.
 */

/**
 * @typedef {any} CanvasRenderingContext2D
 * @typedef {"black" | "desktop" | "code" | "office" | "terminal" | "test" | "test-pass" | "test-fail"} DeskScreenKind
 * @typedef {{ kind: DeskScreenKind }} DeskScreen
 */

/**
 * @param {{
 *   occupant: { roleSnapshot?: { key?: string } } | null,
 *   offDuty?: boolean,
 *   activity?: import("./deskActivity.js").DeskActivityState | null,
 * }} input
 * @returns {DeskScreen}
 */
export function screenForDesk({ occupant, offDuty = false, activity = null }) {
  if (!occupant || offDuty) return { kind: "black" };
  if (activity?.working !== true) return { kind: "desktop" };

  const tool = activity.activity;
  if (tool === "test") {
    if (activity.screenTone === "pass") return { kind: "test-pass" };
    if (activity.screenTone === "fail") return { kind: "test-fail" };
    return { kind: "test" };
  }
  if (tool === "exec") return { kind: "terminal" };

  const role = occupant.roleSnapshot?.key ?? "programmer";
  return { kind: role === "pm" ? "office" : "code" };
}

/**
 * Paint a monitor texture at the supplied canvas context. Pure drawing:
 * no DOM lookup, so this can be exercised in any browser-like canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {DeskScreenKind} kind
 * @param {number} [width]
 * @param {number} [height]
 */
export function paintDeskScreen(ctx, kind, width = 320, height = 180) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  switch (kind) {
    case "desktop":
      paintDesktop(ctx, width, height);
      break;
    case "code":
      paintCode(ctx, width, height);
      break;
    case "office":
      paintOffice(ctx, width, height);
      break;
    case "terminal":
      paintTerminal(ctx, width, height);
      break;
    case "test":
    case "test-pass":
    case "test-fail":
      paintTest(ctx, width, height, kind);
      break;
    case "black":
    default:
      paintBlack(ctx, width, height);
      break;
  }
  ctx.restore();
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function paintBlack(ctx, w, h) {
  ctx.fillStyle = "#020304";
  ctx.fillRect(0, 0, w, h);
  const glint = ctx.createLinearGradient(0, 0, w, h);
  glint.addColorStop(0, "rgba(125,155,170,0.08)");
  glint.addColorStop(0.35, "rgba(16,21,25,0)");
  glint.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, w, h);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function paintDesktop(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, w, h);
  sky.addColorStop(0, "#0b527f");
  sky.addColorStop(0.52, "#0a83a3");
  sky.addColorStop(1, "#082a4a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = "#b9f4f5";
  ctx.beginPath();
  ctx.ellipse(w * 0.78, h * 0.18, w * 0.45, h * 0.42, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d8fbff";
  ctx.beginPath();
  ctx.ellipse(w * 0.22, h * 0.1, w * 0.35, h * 0.24, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // desktop shortcuts: a folder, browser and a little app tile
  paintShortcut(ctx, 14, 12, "#e8b44a", "folder");
  paintShortcut(ctx, 14, 44, "#5bbad6", "browser");
  paintShortcut(ctx, 14, 76, "#7e9caf", "app");

  const barY = h - 24;
  ctx.fillStyle = "rgba(6,16,24,0.88)";
  ctx.fillRect(0, barY, w, 24);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, barY, w, 1);

  // Windows start mark
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      ctx.fillStyle = "#d9f4ff";
      ctx.fillRect(12 + col * 6, barY + 8 + row * 6, 4.5, 4.5);
    }
  }

  // search pill
  roundRect(ctx, 37, barY + 6, 48, 12, 6, "rgba(255,255,255,0.13)");
  ctx.fillStyle = "rgba(225,245,255,0.55)";
  ctx.fillRect(45, barY + 11, 22, 2);
  ctx.beginPath();
  ctx.arc(72, barY + 11, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // pinned apps
  const colors = ["#7b95a8", "#d9b14d", "#5e9dc0", "#8ab37a"];
  colors.forEach((color, index) => {
    roundRect(ctx, 104 + index * 22, barY + 7, 11, 11, 3, color);
  });

  ctx.font = '600 7px "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.textAlign = "right";
  ctx.fillText("10:24", w - 10, barY + 12);
  ctx.fillText("11/11", w - 10, barY + 20);
  ctx.textAlign = "left";
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y
 * @param {string} color
 * @param {"folder" | "browser" | "app"} icon
 */
function paintShortcut(ctx, x, y, color, icon) {
  if (icon === "folder") {
    roundRect(ctx, x, y + 3, 25, 17, 3, color);
    roundRect(ctx, x + 2, y, 11, 6, 2, "#f1ca6b");
  } else if (icon === "browser") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 12, y + 11, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x + 12, y + 11, 6.8, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    roundRect(ctx, x + 2, y + 2, 20, 20, 4, color);
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fillRect(x + 7, y + 8, 10, 2);
    ctx.fillRect(x + 7, y + 13, 7, 2);
  }
  ctx.fillStyle = "rgba(230,248,255,0.62)";
  ctx.fillRect(x + 3, y + 26, 19, 2);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function paintCode(ctx, w, h) {
  ctx.fillStyle = "#0d1219";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#141c26";
  ctx.fillRect(0, 0, 62, h);
  ctx.fillStyle = "#1b2633";
  ctx.fillRect(62, 0, w - 62, 20);

  ctx.fillStyle = "#7e91a5";
  ctx.fillRect(10, 10, 28, 3);
  ctx.fillRect(10, 19, 38, 2);
  ctx.fillRect(10, 29, 34, 2);
  ctx.fillRect(10, 39, 26, 2);
  ctx.fillStyle = "#9bc7d0";
  ctx.fillRect(10, 29, 2, 2);

  roundRect(ctx, 68, 5, 42, 15, 3, "#243549");
  ctx.fillStyle = "#c5e8ff";
  ctx.font = '600 7px "Cascadia Mono", Consolas, monospace';
  ctx.fillText("app.ts", 73, 15);
  ctx.fillStyle = "#607489";
  ctx.fillText("main.ts", 118, 15);

  /** @type {Array<[number, number, number, string, number]>} */
  const tokens = [
    [10, 34, 30, "#c792ea", 38],
    [10, 34, 78, "#82aaff", 58],
    [10, 34, 140, "#c3e88d", 45],
    [10, 48, 0, "#5f7e9b", 24],
    [10, 48, 32, "#c792ea", 40],
    [10, 48, 78, "#ffcb6b", 52],
    [10, 62, 18, "#89ddff", 30],
    [10, 62, 54, "#c3e88d", 62],
    [10, 76, 28, "#f07178", 44],
    [10, 76, 80, "#82aaff", 74],
    [10, 90, 42, "#c792ea", 38],
    [10, 104, 16, "#5f7e9b", 48],
    [10, 104, 70, "#ffcb6b", 48],
    [10, 118, 30, "#89ddff", 62],
    [10, 118, 98, "#c3e88d", 34],
  ];
  ctx.font = '600 6px "Cascadia Mono", Consolas, monospace';
  for (const [x, y, indent, color, length] of tokens) {
    ctx.fillStyle = color;
    ctx.fillRect(x + indent, y, length, 3);
  }
  ctx.fillStyle = "#4c6075";
  for (let line = 0; line < 8; line += 1) {
    ctx.fillRect(68, 33 + line * 14, 8, 2);
  }
  ctx.fillStyle = "#c3e88d";
  ctx.fillRect(170, 90, 3, 8);
  ctx.fillStyle = "#101c27";
  ctx.fillRect(0, h - 12, w, 12);
  ctx.fillStyle = "#79b8a4";
  ctx.font = '600 6px "Cascadia Mono", Consolas, monospace';
  ctx.fillText("main*  UTF-8  TypeScript", 10, h - 5);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function paintOffice(ctx, w, h) {
  ctx.fillStyle = "#d8d3c6";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2d6e9c";
  ctx.fillRect(0, 0, w, 24);
  ctx.fillStyle = "#e7f4fa";
  ctx.font = '600 9px "Segoe UI", sans-serif';
  ctx.fillText("Q3 Planning", 12, 15);

  // slide thumbnail rail
  for (let i = 0; i < 3; i += 1) {
    roundRect(ctx, 10, 36 + i * 42, 48, 30, 2, i === 0 ? "#fbfaf4" : "#e9e5da");
    ctx.fillStyle = i === 0 ? "#c3ad72" : "#b0a897";
    ctx.fillRect(15, 42 + i * 42, 24, 2);
    ctx.fillStyle = "#c8c2b5";
    ctx.fillRect(15, 48 + i * 42, 34, 2);
    ctx.fillRect(15, 53 + i * 42, 28, 2);
  }

  // document page
  ctx.fillStyle = "#fbfaf4";
  ctx.fillRect(70, 32, 238, 130);
  ctx.fillStyle = "#2e3a42";
  ctx.font = '700 16px "Segoe UI", sans-serif';
  ctx.fillText("Q3 product plan", 84, 55);
  ctx.fillStyle = "#7a817f";
  ctx.font = '600 7px "Segoe UI", sans-serif';
  ctx.fillText("OWNER  ·  Aiden", 84, 66);
  ctx.fillStyle = "#c8c4b8";
  for (let i = 0; i < 3; i += 1) ctx.fillRect(84, 76 + i * 7, 138 - i * 18, 2.5);

  const tableY = 100;
  const cols = [84, 130, 188, 238];
  ctx.fillStyle = "#2d6e9c";
  ctx.fillRect(84, tableY, 170, 15);
  ctx.fillStyle = "#dcecf3";
  for (const x of cols) ctx.fillRect(x + 4, tableY + 5, 28, 3);
  for (let row = 0; row < 4; row += 1) {
    ctx.fillStyle = row % 2 === 0 ? "#e9e6dc" : "#f4f1e9";
    ctx.fillRect(84, tableY + 15 + row * 12, 170, 12);
    ctx.fillStyle = "#a3a096";
    ctx.fillRect(88, tableY + 19 + row * 12, 28 + (row % 3) * 8, 2.5);
    ctx.fillRect(134, tableY + 19 + row * 12, 36, 2.5);
    ctx.fillRect(192, tableY + 19 + row * 12, 28, 2.5);
    ctx.fillRect(242, tableY + 19 + row * 12, 8, 2.5);
  }
  ctx.fillStyle = "#7d9b85";
  ctx.font = '600 7px "Segoe UI", sans-serif';
  ctx.fillText("On track", 84, 153);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h */
function paintTerminal(ctx, w, h) {
  ctx.fillStyle = "#070b10";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#18212b";
  ctx.fillRect(0, 0, w, 18);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = ["#ca6b5d", "#d7b65a", "#6eaa75"][i];
    ctx.beginPath();
    ctx.arc(10 + i * 9, 9, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#c8d4dc";
  ctx.font = '600 7px "Cascadia Mono", Consolas, monospace';
  ctx.fillText("PowerShell — C:\\work", 42, 12);

  ctx.font = '600 8px "Cascadia Mono", Consolas, monospace';
  ctx.fillStyle = "#80d49c";
  ctx.fillText("PS C:\\work>", 12, 36);
  ctx.fillStyle = "#e3edf2";
  ctx.fillText("npm test", 80, 36);
  ctx.fillStyle = "#7f8c96";
  ctx.fillText("> cubicle@0.1.0 test", 12, 51);
  ctx.fillText("> node --test ...", 12, 63);
  ctx.fillStyle = "#b3c4ce";
  ctx.fillText("PASS  shop.test.ts", 12, 79);
  ctx.fillText("PASS  office.test.ts", 12, 91);
  ctx.fillStyle = "#80d49c";
  ctx.fillText("Tests: 12 passed, 12 total", 12, 107);
  ctx.fillStyle = "#80d49c";
  ctx.fillRect(12, 122, 8, 10);
  ctx.fillStyle = "#d7e4e8";
  ctx.fillRect(24, 126, 44, 2.5);
}

/** @param {CanvasRenderingContext2D} ctx @param {number} w @param {number} h @param {string} kind */
function paintTest(ctx, w, h, kind) {
  const pass = kind === "test-pass";
  const fail = kind === "test-fail";
  const accent = pass ? "#6bc58b" : fail ? "#d36b56" : "#d7ad52";
  ctx.fillStyle = "#0b1015";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#171f28";
  ctx.fillRect(0, 0, w, 20);
  ctx.fillStyle = "#cbd8df";
  ctx.font = '600 7px "Cascadia Mono", Consolas, monospace';
  ctx.fillText("npm test", 12, 13);
  ctx.fillStyle = "#738493";
  ctx.fillText("watch", w - 36, 13);

  ctx.fillStyle = "#6c7e8b";
  ctx.font = '600 6px "Cascadia Mono", Consolas, monospace';
  for (let i = 0; i < 4; i += 1) {
    ctx.fillStyle = i === 0 ? accent : "#35424e";
    ctx.fillRect(12, 34 + i * 18, 5, 5);
    ctx.fillStyle = i === 0 ? "#c8d6dd" : "#687986";
    ctx.fillRect(23, 35 + i * 18, 94 - i * 9, 3);
    ctx.fillRect(124, 35 + i * 18, 24, 3);
  }

  ctx.fillStyle = "#19232d";
  ctx.fillRect(12, 108, w - 24, 8);
  ctx.fillStyle = accent;
  ctx.fillRect(14, 110, (w - 28) * (pass ? 1 : fail ? 0.42 : 0.66), 4);

  ctx.fillStyle = accent;
  ctx.font = '700 27px "Segoe UI", sans-serif';
  ctx.fillText(pass ? "PASS" : fail ? "FAIL" : "RUN", 12, 153);
  ctx.fillStyle = "#6d7f8b";
  ctx.font = '600 7px "Cascadia Mono", Consolas, monospace';
  ctx.fillText(pass ? "12 tests" : fail ? "3 tests failed" : "running...", 116, 147);
  ctx.fillStyle = "#8ea0ab";
  ctx.fillText("src/scene", 12, 171);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y
 * @param {number} width @param {number} height
 * @param {number} radius @param {string} color
 */
function roundRect(ctx, x, y, width, height, radius, color) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
