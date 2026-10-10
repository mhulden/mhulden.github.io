// Introduction slides: a short, step-by-step presentation shown in the
// "Introduction" tab (see deck.js for how slides and builds are stepped through).

import { drawDFA } from "./draw.js";
import { rpni } from "./rpni.js";
import { learnBimachine, Oracle } from "./learner.js";
import { ORACLES, WALKTHROUGH, compileOracle } from "./presets.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const chunk = (c) => (c === "" ? "ε" : c);
const fig1 = compileOracle(ORACLES.figure1.source);

// Shared input for the running-example slides.
const ctx = { input: "aabbabaabb" };
const MAX_INPUT = 16;

// ---------------------------------------------------------------------------
// The two machines for Figure 1's function
// ---------------------------------------------------------------------------

// The one-way transducer: states 0,1,3 are final; "a" alone means a:a.
const FST = {
  start: 0,
  finals: new Set([0, 1, 3]),
  trans: [
    [0, "a", "a", 1], [0, "b", "b", 0],
    [1, "a", "A", 2], [1, "a", "a", 3], [1, "b", "B", 4], [1, "b", "b", 3],
    [2, "a", "A", 2], [2, "a", "a", 3], [2, "b", "B", 4],
    [3, "b", "b", 3],
    [4, "a", "a", 1], [4, "b", "b", 4],
  ],
};

// The bimachine of Figure 1 (state names as in the paper).
const BM = {
  left: { start: 1, delta: { 1: { a: 2, b: 1 }, 2: { a: 2, b: 1 } } },
  right: { start: 3, delta: { 3: { a: 4, b: 3 }, 4: { a: 4, b: 4 } } },
  omega: { "1a3": "a", "1a4": "a", "1b3": "b", "1b4": "b", "2a3": "a", "2a4": "A", "2b3": "b", "2b4": "B" },
};

function runBimachine(x) {
  const n = x.length;
  const L = [BM.left.start];
  for (let i = 0; i < n; i++) L.push(BM.left.delta[L[i]][x[i]]);
  const R = new Array(n + 1);
  R[n] = BM.right.start;
  for (let i = n - 1; i >= 0; i--) R[i] = BM.right.delta[R[i + 1]][x[i]];
  const out = [...x].map((a, i) => BM.omega[`${L[i]}${a}${R[i + 1]}`]);
  return { L, R, out };
}

// All runs of the FST on x, as a trellis: forward-reachable states per
// position, the states that can still reach a final state, and the edges.
function fstTrellis(x) {
  const n = x.length;
  const F = [new Set([FST.start])];
  const edges = [];
  for (let i = 0; i < n; i++) {
    const next = new Set();
    for (const [s, a, o, t] of FST.trans) {
      if (a === x[i] && F[i].has(s)) { next.add(t); edges.push({ i, s, t, o }); }
    }
    F.push(next);
  }
  const B = new Array(n + 1);
  B[n] = new Set([...F[n]].filter((s) => FST.finals.has(s)));
  for (let i = n - 1; i >= 0; i--) {
    B[i] = new Set(edges.filter((e) => e.i === i && B[i + 1].has(e.t)).map((e) => e.s));
  }
  for (const e of edges) e.live = B[e.i].has(e.s) && B[e.i + 1].has(e.t);
  return { F, B, edges, out: edges.filter((e) => e.live).sort((a, b) => a.i - b.i).map((e) => e.o) };
}

// ---------------------------------------------------------------------------
// SVG helpers for hand-placed machines
// ---------------------------------------------------------------------------

let svgId = 0;

// nodes: {id, x, y, label, final, init: "left"|"right", cls}
// edges: {f, t, label, bend, loop: "above"|"below", lt, lo, cls}
function machineSVG({ w, h, nodes, edges, tone }) {
  const id = `m${svgId++}`;
  const R = 18;
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const kinds = ["base", "hl", "guess", "dim"];
  let s = `<svg viewBox="0 0 ${w} ${h}" class="machine ${tone || ""}" role="img"><defs>`;
  for (const k of kinds) {
    s += `<marker id="${id}-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ah ${k}"/></marker>`;
  }
  s += "</defs>";
  for (const e of edges) {
    const k = e.cls || "base";
    const a = pos.get(e.f), b = pos.get(e.t);
    let d, lx, ly;
    if (e.loop) {
      const sg = e.loop === "above" ? -1 : 1;
      d = `M ${a.x - 8} ${a.y + sg * (R - 3)} C ${a.x - 26} ${a.y + sg * (R + 34)}, ${a.x + 26} ${a.y + sg * (R + 34)}, ${a.x + 8} ${a.y + sg * (R - 3)}`;
      lx = a.x; ly = a.y + sg * (R + 34);
    } else {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const bend = e.bend || 0;
      const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
      const a1 = Math.atan2(cy - a.y, cx - a.x), a2 = Math.atan2(cy - b.y, cx - b.x);
      const p0 = [a.x + R * Math.cos(a1), a.y + R * Math.sin(a1)];
      const p2 = [b.x + R * Math.cos(a2), b.y + R * Math.sin(a2)];
      d = `M ${p0[0]} ${p0[1]} Q ${cx} ${cy} ${p2[0]} ${p2[1]}`;
      const t = e.lt ?? 0.5, lo = e.lo ?? (bend >= 0 ? 12 : -12);
      lx = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * cx + t * t * p2[0] + nx * lo;
      ly = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * cy + t * t * p2[1] + ny * lo;
    }
    s += `<path d="${d}" class="edge ${k}" marker-end="url(#${id}-${k})"/>`;
    s += `<text x="${lx}" y="${ly}" class="elabel ${k}" text-anchor="middle" dominant-baseline="central">${esc(e.label)}</text>`;
  }
  for (const n of nodes) {
    if (n.init) {
      const sg = n.init === "left" ? -1 : 1;
      s += `<line x1="${n.x + sg * (R + 30)}" y1="${n.y}" x2="${n.x + sg * (R + 2)}" y2="${n.y}" class="edge base" marker-end="url(#${id}-base)"/>`;
    }
    s += `<g class="mnode ${n.cls || ""}"><circle cx="${n.x}" cy="${n.y}" r="${R}" class="body"/>`;
    if (n.final) s += `<circle cx="${n.x}" cy="${n.y}" r="${R - 4}" class="inner"/>`;
    s += `<text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central">${esc(n.label ?? n.id)}</text></g>`;
  }
  return s + "</svg>";
}

function fstSVG({ guess = false, promise = false } = {}) {
  const pr = promise ? "promise" : "";
  const g = (cond) => (guess && cond ? "guess" : guess ? "dim" : "base");
  return machineSVG({
    w: 620, h: 310,
    nodes: [
      { id: 0, x: 70, y: 155, final: true, init: "left" },
      { id: 1, x: 220, y: 155, final: true },
      { id: 2, x: 390, y: 65, cls: pr },
      { id: 4, x: 390, y: 245, cls: pr },
      { id: 3, x: 550, y: 155, final: true },
    ],
    edges: [
      { f: 0, t: 0, loop: "above", label: "b", cls: g(false) },
      { f: 0, t: 1, label: "a", lo: -12, cls: g(false) },
      { f: 1, t: 2, label: "a:A", lo: -14, cls: g(true) },
      { f: 1, t: 3, label: "a, b", lt: 0.22, lo: -12, cls: g(true) },
      { f: 1, t: 4, label: "b:B", bend: -28, lo: -14, cls: g(true) },
      { f: 4, t: 1, label: "a", bend: -28, lo: -14, cls: g(false) },
      { f: 4, t: 4, loop: "below", label: "b", cls: g(false) },
      { f: 2, t: 2, loop: "above", label: "a:A", cls: g(true) },
      { f: 2, t: 3, label: "a", lo: -12, cls: g(true) },
      { f: 2, t: 4, label: "b:B", bend: -26, lt: 0.3, lo: -16, cls: g(false) },
      { f: 3, t: 3, loop: "above", label: "b", cls: g(false) },
    ],
  });
}

function leftSVG(hl) {
  return machineSVG({
    w: 270, h: 150, tone: "left",
    nodes: [
      { id: 1, x: 70, y: 95, init: "left", cls: hl === 1 ? "hl" : "" },
      { id: 2, x: 200, y: 95, cls: hl === 2 ? "hl" : "" },
    ],
    edges: [
      { f: 1, t: 2, label: "a", bend: 26 },
      { f: 2, t: 1, label: "b", bend: 26 },
      { f: 1, t: 1, loop: "above", label: "b" },
      { f: 2, t: 2, loop: "above", label: "a" },
    ],
  });
}

function rightSVG(hl) {
  return machineSVG({
    w: 270, h: 150, tone: "right",
    nodes: [
      { id: 4, x: 70, y: 95, cls: hl === 4 ? "hl" : "" },
      { id: 3, x: 200, y: 95, init: "right", cls: hl === 3 ? "hl" : "" },
    ],
    edges: [
      { f: 3, t: 4, label: "a", lo: -12 },
      { f: 3, t: 3, loop: "above", label: "b" },
      { f: 4, t: 4, loop: "above", label: "a, b" },
    ],
  });
}

function omegaHTML(hl) {
  let h = `<table class="omega-fig"><thead><tr><th rowspan="2">q</th><th colspan="2">a</th><th colspan="2">b</th></tr><tr>`;
  for (const a of "ab") for (const p of [3, 4]) h += `<th class="rt">p=${p}</th>`;
  h += "</tr></thead><tbody>";
  for (const q of [1, 2]) {
    h += `<tr><th class="lt">${q}</th>`;
    for (const a of "ab") {
      for (const p of [3, 4]) {
        const k = `${q}${a}${p}`;
        const v = BM.omega[k];
        h += `<td class="${hl === k ? "hl" : ""} ${v !== a ? "cap" : ""}">${v}</td>`;
      }
    }
    h += "</tr>";
  }
  return h + "</tbody></table>";
}

// Staggered "pop" animation for the pieces revealed by a build.
const pop = (on, i, step = 110) => (on ? ` class="pop" style="animation-delay:${i * step}ms"` : "");

function traceSVG(x, { showL, showR, showOut, animL, animR, animOut, sel }) {
  const { L, R, out } = runBimachine(x);
  const n = x.length, dx = 46, x0 = 52;
  const W = x0 * 2 + n * dx, yL = 26, yX = 66, yR = 106, yO = 156;
  let s = `<svg viewBox="0 0 ${W} 180" class="trace" role="img">`;
  s += `<text x="8" y="${yL}" class="rowlab lt">left</text><text x="8" y="${yX}" class="rowlab">input</text><text x="8" y="${yR}" class="rowlab rt">right</text><text x="8" y="${yO}" class="rowlab">output</text>`;
  if (sel !== null && sel < n && showOut) {
    const cx = x0 + sel * dx;
    s += `<rect x="${cx - 13}" y="${yL - 14}" width="26" height="26" rx="6" class="selbox lt"/>`;
    s += `<rect x="${cx + dx / 2 - 13}" y="${yX - 15}" width="26" height="28" rx="6" class="selbox"/>`;
    s += `<rect x="${cx + dx - 13}" y="${yR - 14}" width="26" height="26" rx="6" class="selbox rt"/>`;
    s += `<rect x="${cx + dx / 2 - 14}" y="${yO - 16}" width="28" height="30" rx="6" class="selbox out"/>`;
  }
  for (let i = 0; i < n; i++) {
    s += `<text x="${x0 + i * dx + dx / 2}" y="${yX}" class="sym" text-anchor="middle" dominant-baseline="central">${x[i]}</text>`;
  }
  if (showL) {
    for (let i = 0; i <= n; i++) {
      s += `<g${pop(animL, i)}><text x="${x0 + i * dx}" y="${yL}" class="st lt" text-anchor="middle" dominant-baseline="central">${L[i]}</text>`;
      if (i < n) s += `<path d="M ${x0 + i * dx + 9} ${yL} L ${x0 + (i + 1) * dx - 11} ${yL}" class="tarrow lt"/>`;
      s += "</g>";
    }
  }
  if (showR) {
    for (let i = n; i >= 0; i--) {
      s += `<g${pop(animR, n - i)}><text x="${x0 + i * dx}" y="${yR}" class="st rt" text-anchor="middle" dominant-baseline="central">${R[i]}</text>`;
      if (i > 0) s += `<path d="M ${x0 + i * dx - 9} ${yR} L ${x0 + (i - 1) * dx + 11} ${yR}" class="tarrow rt"/>`;
      s += "</g>";
    }
  }
  if (showOut) {
    for (let i = 0; i < n; i++) {
      const cap = out[i] !== x[i];
      s += `<g${pop(animOut, i)}><text x="${x0 + i * dx + dx / 2}" y="${yO}" class="osym ${cap ? "cap" : ""}" text-anchor="middle" dominant-baseline="central">${out[i]}</text></g>`;
    }
    for (let i = 0; i < n; i++) {
      s += `<rect x="${x0 + i * dx}" y="0" width="${dx}" height="180" class="hit" data-pos="${i}"><title>ω(${L[i]}, ${x[i]}, ${R[i + 1]}) = ${out[i]}</title></rect>`;
    }
  }
  return s + "</svg>";
}

function trellisSVG(x, anim) {
  const { F, B, edges, out } = fstTrellis(x);
  const rows = [0, 1, 2, 4, 3];
  const n = x.length, dx = 50, dy = 28, x0 = 110, y0 = 44;
  const W = x0 + n * dx + 36, H = y0 + rows.length * dy + 30;
  const X = (i) => x0 + i * dx, Y = (s) => y0 + rows.indexOf(s) * dy;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="trellis" role="img">`;
  rows.forEach((st) => {
    s += `<text x="10" y="${Y(st)}" class="rowlab" dominant-baseline="central">${st}${FST.finals.has(st) ? " (final)" : ""}</text>`;
  });
  for (let i = 0; i < n; i++) s += `<text x="${X(i) + dx / 2}" y="18" class="sym" text-anchor="middle" dominant-baseline="central">${x[i]}</text>`;
  for (let i = 0; i <= n; i++) {
    let g = "";
    for (const e of edges.filter((e) => e.i === i - 1)) {
      g += `<line x1="${X(i - 1) + 7}" y1="${Y(e.s)}" x2="${X(i) - 7}" y2="${Y(e.t)}" class="tedge ${e.live ? "live" : "dead"}"/>`;
    }
    for (const st of F[i]) {
      const live = B[i].has(st);
      const stuck = !live && (i === n || !edges.some((e) => e.i === i && e.s === st));
      g += `<circle cx="${X(i)}" cy="${Y(st)}" r="7" class="tnode ${live ? "live" : "dead"}"/>`;
      if (live && i === n) g += `<circle cx="${X(i)}" cy="${Y(st)}" r="11" class="tnode-final"/>`;
      if (stuck) g += `<text x="${X(i) + 12}" y="${Y(st) - 9}" class="stuck" text-anchor="middle" dominant-baseline="central">✕</text>`;
    }
    if (i > 0) g += `<text x="${X(i - 1) + dx / 2}" y="${H - 14}" class="osym ${out[i - 1] !== x[i - 1] ? "cap" : ""}" text-anchor="middle" dominant-baseline="central">${out[i - 1] ?? "?"}</text>`;
    s += `<g${pop(anim, i, 130)}>${g}</g>`;
  }
  return s + "</svg>";
}

// Input box bound to the shared running-example input.
function inputBox(id) {
  return `<label class="inbox">input <input id="${id}" type="text" value="${esc(ctx.input)}" spellcheck="false" maxlength="${MAX_INPUT}" aria-label="Input string over a, b"></label>`;
}
function bindInput(root, id, onChange) {
  const box = root.querySelector(`#${id}`);
  box.value = ctx.input;
  box.oninput = () => {
    const v = box.value.replace(/[^ab]/g, "");
    if (v !== box.value) box.value = v;
    ctx.input = v;
    onChange();
  };
}

// ---------------------------------------------------------------------------
// The learner run of the guided walkthrough (used for examples)
// ---------------------------------------------------------------------------

let walk = null;
function walkthrough() {
  if (!walk) {
    const oracle = new Oracle(fig1);
    walk = learnBimachine({
      alphabet: ORACLES.figure1.alphabet, train: WALKTHROUGH.train, oracle,
      kWitness: WALKTHROUGH.kWitness, contMaxLen: WALKTHROUGH.contMaxLen, headMaxLen: WALKTHROUGH.headMaxLen,
    });
  }
  return walk;
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------
//
// Each slide: { section, title, builds, html(), update(root, build, animate) }.
// Elements with data-b="k" become visible at build k.

const SECTIONS = ["Bimachines", "Learning transducers", "Training data", "State merging", "The oracle", "Demo"];

const SLIDES = [];

SLIDES.push({
  section: null,
  title: "Learning Bimachines from Aligned Examples",
  builds: 2,
  html: () => `
    <div class="titleslide">
      <h1 class="big">Learning Bimachines<br>from Aligned Examples</h1>
      <p class="authors">Mans Hulden <span class="muted">New College of Florida</span><br>Michael Ginn <span class="muted">University of Colorado</span></p>
      <ol class="outline" data-b="1">
        <li>Bimachines: what they are, and why not just use a transducer</li>
        <li>Learning transducers: what exists</li>
        <li>What we learn from: aligned vs. unaligned data</li>
        <li>State merging, from RPNI to bimachines</li>
        <li>Using an oracle</li>
        <li>Demo: learning the bimachine of Figure 1</li>
      </ol>
    </div>`,
});

SLIDES.push({
  section: 0,
  title: "A running example",
  builds: 3,
  html: () => `
    <p class="lead">Capitalize a symbol if</p>
    <ol class="conds">
      <li>its <b>left neighbour</b> is an <code>a</code>, and</li>
      <li>another <code>a</code> occurs <b>somewhere to its right</b>.</li>
    </ol>
    <div class="example">
      ${inputBox("in-ex")}
      <div class="pairrow"><span class="lab">input</span><span id="ex-in" class="mono big"></span></div>
      <div class="pairrow" data-b="1"><span class="lab">output</span><span id="ex-out" class="mono big"></span></div>
    </div>
    <div class="takeaway" data-b="2">
      <p>Condition 1 needs <b>one symbol of left context</b>: easy for a machine reading left to right.</p>
      <p>Condition 2 needs <b>unbounded right context</b>: the decision depends on input not yet read.</p>
    </div>`,
  update(root) {
    const draw = () => {
      const x = ctx.input;
      const y = fig1(x);
      root.querySelector("#ex-in").innerHTML = [...x].map((c) => `<span>${c}</span>`).join("") || "ε";
      root.querySelector("#ex-out").innerHTML = y.map((c, i) => `<span class="${c !== x[i] ? "cap" : ""}">${c}</span>`).join("") || "ε";
    };
    bindInput(root, "in-ex", draw);
    draw();
  },
});

SLIDES.push({
  section: 0,
  title: "A finite-state transducer for it",
  builds: 4,
  html: () => `
    <div class="two">
      <div>
        <div id="fst" class="fig"></div>
        <p class="note">Double circles are final states. A label <code>a</code> is short for <code>a:a</code> (copy).</p>
      </div>
      <div class="side">
        <p data-b="0">Reads the input <b>left to right</b> and must write each output symbol <b>now</b>.</p>
        <p data-b="1">So it has to <b>guess</b>: after an <code>a</code>, either “another <code>a</code> is coming” (<code>a:A</code>, <code>b:B</code>) or “no more <code>a</code>'s” (go to 3).</p>
        <p data-b="3">States 2 and 4 are <b>promises</b> (“an <code>a</code> will come”); they are not final. Wrong guesses only die later.</p>
      </div>
    </div>
    <div data-b="2" class="trellisbox">
      <div class="row">${inputBox("in-fst")}<span class="note">All runs: <span class="sw-live"></span> the accepting run, <span class="sw-dead"></span> wrong guesses (✕ = stuck or non-final at the end).</span></div>
      <div id="trellis" class="fig"></div>
    </div>`,
  update(root, b, animate) {
    root.querySelector("#fst").innerHTML = fstSVG({ guess: b === 1, promise: b === 3 });
    const draw = (anim) => { root.querySelector("#trellis").innerHTML = trellisSVG(ctx.input, anim); };
    bindInput(root, "in-fst", () => draw(false));
    draw(animate && b === 2);
  },
});

SLIDES.push({
  section: 0,
  title: "The same function as a bimachine",
  builds: 4,
  html: () => `
    <div class="bm">
      <div><h3 class="lt">Left automaton <span class="muted">reads →</span></h3><div id="bm-left" class="fig small"></div>
        <p class="note">2: the previous symbol was <code>a</code></p></div>
      <div><h3 class="rt">Right automaton <span class="muted">reads ←</span></h3><div id="bm-right" class="fig small"></div>
        <p class="note">4: an <code>a</code> occurs further right</p></div>
      <div><h3>Output table ω(q, a, p)</h3><div id="bm-omega"></div></div>
    </div>
    <div class="row">${inputBox("in-bm")}<span class="note" data-b="3">Click a position: its output is ω(left state before it, symbol, right state after it).</span></div>
    <div id="bm-trace" class="fig"></div>
    <p class="caption" id="bm-cap"></p>`,
  sel: 1,
  update(root, b, animate) {
    const slide = this;
    const draw = (anim) => {
      const x = ctx.input;
      const sel = b >= 3 && slide.sel < x.length ? slide.sel : null;
      const { L, R } = runBimachine(x);
      root.querySelector("#bm-left").innerHTML = leftSVG(sel !== null ? L[sel] : null);
      root.querySelector("#bm-right").innerHTML = rightSVG(sel !== null ? R[sel + 1] : null);
      root.querySelector("#bm-omega").innerHTML = omegaHTML(sel !== null ? `${L[sel]}${x[sel]}${R[sel + 1]}` : null);
      root.querySelector("#bm-trace").innerHTML = traceSVG(x, {
        showL: b >= 1, showR: b >= 2, showOut: b >= 3,
        animL: anim && b === 1, animR: anim && b === 2, animOut: anim && b === 3, sel,
      });
      const cap = [
        "Two deterministic automata and a table. No final states: every input has an output.",
        "Pass 1: the left automaton runs left to right and records a state before each symbol.",
        "Pass 2: the right automaton runs right to left over the same input.",
        sel !== null ? `Position ${sel + 1}: ω(${L[sel]}, ${x[sel]}, ${R[sel + 1]}) = ${BM.omega[`${L[sel]}${x[sel]}${R[sel + 1]}`]}.` : "Each output symbol is a table lookup.",
      ];
      root.querySelector("#bm-cap").textContent = cap[b];
      for (const r of root.querySelectorAll("#bm-trace .hit")) {
        r.onclick = () => { slide.sel = Number(r.dataset.pos); draw(false); };
      }
    };
    bindInput(root, "in-bm", () => draw(false));
    draw(animate);
  },
});

SLIDES.push({
  section: 0,
  title: "Why bimachines?",
  builds: 3,
  html: () => `
    <ul class="points">
      <li data-b="0"><b>Deterministic.</b> Two deterministic passes and a table lookup: no guessing, no dead runs.</li>
      <li data-b="1"><b>Total.</b> A bimachine defines an output for every input, so there is no final/non-final distinction. (The transducer needed non-final “promise” states.)</li>
      <li data-b="2"><b>Factored.</b> Left and right context are kept in separate automata, so their sizes <b>add</b>; a one-way transducer must track both at once, so they <b>multiply</b>.</li>
    </ul>
    <div class="sizes" data-b="2">
      <p class="note">Rewrite <code>a</code> → <code>A</code> if the number of <code>a</code>'s before it is divisible by <i>m</i> and the number of <code>b</code>'s after it is divisible by <i>n</i>.</p>
      <div class="row">
        <label>m <input id="sz-m" type="range" min="1" max="12" value="4"> <span id="sz-mv"></span></label>
        <label>n <input id="sz-n" type="range" min="1" max="12" value="5"> <span id="sz-nv"></span></label>
      </div>
      <div class="bars">
        <div class="bar"><span class="blab">bimachine</span><span class="bfill bm" id="bar-bm"></span><span id="bar-bm-v" class="bval"></span></div>
        <div class="bar"><span class="blab">one-way FST</span><span class="bfill fst" id="bar-fst"></span><span id="bar-fst-v" class="bval"></span></div>
      </div>
      <p class="note">Figure 1's function: a bimachine with 2 + 2 states and an 8-cell table, versus the 5-state transducer with 12 transitions.</p>
    </div>`,
  update(root) {
    const m = root.querySelector("#sz-m"), n = root.querySelector("#sz-n");
    const draw = () => {
      const a = Number(m.value), b = Number(n.value), max = 144;
      root.querySelector("#sz-mv").textContent = a;
      root.querySelector("#sz-nv").textContent = b;
      root.querySelector("#bar-bm").style.width = `${((a + b) / max) * 100}%`;
      root.querySelector("#bar-fst").style.width = `${((a * b) / max) * 100}%`;
      root.querySelector("#bar-bm-v").textContent = `${a} + ${b} = ${a + b} states`;
      root.querySelector("#bar-fst-v").textContent = `${a} · ${b} = ${a * b} states`;
    };
    m.oninput = n.oninput = draw;
    draw();
  },
});

SLIDES.push({
  section: 1,
  title: "Learning transducers: what exists",
  builds: 4,
  html: () => `
    <table class="lit">
      <tbody>
        <tr data-b="0"><td><b>RPNI</b><br><span class="muted">Oncina &amp; García 1992</span></td><td>DFAs, by state merging from positive and negative examples</td></tr>
        <tr data-b="1"><td><b>OSTIA</b><br><span class="muted">Oncina, García &amp; Vidal 1993</span></td><td><b>Subsequential</b> transducers (deterministic, left to right) from input–output pairs</td></tr>
        <tr data-b="2"><td><b>Boiret, Lemay &amp; Niehren</b><br><span class="muted">DLT 2012</span></td><td>Rational functions, via subsequential transducers with a <b>lookahead</b> automaton; a theoretical algorithm</td></tr>
        <tr data-b="3" class="us"><td><b>Bimachines</b><br><span class="muted">Schützenberger 1961</span></td><td>Used as compilation targets (e.g. Skut et al. 2004), but no algorithm that learns the two automata and ω <b>directly</b>. <b>This paper.</b></td></tr>
      </tbody>
    </table>`,
});

SLIDES.push({
  section: 1,
  title: "Why not just use OSTIA?",
  builds: 2,
  html: () => `
    <p class="lead">A deterministic left-to-right transducer must eventually commit to each output symbol.</p>
    <div class="delay">
      <label>number of <code>b</code>'s: <input id="dl-n" type="range" min="0" max="14" value="4"> <span id="dl-nv"></span></label>
      <div id="dl-rows"></div>
    </div>
    <p data-b="0" class="note">After reading the first two symbols, the machine cannot write the second output symbol until it has seen the whole input: the output so far (in grey) is all it can safely write.</p>
    <div class="takeaway" data-b="1">
      <p>The delay grows without bound, so <b>no subsequential transducer</b> realizes the Figure 1 function, and OSTIA cannot learn it.</p>
      <p>In the paper, 8 of the 10 benchmark tasks are not subsequential. OSTIA's hypotheses fit the training data but reach up to hundreds of states (e.g. 491 for “swap first/last”).</p>
    </div>`,
  update(root) {
    const n = root.querySelector("#dl-n");
    const draw = () => {
      const k = Number(n.value);
      root.querySelector("#dl-nv").textContent = k;
      const xs = ["aa" + "b".repeat(k), "aa" + "b".repeat(k) + "a"];
      const ys = xs.map((x) => fig1(x).join(""));
      let lcp = 0;
      while (lcp < ys[0].length && ys[0][lcp] === ys[1][lcp]) lcp++;
      root.querySelector("#dl-rows").innerHTML = xs.map((x, j) => `
        <div class="pairrow"><span class="lab mono">${x}</span><span class="arrow">↦</span>
        <span class="mono big">${[...ys[j]].map((c, i) => `<span class="${i < lcp ? "safe" : c !== c.toLowerCase() ? "cap" : ""}">${c}</span>`).join("")}</span></div>`).join("")
        + `<p class="note">Common output prefix: ${lcp} symbol${lcp === 1 ? "" : "s"}. Symbols that must be held back after reading <code>aa${"b".repeat(k)}</code>: <b>${xs[0].length - lcp}</b>.</p>`;
    };
    n.oninput = draw;
    draw();
  },
});

function splits(y, k) {
  // All ways to cut y into k (possibly empty) consecutive chunks.
  if (k === 1) return [[y]];
  const res = [];
  for (let i = 0; i <= y.length; i++) for (const rest of splits(y.slice(i), k - 1)) res.push([y.slice(0, i), ...rest]);
  return res;
}
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); };

SLIDES.push({
  section: 2,
  title: "What do we learn from?",
  builds: 4,
  html: () => {
    const cuts = splits("cadb", 3);
    return `
    <div class="two even">
      <div>
        <h3>Unaligned pairs</h3>
        <div class="pairrow"><span class="mono big">cdb</span><span class="arrow">↦</span><span class="mono big">cadb</span></div>
        <div class="pairrow"><span class="mono big">aabbabaabb</span><span class="arrow">↦</span><span class="mono big">aABbaBaabb</span></div>
        <div data-b="1">
          <p class="note">Which input symbol produced which output? <code>cadb</code> can be cut into 3 chunks in ${cuts.length} ways:</p>
          <div class="chips">${cuts.map((c) => `<span class="chip ${c.join("|") === "ca|d|b" ? "good" : ""}">${c.map(chunk).join("·")}</span>`).join("")}</div>
          <p class="note">For the 10-symbol pair: ${binom(19, 9).toLocaleString("en-US")} ways.</p>
        </div>
      </div>
      <div data-b="2">
        <h3>Aligned pairs <span class="muted">one output chunk per input symbol</span></h3>
        <table class="align"><tr>${[..."cdb"].map((c) => `<td>${c}</td>`).join("")}</tr><tr>${["ca", "d", "b"].map((c) => `<td>${c}</td>`).join("")}</tr></table>
        <table class="align"><tr>${[..."aabbabaabb"].map((c) => `<td>${c}</td>`).join("")}</tr><tr>${fig1("aabbabaabb").map((c) => `<td class="${c !== c.toLowerCase() ? "cap" : ""}">${c}</td>`).join("")}</tr></table>
        <table class="align"><tr>${[..."abab"].map((c) => `<td>${c}</td>`).join("")}</tr><tr>${["", "b", "", "b"].map((c) => `<td>${chunk(c)}</td>`).join("")}</tr></table>
        <p class="note">Chunks can be longer than one symbol (insertion) or empty (deletion, ε).</p>
      </div>
    </div>
    <div class="takeaway" data-b="3">
      <p><b>Unaligned:</b> the harder problem; the learner must also infer the alignment (ongoing work).</p>
      <p><b>This paper: aligned.</b> The chunk at position <i>i</i> fixes one table entry directly: ω(q<sub>i</sub>, a<sub>i</sub>, p<sub>i+1</sub>).</p>
    </div>`;
  },
});

// RPNI animation: one build per learner event.
const RPNI_POS = ["", "b", "aa", "bb", "aab", "aba", "baa"];
const RPNI_NEG = ["a", "ab", "ba", "aaa", "bab"];
const rpniEvents = rpni(RPNI_POS, RPNI_NEG, ["a", "b"]);

SLIDES.push({
  section: 3,
  title: "State merging: RPNI in one slide",
  builds: rpniEvents.length,
  html: () => `
    <div class="rpni">
      <div class="sample">
        <h3>Target: an even number of <code>a</code>'s</h3>
        <p><b>accept</b> <span class="mono">${RPNI_POS.map((w) => w || "ε").join(", ")}</span></p>
        <p><b>reject</b> <span class="mono">${RPNI_NEG.join(", ")}</span></p>
        <p class="note">Double circle: accepting state. −: rejecting state.</p>
        <ol class="steps">
          <li>Build the prefix tree of the sample.</li>
          <li>Pick the first <span class="blue">blue</span> state; try to merge it into each <span class="red">red</span> state.</li>
          <li>Fold to stay deterministic; reject if an accepting and a rejecting state meet.</li>
          <li>If no merge works, promote the blue state to red.</li>
        </ol>
      </div>
      <div><div id="rpni-g" class="svgwrap fig"></div><p id="rpni-t" class="caption"></p></div>
    </div>`,
  update(root, b) {
    const ev = rpniEvents[b];
    const snap = ev.snapshot;
    const labels = new Map(snap.label);
    const marks = new Map();
    if (ev.u !== undefined && ev.kind !== "merged" && ev.kind !== "promote") { marks.set(ev.u, "u"); if (ev.r !== undefined) marks.set(ev.r, "r"); }
    drawDFA(root.querySelector("#rpni-g"), snap, {
      alphabet: ["a", "b"], mirror: false, red: ev.red, blue: ev.blue,
      rings: ev.classes || [], fresh: null, marks,
      accept: new Set([...labels].filter(([, l]) => l === "+").map(([s]) => s)),
      reject: new Set([...labels].filter(([, l]) => l === "-").map(([s]) => s)),
      conflict: new Set(ev.conflict || []),
    });
    root.querySelector("#rpni-t").textContent = ev.text;
  },
});

SLIDES.push({
  section: 3,
  title: "From RPNI to bimachines",
  builds: 5,
  html: () => `
    <div class="ptas">
      <div><h3 class="lt">Left prefix tree <span class="muted">prefixes of the inputs</span></h3><div id="pta-l" class="svgwrap fig"></div></div>
      <div><h3 class="rt">Right prefix tree <span class="muted">suffixes, read right to left</span></h3><div id="pta-r" class="svgwrap fig"></div></div>
    </div>
    <p class="note">The six training inputs of the Figure 1 walkthrough: <span class="mono">${WALKTHROUGH.train.join(", ")}</span>.</p>
    <table class="map">
      <thead><tr><th>RPNI (DFA)</th><th>Our learner (bimachine)</th></tr></thead>
      <tbody>
        <tr data-b="1"><td>one prefix tree</td><td>a <b>left</b> prefix tree and a <b>right</b> prefix tree</td></tr>
        <tr data-b="2"><td>states labelled accept / reject</td><td>a partial output table ω(q, a, p), filled from the aligned chunks</td></tr>
        <tr data-b="3"><td>conflict: an accepting state meets a rejecting one</td><td>conflict: one cell of ω is asked for two different chunks</td></tr>
        <tr data-b="4"><td>red/blue merge-and-fold</td><td>red/blue merge-and-fold, <b>alternating</b> left and right passes</td></tr>
      </tbody>
    </table>`,
  update(root) {
    const snap = walkthrough().events[0].snapshot;
    for (const [side, id] of [["left", "pta-l"], ["right", "pta-r"]]) {
      drawDFA(root.querySelector(`#${id}`), snap[side], {
        alphabet: ["a", "b"], mirror: side === "right", red: [snap[side].start], blue: [], rings: [], fresh: null, marks: new Map(),
      });
    }
  },
});

SLIDES.push({
  section: 4,
  title: "Help from an oracle",
  builds: 4,
  html: () => {
    const ev = walkthrough().events.find((e) => e.kind === "reject-witness");
    // π(u) is the longest common prefix of the witness strings π(u)·z.
    const pi = ev.witnesses.map(([x]) => x).reduce((p, x) => { while (!x.startsWith(p)) p = p.slice(0, -1); return p; });
    const wit = ev.witnesses.map(([x, y]) => {
      const bad = x === ev.conflict.witness;
      return `<li class="${bad ? "bad" : ""}"><span class="mono">${x}</span><span class="mono">${y.map((c, i) => (bad && i === ev.conflict.position ? `<b>${chunk(c)}</b>` : chunk(c))).join("·")}</span></li>`;
    }).join("");
    const cq = "a" + "b" + "a";
    return `
    <div class="two even">
      <div>
        <p data-b="0" class="lead">A <b>chunk oracle</b> answers any input with its aligned output chunks.</p>
        <div data-b="0" class="row">${inputBox("in-or")}<span id="or-out" class="mono big"></span></div>
        <div data-b="1">
          <h3>1. Witness queries while merging</h3>
          <p>The data alone rarely refutes a bad merge. For a candidate merge of <i>u</i> into <i>r</i>, ask about short extensions of <i>u</i>'s representative (π(u)·z on the left, h·σ(u) on the right) and reject the merge if the merged hypothesis disagrees.</p>
        </div>
      </div>
      <div>
        <div data-b="1" class="ex">
          <p class="note">Walkthrough: merge left state ${ev.u} (π = <code>${pi}</code>) into the start state ${ev.r}?</p>
          <ul class="qlist big">${wit}</ul>
          <p class="note">On <code>${ev.conflict.witness}</code> the merged hypothesis outputs <b>${chunk(ev.conflict.outs[0])}</b> at position ${ev.conflict.position + 1}; the oracle says <b>${chunk(ev.conflict.outs[1])}</b>. Rejected: state ${ev.u} remembers “the previous symbol was <code>a</code>”.</p>
        </div>
        <div data-b="2" class="ex">
          <h3>2. Completion queries</h3>
          <p>A missing entry ω(q, a, p) is the middle chunk of π(q)·a·σ(p).</p>
          <p class="note">For example, ω(2, b, 4) in Figure 1: π(2) = <code>a</code>, σ(4) = <code>a</code>; query <code>${cq}</code> ↦ ${fig1(cq).map((c, i) => (i === 1 ? `<b>${c}</b>` : c)).join("·")}.</p>
        </div>
      </div>
    </div>
    <div class="takeaway" data-b="3">
      <p>Only membership-style questions: no equivalence queries. Without the oracle, the same learner runs <b>sample-only</b> (see the random-bimachine experiments in the paper).</p>
    </div>`;
  },
  update(root) {
    const draw = () => { root.querySelector("#or-out").textContent = "↦ " + (fig1(ctx.input).map(chunk).join("·") || "(empty)"); };
    bindInput(root, "in-or", draw);
    draw();
  },
});

SLIDES.push({
  section: 5,
  title: "Next: learning Figure 1 step by step",
  builds: 1,
  html: () => {
    const w = walkthrough();
    const data = w.events[0].data;
    return `
    <div class="two even">
      <div>
        <h3>Six aligned training examples</h3>
        <ul class="qlist big">${data.map(([x, y]) => `<li><span class="mono">${x}</span><span class="mono">${y.map(chunk).join("·")}</span></li>`).join("")}</ul>
      </div>
      <div>
        <h3>Settings</h3>
        <ul class="points small">
          <li>At most <i>k</i> = ${WALKTHROUGH.kWitness} witness strings per merge, each π(u)·z or h·σ(u) with |z|, |h| ≤ ${WALKTHROUGH.contMaxLen}</li>
          <li>${w.events.length} steps, ${w.events.at(-1).queryCount} distinct oracle queries</li>
          <li>Prefix trees → merging → completion → minimization</li>
        </ul>
        <p><button type="button" class="primary big" data-action="guided">Open “Guided: Figure 1” →</button></p>
      </div>
    </div>`;
  },
});

export { SLIDES as INTRO_SLIDES, SECTIONS as INTRO_SECTIONS };
