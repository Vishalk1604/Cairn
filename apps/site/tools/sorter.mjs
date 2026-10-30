// Fig 1 on the home page: Cairn's server drawn as a sorting cabinet, built
// with the anatomy kit (MIT, see kit/LICENSE). Every ten minutes the dial
// comes round, the gate under the front letter opens, the letter is read under
// the lamp and drops into one drawer: Important, Classroom or Everything else.
// A flag goes up for anything that sends a notification.
//
//   node tools/sorter.mjs                 rebuild the figure into public/
//   node tools/sorter.mjs --page out.html also write a standalone page to check
//
// Writes the card between the sorter markers in public/index.html, the live
// code to public/assets/sorter.js and the kit's styles to public/assets/iso.css.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const kitScript = () => readFileSync(join(HERE, "kit", "iso-kit.mjs"), "utf8").replace(/^export /gm, "");

const WIDTH = 640;
const HEIGHT = 420;

// World, in units of about a pixel: x along the cabinet, y towards the drawers, z up.
const PLATE = { x: -150, y: -66, w: 300, d: 132, r: 8 };
const PLATE_H = 10;
const FOOT_H = 5;
const CAB = { x: -104, y: -42, w: 208, d: 58, r: 3 };
const FACE = CAB.y + CAB.d; // the drawer face, y = 16
const BODY_Z = 5;
const LID = { x: -106, y: -44, w: 212, d: 62, r: 3.5 };
const LID_Z = 66;
const TOP = 69;

// Drawers: three across the face, each slides out along +y.
const DRAWER_W = 60;
const DRAWERS = [-96, -30, 36];
const PANEL_Z = [13, 24]; // a low lip, so the letters in a tray show
const OPENING_Z = [13.5, 57.5];
const WALL_H = 8;
const PANEL_D = 3;
const FLOOR_Z = 14;
const OPEN = 26;
const PEEK = 14;
const NAMES = ["Important", "Classroom", "Everything else"];

// The magazine on the lid: letters stand in a row, the front one on the gate over the slot.
const SLOT = { x: -24, y: -14.4, w: 48, d: 3.6, r: 1 };
const GROOVE = { x: -28.4, y: -15.6, w: 106, d: 6, r: 1.2 };
const GATE = { x: -27, y: -15, w: 54, d: 4.8, r: 0.8 };
const GATE_TRAVEL = 50;
const BASE = { x: -30, y: -40, w: 60, d: 24, r: 1.2 }; // front edge at y = -16
const BASE_TOP = TOP + 1.6;
const GATE_TOP = TOP + 1;
const LETTER = { w: 44, t: 1.2, h: 24 };
const SLOTS_Y = [-12.6, -17, -20.2, -23.4]; // letter centres, front first
const FOLLOWER = { x: -12, w: 24, d: 4, h: 13 };
const FOLLOWER_REST = SLOTS_Y[3] - LETTER.t / 2 - 0.4;
const FOLLOWER_STOP = BASE.y + BASE.d - 0.6;

// The lamp that reads each letter, the dial that counts ten minutes, the flag.
const LAMP = { post: [-40, -12.6], head: [0, -12.6], armZ: 104 };
const DIAL = { at: [-80, -2], r: 15, z: TOP + 2, h: 7 };
const DIAL_TOP = DIAL.z + DIAL.h;
const FLAG = { post: [86, -4], low: TOP + 3.4, lift: 15, top: 100 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...k.boxCorners(LID, LID_Z, TOP), [LAMP.post[0], LAMP.post[1], LAMP.armZ + 3.4], [FLAG.post[0] + 20, FLAG.post[1], FLAG.top], [0, FACE + PANEL_D + OPEN + 6, PANEL_Z[1]]],
  WIDTH,
  HEIGHT,
  { pad: 34, azimuth: 58 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const quad = (corners) => k.pathOf(corners.map(at), true);
// A line across a vertical face at y, from x0 to x1 at height z.
const faceLine = (y, x0, x1, z) => k.segment([x0, y, z], [x1, y, z], P);

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // A ruler along the front, ten majors for the ten minutes.
  const strip = { x: -132, y: PLATE.y + PLATE.d - 16, w: 200, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 3.84, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));
  // The maker's plate, with the one engraved word.
  const label = { x: 82, y: PLATE.y + PLATE.d - 22, w: 52, d: 14, r: 1.6 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 4), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.8, P), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([label.x + 6, label.y + 7.4], 0.8, P, "x"), "CAIRN", { size: 4.2, tone: "mid" }));
  out.push(L(k.lineOnTop([label.x + 6, label.y + 10.4], [label.x + 30, label.y + 10.4], 0.8, P), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 4, label.y + 4, 0.8]), at([label.x + label.w - 4, label.y + label.d - 4, 0.8])], { size: 0.45 }));
  return out.join("");
}

function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, 4), 0, 2, P)}" style="filter:blur(6px)"/>`];
  out.push(S(k.slabOf(k.insetPlan(CAB, 3), 0, BODY_Z, P, 4, 0.4), { tone: "lo" }));
  out.push(S(k.slabOf(CAB, BODY_Z, LID_Z - BODY_Z, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(CAB, BODY_Z + 3.2, P, 4), { tone: "faint" }) }));
  // Three pigeonholes, dark inside; a letter tray runs in the bottom of each.
  for (const dx of DRAWERS) {
    out.push(`<path class="sorter-void" d="${quad([[dx + 1.5, FACE, OPENING_Z[0]], [dx + DRAWER_W - 1.5, FACE, OPENING_Z[0]], [dx + DRAWER_W - 1.5, FACE, OPENING_Z[1]], [dx + 1.5, FACE, OPENING_Z[1]]])}"/>`);
    out.push(L(quad([[dx + 1.5, FACE, OPENING_Z[0]], [dx + DRAWER_W - 1.5, FACE, OPENING_Z[0]], [dx + DRAWER_W - 1.5, FACE, OPENING_Z[1]], [dx + 1.5, FACE, OPENING_Z[1]]]), { tone: "lo" }));
  }
  // The lid, with the slot and the groove the gate runs in.
  out.push(S(k.slabOf(LID, LID_Z, TOP - LID_Z, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(GROOVE, TOP, P, 3), { tone: "lo" }));
  out.push(`<path class="sorter-void" d="${k.planOutline(SLOT, TOP, P, 3)}"/>`);
  out.push(L(k.planOutline(SLOT, TOP, P, 3), { tone: "mid" }));
  out.push(D(k.corners(LID, 6).map(([x, y]) => at([x, y, TOP])), { size: 0.45 }));
  return out.join("");
}

function dial() {
  const out = [];
  const [x, y] = DIAL.at;
  out.push(S(k.cylinder(x, y, DIAL.r + 1.6, TOP, 2, P, 56), { tone: "lo" }));
  out.push(S(k.cylinder(x, y, DIAL.r, DIAL.z, DIAL.h, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL.r, DIAL_TOP - 3.4, DIAL_TOP, 84, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL.r, DIAL_TOP - 3.4, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL.r - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL.r - 3, 50, 5, DIAL_TOP, [1.2, 2.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // The crown on the +x side, as on a stopwatch.
  out.push(S(k.slabOf({ x: x + DIAL.r - 1, y: y - 2.2, w: 4.6, d: 4.4, r: 1.1 }, DIAL.z + 1.6, 3.6, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL.r + 3.2, y: y - 3, w: 2.4, d: 6, r: 1.1 }, DIAL.z + 1, 4.8, P, 3), { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.6, DIAL_TOP, P, 16), { tone: "mid" }));
  return out.join("");
}

const needleAt = (turn) => {
  const angle = turn * Math.PI * 2;
  const [x, y] = DIAL.at;
  return k.lineOnTop([x - Math.sin(angle) * 3.2, y + Math.cos(angle) * 3.2], [x + Math.sin(angle) * (DIAL.r - 3.6), y - Math.cos(angle) * (DIAL.r - 3.6)], DIAL_TOP + 0.2, P);
};

// One standing letter, centred on y = 0 and standing at zBase; moved with translateAlong.
function letter(zBase) {
  const plan = { x: -LETTER.w / 2, y: -LETTER.t / 2, w: LETTER.w, d: LETTER.t, r: 0.3 };
  const front = LETTER.t / 2;
  const top = zBase + LETTER.h;
  const flap = [k.segment([-LETTER.w / 2, front, top], [0, front, top - 9], P), k.segment([0, front, top - 9], [LETTER.w / 2, front, top], P)].join("");
  const stamp = quad([[LETTER.w / 2 - 9, front, top - 2.4], [LETTER.w / 2 - 3, front, top - 2.4], [LETTER.w / 2 - 3, front, top - 9.4], [LETTER.w / 2 - 9, front, top - 9.4]]);
  const address = [faceLine(front, -10, 6, zBase + 8), faceLine(front, -10, 2, zBase + 5.4)].join("");
  return S(k.slabOf(plan, zBase, LETTER.h, P, 2), { tone: "hi", crease: "lo", inner: L(flap, { tone: "lo" }) + L(stamp, { tone: "lo" }) + L(address, { tone: "faint", free: true }) });
}

function magazineBack() {
  const out = [];
  // The left guide first: it is the far one.
  out.push(S(k.slabOf({ x: BASE.x - 1.6, y: BASE.y, w: 2, d: BASE.d, r: 0.6 }, BASE_TOP, 22, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(BASE, TOP, BASE_TOP - TOP, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline({ x: -2, y: BASE.y + 3, w: 4, d: BASE.d - 4.6, r: 1.6 }, BASE_TOP, P, 3), { tone: "faint" }));
  out.push(S(k.slabOf({ x: -27, y: BASE.y, w: 54, d: 2, r: 0.6 }, BASE_TOP, 24, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([-22, BASE.y + 1, BASE_TOP + 24]), at([22, BASE.y + 1, BASE_TOP + 24])], { size: 0.45 }));
  return out.join("");
}

// The follower that keeps the letters upright, built with its front face at y = 0.
function follower() {
  const out = [];
  const plan = { x: FOLLOWER.x, y: -FOLLOWER.d, w: FOLLOWER.w, d: FOLLOWER.d, r: 1 };
  out.push(S(k.slabOf(plan, BASE_TOP, FOLLOWER.h, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, BASE_TOP + 4, P, 3), { tone: "faint" }) }));
  out.push(S(k.cylinder(0, -FOLLOWER.d / 2, 2.6, BASE_TOP + FOLLOWER.h, 3, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(0, -FOLLOWER.d / 2, 2.6, BASE_TOP + FOLLOWER.h, BASE_TOP + FOLLOWER.h + 3, 22, P), { tone: "lo" }));
  return out.join("");
}

function magazineFront() {
  const out = [];
  out.push(S(k.slabOf({ x: BASE.x + BASE.w - 0.4, y: BASE.y, w: 2, d: BASE.d, r: 0.6 }, BASE_TOP, 22, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([BASE.x + BASE.w + 0.6, BASE.y + 3, BASE_TOP + 22]), at([BASE.x + BASE.w + 0.6, BASE.y + BASE.d - 3, BASE_TOP + 22])], { size: 0.45 }));
  return out.join("");
}

function gate() {
  const out = [S(k.slabOf(GATE, TOP - 0.4, GATE_TOP - TOP + 0.4, P, 3, 0.3), { tone: "mid" })];
  out.push(S(k.cylinder(GATE.x + GATE.w - 4, GATE.y + GATE.d / 2, 1.6, GATE_TOP, 2, P, 16), { tone: "mid" }));
  return out.join("");
}

function lamp() {
  const out = [];
  const [px, py] = LAMP.post;
  out.push(S(k.cylinder(px, py, 5.2, TOP, 4.4, P, 32, 0.4), { tone: "mid" }));
  out.push(L(k.knurl(px, py, 5.2, TOP + 0.6, TOP + 3.8, 30, P), { tone: "lo" }));
  out.push(S(k.cylinder(px, py, 2.8, TOP + 4.4, LAMP.armZ - TOP - 4.4, P, 24), { tone: "mid", crease: "none" }));
  out.push(L([TOP + 20, TOP + 26].map((z) => k.sideArc(px, py, 2.8, z, P, 14)).join(""), { tone: "faint" }));
  return out.join("");
}

function lampHead() {
  const out = [];
  const [hx, hy] = LAMP.head;
  out.push(S(k.cylinder(hx, hy, 6.4, 98.6, LAMP.armZ - 98.6, P, 40, 0.4), { tone: "mid" }));
  out.push(L(k.sideArc(hx, hy, 6.4, 101.4, P, 24), { tone: "faint" }));
  out.push(`<g data-part="lens">${S(k.cylinder(hx, hy, 4.4, 97.8, 0.8, P, 32), { tone: "hi" })}</g>`);
  const arm = { x: LAMP.post[0] - 3, y: hy - 1.6, w: hx - LAMP.post[0] + 6, d: 3.2, r: 1.4 };
  out.push(S(k.slabOf(arm, LAMP.armZ, 3.4, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([LAMP.post[0], hy, LAMP.armZ + 3.4]), at([hx, hy, LAMP.armZ + 3.4])], { size: 0.45 }));
  return out.join("");
}

// The flag's carrier and plate, built at rest and lifted with translateAlong.
function flagCarrier() {
  const [fx, fy] = FLAG.post;
  const out = [];
  out.push(S(k.slabOf({ x: fx - 2.6, y: fy - 2.6, w: 5.2, d: 5.2, r: 1.2 }, FLAG.low, 6, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: fx + 2.6, y: fy - 0.6, w: 17, d: 1.2, r: 0.4 }, FLAG.low + 1.6, 10, P, 2), { tone: "hi", crease: "lo" }));
  out.push(D([at([fx + 2.6, fy - 2.6, FLAG.low + 6]), at([fx - 2.6, fy + 2.6, FLAG.low + 6])], { size: 0.4 }));
  return out.join("");
}

// The post the flag rides on, in two pieces around the carrier at lift `l`.
const flagPost = (l) => ({
  low: l > 0.3 ? k.solidSvg(k.cylinder(FLAG.post[0], FLAG.post[1], 1.8, FLAG.low, l, P, 20), { tone: "mid", crease: "none" }) : "",
  high: k.solidSvg(k.cylinder(FLAG.post[0], FLAG.post[1], 1.8, FLAG.low + 6 + l, FLAG.top - FLAG.low - 6 - l, P, 20), { tone: "mid", crease: "none" }) + k.solidSvg(k.cylinder(FLAG.post[0], FLAG.post[1], 2.4, FLAG.top, 1.2, P, 20), { tone: "mid" }),
});

// A tray's front lip, label card and pull, built home and slid out with translateAlong.
function panel(dx) {
  const out = [];
  const plan = { x: dx + 1.8, y: FACE, w: DRAWER_W - 3.6, d: PANEL_D, r: 1.2 };
  const front = FACE + PANEL_D;
  out.push(S(k.slabOf(plan, PANEL_Z[0], PANEL_Z[1] - PANEL_Z[0], P, 3, 0.5), { tone: "mid" }));
  out.push(L(quad([[dx + 6, front, 15.4], [dx + 28, front, 15.4], [dx + 28, front, 21.6], [dx + 6, front, 21.6]]), { tone: "lo" }));
  out.push(S(k.slabOf({ x: dx + 7, y: front, w: 20, d: 0.5, r: 0.2 }, 16.2, 4.6, P, 2), { tone: "hi", crease: "none" }));
  out.push(L([faceLine(front + 0.5, dx + 9.4, dx + 23, 19.6), faceLine(front + 0.5, dx + 9.4, dx + 19, 17.6)].join(""), { tone: "lo", free: true }));
  for (const px of [dx + 37, dx + 49.6]) out.push(S(k.slabOf({ x: px, y: front, w: 2.4, d: 2.4, r: 0.6 }, 16.8, 3.4, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf({ x: dx + 36, y: front + 2.4, w: 17, d: 2, r: 0.9 }, 16.4, 4.2, P, 3, 0.4), { tone: "mid" }));
  out.push(D([at([dx + 4, front, 22]), at([dx + DRAWER_W - 4, front, 22])], { size: 0.45 }));
  return out.join("");
}

// Letters are built where they stand at rest: the front one on the gate, the rest on the base.
const builtZ = (index) => (index === 0 ? GATE_TOP : BASE_TOP);
const letters = SLOTS_Y.map((y, index) => `<g data-part="letter" data-slot="${index}" transform="${k.translateAlong(P, [0, y, 0])}">${letter(builtZ(index))}</g>`).reverse();

// The front letter drops through the slot: everything below the lid line is clipped.
const slotLine = [at([-140, SLOTS_Y[0], TOP]), at([140, SLOTS_Y[0], TOP])];
const clip = `<clipPath id="sorter-slot"><path d="M${slotLine[0][0]} ${slotLine[0][1]}L${slotLine[1][0]} ${slotLine[1][1]}L${slotLine[1][0]} -400L${slotLine[0][0]} -400Z"/></clipPath>`;
const restPost = flagPost(0);

const body = [
  plate(),
  cabinet(),
  dial(),
  `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(0.24)}" style="stroke-width:1.1"/>`,
  lamp(),
  magazineBack(),
  `<g data-part="follower" transform="${k.translateAlong(P, [0, FOLLOWER_REST, 0])}">${follower()}</g>`,
  clip,
  `<g data-part="queue" clip-path="url(#sorter-slot)">${letters.join("")}</g>`,
  `<g data-part="gate">${gate()}</g>`,
  magazineFront(),
  lampHead(),
  S(k.cylinder(FLAG.post[0], FLAG.post[1], 4.6, TOP, FLAG.low - TOP, P, 28, 0.4), { tone: "mid" }),
  `<g data-part="post-low">${restPost.low}</g>`,
  `<g data-part="flag">${flagCarrier()}</g>`,
  `<g data-part="post-high">${restPost.high}</g>`,
  ...DRAWERS.map((dx, index) => `<g data-part="drawer-out" data-drawer="${index}"></g><g data-part="panel" data-drawer="${index}">${panel(dx)}</g>`),
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A sorting cabinet on a bench plate, standing for Cairn's server. A dial on the lid counts ten minutes. When it comes round, a gate under the front letter of a magazine slides open, the letter drops through a slot under a reading lamp, and one of three letter trays in pigeonholes on the front, Important, Classroom or Everything else, slides out to take it. A flag on the right rises when the letter is one that sends a notification.",
  body,
});

const card = k.plateHtml({
  fig: "Fig 1",
  title: "How Cairn sorts",
  hint: "Click to check now",
  readout: "next check 7:36",
  keys: [
    { mark: "lit", label: "The letter being read, and the ten-minute dial" },
    { mark: "raised", label: "Trays: Important, Classroom, Everything else" },
    { mark: "flat", label: "Flag up: a notification on your phone" },
  ],
  caption:
    "Cairn's server works like this cabinet. Every ten minutes the dial comes round and each new email or Classroom post is read, by AI if you added your own key, then filed: Important or Everything else in your Inbox, coursework and announcements in the Classroom tab. Anything important, and anything new in Classroom, puts the flag up: that is the notification on your phone. Here ten minutes pass in eight seconds.",
  body: `<div class="iso-stage sorter-stage" tabindex="0" role="group" aria-label="Sorting cabinet. Press Enter to run a check now; the arrow keys pull out each tray.">${svg}<span class="sorter-live" aria-live="polite"></span></div>`,
});

const live = `
const P = ${JSON.stringify(P)};
const DIAL = ${JSON.stringify(DIAL)}, DIAL_TOP = ${DIAL_TOP};
const DRAWERS = ${JSON.stringify(DRAWERS)}, DRAWER_W = ${DRAWER_W}, FACE = ${FACE}, FLOOR_Z = ${FLOOR_Z}, OPEN = ${OPEN}, PEEK = ${PEEK}, PANEL_D = ${PANEL_D}, PANEL_Z = ${JSON.stringify(PANEL_Z)}, WALL_H = ${WALL_H};
const NAMES = ${JSON.stringify(NAMES)};
const SLOTS_Y = ${JSON.stringify(SLOTS_Y)}, LETTER = ${JSON.stringify(LETTER)}, GATE_TOP = ${GATE_TOP}, BASE_TOP = ${BASE_TOP};
const GATE_TRAVEL = ${GATE_TRAVEL}, FOLLOWER_REST = ${FOLLOWER_REST}, FOLLOWER_STOP = ${FOLLOWER_STOP};
const FLAG = ${JSON.stringify(FLAG)};
const VIEW = [${WIDTH}, ${HEIGHT}];
const CYCLE = 8; // seconds on screen for the ten minutes between checks
const SEQUENCE = [1, 2, 0, 2]; // what each new letter turns out to be: Classroom, Everything else, Important, Everything else
const needleAt = ${needleAt.toString().replace("k.lineOnTop", "lineOnTop")};
const flagPost = ${flagPost.toString().replaceAll("k.", "")};

const figure = document.querySelector(".sorter-stage");
if (figure) {
  const svg = figure.querySelector("svg");
  const part = (name) => svg.querySelector('[data-part="' + name + '"]');
  const readout = figure.closest(".iso-figure").querySelector("[data-readout]");
  const say = figure.querySelector(".sorter-live");
  const needle = part("needle"), gate = part("gate"), lens = part("lens").firstElementChild, flag = part("flag"), follower = part("follower");
  const postLow = part("post-low"), postHigh = part("post-high");
  const queue = [...svg.querySelectorAll('[data-part="letter"]')].sort((a, b) => a.dataset.slot - b.dataset.slot);
  const outs = [...svg.querySelectorAll('[data-part="drawer-out"]')];
  const panels = [...svg.querySelectorAll('[data-part="panel"]')];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const span = (e, a, b) => ease((e - a) / (b - a));
  const lerp = (a, b, u) => a + (b - a) * u;
  const follow = (value, target, dt, seconds) => (still.matches ? target : value + (target - value) * (1 - Math.exp(-dt / seconds)));
  const builtZ = (index) => (index === 0 ? GATE_TOP : BASE_TOP);
  const standZ = (slot) => (slot === 0 ? GATE_TOP : BASE_TOP);

  // The model: when the last check ran, what it found, how full each drawer is.
  const counts = [1, 2, 3];
  const opened = [0, 0, 0];
  let clock = 0, lastTrip = -0.24 * CYCLE, trips = 0, pending = null, dropped = 0, flagUp = false, lift = 0, peek = -1, postAt = -1;
  let frame = 0, last = 0, visible = false;

  function trip(now) {
    if (pending) return;
    pending = { at: now, kind: SEQUENCE[trips % SEQUENCE.length], index: dropped, refill: dropped === 3, counted: false };
    trips++;
    lastTrip = now;
    flagUp = false;
    say.textContent = "Checking now: one new letter.";
  }

  function finish() {
    if (!pending.counted) counts[pending.kind]++;
    flagUp = pending.kind !== 2;
    dropped = pending.refill ? 0 : dropped + 1;
    say.textContent = "Filed under " + NAMES[pending.kind] + ".";
    pending = null;
  }

  function slab(plan, z, h, tone, lit) {
    return solidSvg(slabOf(plan, z, h, P, 2), { tone, crease: tone === "hi" ? "lo" : "faint", lit });
  }

  // The part of a drawer that is out of the cabinet: floor, side walls and the letters in it.
  function drawerOut(index, open, arriving) {
    if (open < 0.3) return "";
    const dx = DRAWERS[index];
    const out = [slab({ x: dx + 3, y: FACE, w: DRAWER_W - 6, d: open, r: 0 }, FLOOR_Z, 1.4, "lo")];
    out.push(slab({ x: dx + 3, y: FACE, w: 1.4, d: open, r: 0 }, FLOOR_Z + 1.4, WALL_H, "mid"));
    const front = FACE + open - 4;
    // Letters lie a little askew on one another, the top one showing its flap.
    const SKEW = [[0, 0], [-1.6, 0.8], [1.2, -0.6], [-0.6, 1]];
    const lay = (y0, level, lit, flap) => {
      const [sx, sy] = SKEW[level % SKEW.length];
      const from = Math.max(FACE, y0 + sy), to = Math.min(y0 + sy + 22, front);
      if (to - from <= 0.4) return;
      const z = FLOOR_Z + 1.4 + level * 1.1;
      const x0 = dx + 9 + sx, x1 = x0 + DRAWER_W - 18;
      let inner = "";
      if (flap && y0 + sy >= FACE - 0.1) {
        const mid = [(x0 + x1) / 2, y0 + sy + 9];
        inner = lineSvg(onTop([[x0, y0 + sy], mid, [x1, y0 + sy]], z + 0.8, P), { tone: "lo" });
      }
      out.push(solidSvg(slabOf({ x: x0, y: from, w: x1 - x0, d: to - from, r: 0.5 }, z, 0.8, P, 2), { tone: "hi", crease: "lo", lit, inner }));
    };
    const stack = Math.min(counts[index], 4);
    for (let level = 0; level < stack; level++) lay(front - 22, level, false, level === stack - 1 && arriving === null);
    if (arriving !== null) lay(front - 22 - arriving * 26, stack, true, true);
    out.push(slab({ x: dx + DRAWER_W - 4.4, y: FACE, w: 1.4, d: open, r: 0 }, FLOOR_Z + 1.4, WALL_H, "mid"));
    return out.join("");
  }

  function draw(now, dt) {
    const e = pending ? now - pending.at : Infinity;
    needle.setAttribute("d", needleAt(Math.min(1, (now - lastTrip) / CYCLE)));

    // The gate opens, the letter drops past the lamp, the gate closes again.
    const gateOpen = pending ? span(e, 0, 0.35) - span(e, 1.05, 1.4) : 0;
    gate.setAttribute("transform", translateAlong(P, [gateOpen * GATE_TRAVEL, 0, 0]));
    if (pending && e > 0.05 && e < 1.0) lens.setAttribute("data-lit", ""); else lens.removeAttribute("data-lit");

    // Letters: the front one falls, the rest step forward, an empty magazine refills.
    const advance = pending ? span(e, 1.4, 1.95) : 0;
    const refill = pending && pending.refill ? span(e, 2.4, 3.1) : 0;
    queue.forEach((el, index) => {
      const slot = index - dropped;
      let y = SLOTS_Y[Math.max(0, slot)], z = standZ(Math.max(0, slot)) - builtZ(index), show = slot >= 0 ? 1 : 0, lit = false;
      if (pending && index === pending.index) {
        const fall = span(e, 0.35, 0.95);
        z = standZ(0) - builtZ(index) - fall * fall * (LETTER.h + 3);
        lit = e < 1.0;
        show = e < 1.0 ? 1 : 0;
      } else if (pending && slot > 0) {
        y = lerp(SLOTS_Y[slot], SLOTS_Y[slot - 1], advance);
        z = lerp(standZ(slot), standZ(slot - 1), advance) - builtZ(index);
      }
      if (refill > 0 && (slot < 0 || index === pending.index)) {
        y = SLOTS_Y[index]; z = 0; show = refill;
      }
      el.setAttribute("transform", translateAlong(P, [0, y, z]));
      el.style.opacity = show >= 1 ? "" : String(show);
      const solid = el.firstElementChild;
      if (lit) solid.setAttribute("data-lit", ""); else solid.removeAttribute("data-lit");
    });

    // The follower keeps behind the last letter, and goes back when the magazine refills.
    let lastY;
    if (pending && pending.index < 3) lastY = lerp(SLOTS_Y[3 - dropped], SLOTS_Y[Math.max(0, 2 - dropped)], advance);
    else lastY = SLOTS_Y[Math.min(3, 3 - dropped)];
    let front = Math.min(lastY - LETTER.t / 2 - 0.4, FOLLOWER_STOP);
    if (refill > 0) front = lerp(front, FOLLOWER_REST, refill);
    follower.setAttribute("transform", translateAlong(P, [0, front, 0]));

    // Drawers: the one the letter belongs in opens, takes it and closes.
    DRAWERS.forEach((_, index) => {
      let want = 0, arriving = null;
      if (pending && pending.kind === index) {
        want = (span(e, 0.55, 1.1) - span(e, 2.05, 2.7)) * OPEN;
        if (e > 1.05 && e < 1.72) arriving = 1 - span(e, 1.05, 1.7);
      }
      if (peek === index) want = Math.max(want, PEEK);
      opened[index] = pending && pending.kind === index ? want : follow(opened[index], want, dt, 0.14);
      if (Math.abs(opened[index] - want) < 0.05) opened[index] = want;
      panels[index].setAttribute("transform", translateAlong(P, [0, opened[index], 0]));
      outs[index].innerHTML = drawerOut(index, opened[index], arriving);
    });

    // Counted once the letter has landed; the flag answers for anything that notifies.
    if (pending && !pending.counted && e > 1.72) {
      counts[pending.kind]++;
      pending.counted = true;
      flagUp = pending.kind !== 2;
      say.textContent = "Filed under " + NAMES[pending.kind] + ".";
    }
    lift = follow(lift, flagUp ? 1 : 0, dt, 0.16);
    if (Math.abs(lift - (flagUp ? 1 : 0)) < 0.002) lift = flagUp ? 1 : 0;
    const l = lift * FLAG.lift;
    flag.setAttribute("transform", translateAlong(P, [0, 0, l]));
    if (Math.abs(l - postAt) > 0.05) {
      const post = flagPost(l);
      postLow.innerHTML = post.low;
      postHigh.innerHTML = post.high;
      postAt = l;
    }

    if (pending && e > 3.3) finish();

    let text;
    if (pending && e < 1.0) text = "checking · reading 1 new";
    else if (pending) text = "→ " + NAMES[pending.kind].toLowerCase();
    else if (peek >= 0) text = NAMES[peek].toLowerCase() + " · " + counts[peek] + " letters";
    else {
      const remaining = Math.max(0, Math.ceil((1 - Math.min(1, (now - lastTrip) / CYCLE)) * 600));
      text = "next check " + Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");
    }
    if (readout.textContent !== text) readout.textContent = text;
  }

  function tick(stamp) {
    const dt = last ? Math.min((stamp - last) / 1000, 1 / 30) : 1 / 60;
    last = stamp;
    clock += dt;
    if (!pending && clock - lastTrip >= CYCLE) trip(clock);
    draw(clock, dt);
    frame = visible ? requestAnimationFrame(tick) : 0;
  }
  const run = () => { if (!frame && visible && !still.matches) { last = 0; frame = requestAnimationFrame(tick); } };
  const redraw = () => { if (still.matches) draw(clock, 1); else run(); };
  new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(figure);

  const checkNow = () => {
    trip(clock);
    if (still.matches && pending) finish();
    redraw();
  };
  figure.addEventListener("click", checkNow);
  figure.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); checkNow(); return; }
    let next = null;
    if (event.key === "ArrowRight") next = Math.min(2, peek + 1);
    if (event.key === "ArrowLeft") next = Math.max(0, peek < 0 ? 0 : peek - 1);
    if (event.key === "Escape") next = -1;
    if (next === null) return;
    event.preventDefault();
    peek = next;
    if (peek >= 0) say.textContent = NAMES[peek] + ": " + counts[peek] + " letters.";
    redraw();
  });
  figure.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * VIEW[0], py = ((event.clientY - box.top) / box.height) * VIEW[1];
    const hit = DRAWERS.findIndex((dx) => {
      const a = iso([dx, FACE + PANEL_D, PANEL_Z[1]], P), b = iso([dx + DRAWER_W, FACE + PANEL_D, PANEL_Z[0]], P);
      return px >= Math.min(a[0], b[0]) && px <= Math.max(a[0], b[0]) && py >= Math.min(a[1], b[1]) - 6 && py <= Math.max(a[1], b[1]) + 6;
    });
    if (hit !== peek) { peek = hit; redraw(); }
  });
  figure.addEventListener("pointerleave", () => { peek = -1; redraw(); });
  draw(clock, 1);
}
`;

// Patch the card into the home page.
const page = join(PUBLIC, "index.html");
const html = readFileSync(page, "utf8");
const start = "<!-- sorter -->";
const end = "<!-- /sorter -->";
if (html.includes(start) && html.includes(end)) writeFileSync(page, html.slice(0, html.indexOf(start) + start.length) + card + html.slice(html.indexOf(end)));
else console.warn("sorter: public/index.html has no sorter markers, so only the assets were written");
writeFileSync(join(PUBLIC, "assets", "sorter.js"), `// Built by tools/sorter.mjs from the anatomy kit (MIT, tools/kit/LICENSE). Do not edit by hand.\n${kitScript()}\n${live}`);
writeFileSync(join(PUBLIC, "assets", "iso.css"), `/* The anatomy kit's styles (MIT, tools/kit/LICENSE), written by tools/sorter.mjs. */\n${k.ISO_CSS}`);

const pageArg = process.argv.indexOf("--page");
if (pageArg > 0) {
  const theme = process.argv.includes("--light") ? "light" : "dark";
  const extra = `.sorter-void{fill:#090909}.iso[data-theme="light"] .sorter-void{fill:#c9c9c4}.sorter-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.sorter-stage{position:relative;cursor:pointer;outline:none}.iso{--anatomy-lit:#f5a623}`;
  writeFileSync(process.argv[pageArg + 1], k.pageHtml({ title: "How Cairn sorts", theme, body: card, script: kitScript() + live, width: 760 }).replace("</style>", `${extra}</style>`));
}
console.log("sorter: card, assets/sorter.js and assets/iso.css written");
