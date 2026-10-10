import { learnBimachine, Oracle } from "./learner.js";
import { ORACLES, WALKTHROUGH, compileOracle } from "./presets.js";
import { drawDFA, RING_COLORS } from "./draw.js";
import { Deck } from "./deck.js";
import { INTRO_SLIDES, INTRO_SECTIONS } from "./intro.js";
import { EXP_SLIDES, EXP_SECTIONS } from "./experiments.js";

const $ = (id) => document.getElementById(id);

const MAX_STEPS = 20000;
const MAX_MILLIS = 10000;
let run = null;        // {events, alphabet, oracle, guided}
let step = 0;
let timer = null;
let mode = "guided";   // "intro" | "guided" | "custom" | "experiments"
// Slide decks: the Introduction and Experiments tabs. Each remembers its step.
const deckActions = { guided: () => guided(), experiments: () => experiments() };
const decks = {
  intro: new Deck($("intro"), INTRO_SLIDES, INTRO_SECTIONS, deckActions),
  experiments: new Deck($("experiments"), EXP_SLIDES, EXP_SECTIONS, deckActions),
};
const deckStep = { intro: 0, experiments: 0 };
let deckAnimate = false;
const deck = () => decks[mode];

// ---------------------------------------------------------------------------
// Explanations shown the first time each kind of step appears
// ---------------------------------------------------------------------------

const GUIDE = {
  init: [
    "A bimachine has a <b>left automaton</b> that reads the input from left to right, a <b>right automaton</b> that reads it from right to left, and an <b>output table ω</b>. At each position, the left state (a summary of everything before the symbol) and the right state (a summary of everything after it) select the output chunk ω(q, a, p).",
    "The learner starts from prefix trees: every training prefix gets its own left state and every suffix its own right state. This reproduces the training data exactly but generalizes to nothing yet. Each aligned output chunk fixes one entry of the output table.",
  ],
  round: [
    "Learning generalizes by <b>merging states</b>, one side at a time, in the style of RPNI. <b>Red</b> states are settled; <b>blue</b> states are one transition away from a red state and are the candidates for merging. Initially only the start state is red.",
  ],
  pick: [
    "States are considered in shortlex order of their <em>representatives</em>, the shortest strings reaching them. For the right automaton the representative is a suffix of the input.",
  ],
  "reject-fold": [
    "Merging two states can force further merges: if both have an <code>a</code>-transition, the automaton stays deterministic only if those two targets merge as well. This is <b>merge-and-fold</b>; the coloured rings show the groups of states that end up identified.",
    "After folding, every output entry must still be unique. Here two entries that become the same cell ask for different chunks (outlined in the table), so the merge contradicts the data and is rejected.",
  ],
  "reject-data": [
    "The merge is consistent in the output table, but the merged automaton no longer produces the training example's chunks, so it is rejected.",
  ],
  "reject-witness": [
    "The training data cannot rule this merge out, so the learner asks the <b>oracle</b>. It builds <b>witness strings</b>: the blue state's representative followed by short continuations (left pass) or preceded by short heads (right pass). The oracle returns their aligned chunks, and the merged hypothesis must agree with all of them. One disagreement is enough to reject the merge.",
  ],
  accept: [
    "This merge survives both checks: the output table stays consistent, and the merged hypothesis agrees with every witness answer from the oracle.",
  ],
  merged: [
    "The witness strings and their answers are now part of the hypothesis: their paths are added to both automata (dashed states) and their chunks become output entries. Later merges must respect them as well. After every accepted merge the pass restarts from the root.",
  ],
  promote: [
    "If no red state can absorb a blue state, the blue state must differ from all of them, so it is <b>promoted</b> to red. Its successors become the new blue candidates.",
  ],
  converged: [
    "Merging stops after a round in which neither pass accepted a merge.",
  ],
  complete: [
    "<b>Completion.</b> Some output entries ω(q, a, p) may never have been observed. For each missing one the learner asks the oracle about the string π(q)·a·σ(p): the representative prefix of q, the symbol a, and the representative suffix of p. The chunk at the middle position is exactly ω(q, a, p). Transitions that are still missing go to a sink state.",
  ],
  minimize: [
    "<b>Minimization.</b> Two left states are interchangeable if they have the same output row (the same chunk for every symbol and every right state) and their transitions lead to interchangeable states; right states are compared by output columns in the same way. This is partition refinement, as in DFA minimization. The table below lists each state's row or column and its block.",
    "Here every state already has its own block. In the runs we have examined, including the paper's benchmark battery, merge-and-fold with witness validation reaches a machine that minimization cannot shrink further, so this step confirms minimality.",
  ],
  stopped: [
    "Each accepted merge adds its witness strings as new paths, and with a small sample and a large witness budget those paths can keep producing new states to merge. The steps so far can still be browsed.",
  ],
  done: [
    "The learner is finished. Use the box below the output table to run any string through the learned machine and compare with the oracle.",
  ],
};

const GUIDE_DONE_FIG1 =
  "This is exactly the bimachine of Figure 1 in the paper, with states numbered from 0: left state 1 records that the previous symbol was <code>a</code> (Figure 1's state 2), and right state 1 records that an <code>a</code> occurs further right (Figure 1's state 4). Try the paper's input <code>aabbabaabb</code> in the box below the output table.";

// ---------------------------------------------------------------------------
// Running the learner
// ---------------------------------------------------------------------------

function parseTrain(text) {
  return text.split(/[\s,]+/).filter(Boolean).map((w) => (w === "-" ? "" : w));
}

function startRun({ oracleKey, oracleSource, train, k, len, guided }) {
  stop();
  const spec = ORACLES[oracleKey];
  const alphabet = spec.alphabet;
  const fn = compileOracle(oracleSource);
  const bad = train.find((w) => [...w].some((c) => !alphabet.includes(c)));
  if (bad !== undefined) throw new Error(`"${bad}" uses a symbol outside the alphabet {${alphabet.join(", ")}}`);
  const oracle = new Oracle(fn);
  const res = learnBimachine({ alphabet, train, oracle, kWitness: k, contMaxLen: len, headMaxLen: len, maxEvents: MAX_STEPS, maxMillis: MAX_MILLIS });
  const seen = new Set();
  for (const ev of res.events) {
    ev.firstOfKind = !seen.has(ev.kind);
    seen.add(ev.kind);
  }
  run = { events: res.events, alphabet: [...alphabet].sort(), oracle, guided, fn };
  step = 0;
  $("scrub").max = String(run.events.length - 1);
  render();
}

// ---------------------------------------------------------------------------
// Output table, oracle panel, minimization table, tester
// ---------------------------------------------------------------------------

const chunk = (c) => (c === "" ? "ε" : c);
const chunkSeq = (y, mark = -1) =>
  y.map((c, i) => (i === mark ? `<b>${esc(chunk(c))}</b>` : esc(chunk(c)))).join("·") || "(empty)";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const word = (w) => (w === "" ? "ε" : w);

function omegaTable(snapshot, prevSnapshot, ev) {
  const QL = snapshot.left.states;
  const QR = snapshot.right.states;
  const alpha = run.alphabet;
  const cell = new Map(snapshot.omega.map(([q, a, p, out, src]) => [`${q}|${a}|${p}`, { out, src }]));
  const prev = new Set((prevSnapshot?.omega || []).map(([q, a, p, out]) => `${q}|${a}|${p}|${out}`));
  const conflict = new Set();
  if (ev.kind === "reject-fold" && ev.conflict?.keys) for (const [q, a, p] of ev.conflict.keys) conflict.add(`${q}|${a}|${p}`);
  // Only rows and columns with at least one defined entry are shown.
  const rows = QL.filter((q) => alpha.some((a) => QR.some((p) => cell.has(`${q}|${a}|${p}`))));
  const cols = alpha.map((a) => [a, QR.filter((p) => QL.some((q) => cell.has(`${q}|${a}|${p}`)))]).filter(([, ps]) => ps.length);
  const hiddenRows = QL.length - rows.length;
  const hiddenCols = alpha.length * QR.length - cols.reduce((n, [, ps]) => n + ps.length, 0);
  if (!rows.length) return `<p class="note">No output entries yet.</p>`;
  let html = "<table><thead><tr><th rowspan=2>q \\ a, p</th>";
  for (const [a, ps] of cols) html += `<th colspan=${ps.length}><b>${esc(a)}</b></th>`;
  html += "</tr><tr>";
  for (const [, ps] of cols) for (const p of ps) html += `<th>p=${p}</th>`;
  html += "</tr></thead><tbody>";
  for (const q of rows) {
    html += `<tr><th>${q}</th>`;
    for (const [a, ps] of cols) {
      for (const p of ps) {
        const k = `${q}|${a}|${p}`;
        const e = cell.get(k);
        if (!e) { html += "<td></td>"; continue; }
        const cls = [e.src];
        if (conflict.has(k)) cls.push("conflict");
        else if (prevSnapshot && e.src !== "data" && !prev.has(`${k}|${e.out}`)) cls.push("new");
        html += `<td class="${cls.join(" ")}" title="ω(${q}, ${esc(a)}, ${p}) = ${esc(chunk(e.out))} (${e.src})">${esc(chunk(e.out))}</td>`;
      }
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  if (hiddenRows || hiddenCols) {
    html += `<p class="note">Hidden: ${hiddenRows} left ${hiddenRows === 1 ? "state" : "states"} and ${hiddenCols} (a, p) ${hiddenCols === 1 ? "column" : "columns"} with no defined entry.</p>`;
  }
  return html;
}

function minimizeTable(ev) {
  const byState = new Map(ev.part);
  const blocks = [...new Set(ev.part.map(([, b]) => b))];
  const color = (b) => RING_COLORS[blocks.indexOf(b) % RING_COLORS.length];
  const side = ev.side === "L" ? "left" : "right";
  let html = `<h3>${ev.side === "L" ? "Left" : "Right"} states: output ${ev.side === "L" ? "row" : "column"}, successors, and block</h3>`;
  html += `<table><thead><tr><th>${side} state</th><th>${ev.side === "L" ? "row (a, then p)" : "column (q, then a)"}</th>`;
  for (const a of run.alphabet) html += `<th>—${esc(a)}→</th>`;
  html += "<th>block</th></tr></thead><tbody>";
  for (const { state, row, next } of ev.signatures) {
    const b = byState.get(state);
    html += `<tr><th>${state}</th><td>${row.map((c) => esc(chunk(c))).join(" ")}</td>`;
    for (const t of next) html += `<td>${t}</td>`;
    html += `<td style="color:${color(b)};font-weight:700">■ ${b}</td></tr>`;
  }
  return html + "</tbody></table>";
}

function oraclePanel(ev) {
  const parts = [];
  if (ev.kind === "init") {
    parts.push(`<p class="note">Training data: aligned examples (one output chunk per input symbol).</p><ul class="qlist">`);
    for (const [x, y] of ev.data) parts.push(`<li><span>${esc(word(x))}</span><span class="chunks">${chunkSeq(y)}</span></li>`);
    parts.push("</ul>");
  } else if (ev.witnesses) {
    const bad = ev.conflict?.witness;
    parts.push(`<p class="note">Witness queries for ${ev.side === "L" ? "left" : "right"} merge ${ev.u} → ${ev.r} (${ev.witnesses.length}):</p><ul class="qlist">`);
    for (const [x, y] of ev.witnesses) {
      const isBad = x === bad;
      parts.push(`<li class="${isBad ? "bad" : ""}"><span>${esc(x)}</span><span class="chunks">${chunkSeq(y, isBad ? ev.conflict.position : -1)}</span></li>`);
    }
    parts.push("</ul>");
    if (bad !== undefined) {
      parts.push(`<p class="note">At position ${ev.conflict.position + 1} of <code>${esc(bad)}</code> the oracle says <b>${esc(chunk(ev.conflict.outs[1]))}</b>; the merged hypothesis already has <b>${esc(chunk(ev.conflict.outs[0]))}</b>.</p>`);
    }
  } else if (ev.kind === "complete" && ev.queries.length) {
    parts.push(`<p class="note">Completion queries π(q)·a·σ(p); the chunk at the marked position fills ω(q, a, p):</p><ul class="qlist">`);
    for (const { entry, x, pos, y } of ev.queries) {
      parts.push(`<li><span>${esc(x)} <span class="muted">ω(${entry[0]},${esc(entry[1])},${entry[2]})</span></span><span class="chunks">${chunkSeq(y, pos)}</span></li>`);
    }
    parts.push("</ul>");
  } else if (ev.kind === "reject-data") {
    parts.push(`<p class="note">Training example that the merged hypothesis gets wrong:</p><ul class="qlist"><li class="bad"><span>${esc(word(ev.example[0]))}</span><span class="chunks">${chunkSeq(ev.example[1])}</span></li></ul>`);
  } else {
    parts.push(`<p class="note">No oracle queries in this step.</p>`);
  }
  return parts.join("");
}

function snapshotTransduce(snapshot, x) {
  const step = (dfa, s, a) => {
    for (const [u, b, t] of dfa.edges) if (u === s && b === a) return t;
    return dfa.sink ?? null;
  };
  const n = x.length;
  const q = [snapshot.left.start];
  for (let i = 0; i < n; i++) q.push(q[i] === null ? null : step(snapshot.left, q[i], x[i]));
  const p = new Array(n + 1);
  p[n] = snapshot.right.start;
  for (let i = n - 1; i >= 0; i--) p[i] = p[i + 1] === null ? null : step(snapshot.right, p[i + 1], x[i]);
  const cell = new Map(snapshot.omega.map(([a, b, c, out]) => [`${a}|${b}|${c}`, out]));
  const out = [...x].map((a, i) => (q[i] === null || p[i + 1] === null ? undefined : cell.get(`${q[i]}|${a}|${p[i + 1]}`)));
  return { q, p, out };
}

function renderTester(snapshot) {
  const x = $("t-input").value.trim();
  const box = $("t-out");
  if ([...x].some((c) => !run.alphabet.includes(c))) {
    box.innerHTML = `<p class="note">Use only the symbols {${run.alphabet.join(", ")}}.</p>`;
    return;
  }
  const { q, p, out } = snapshotTransduce(snapshot, x);
  let truth = null;
  try { truth = run.fn(x).map(String); } catch { truth = null; }
  const cellOrQ = (v) => (v === null || v === undefined ? "?" : v);
  let html = "<table><tbody>";
  html += `<tr><th>left state</th>${q.slice(0, x.length).map((v) => `<td class="l">${cellOrQ(v)}</td>`).join("")}</tr>`;
  html += `<tr><th>input</th>${[...x].map((c) => `<td><b>${esc(c)}</b></td>`).join("")}</tr>`;
  html += `<tr><th>right state</th>${p.slice(1).map((v) => `<td class="r">${cellOrQ(v)}</td>`).join("")}</tr>`;
  html += `<tr><th>output</th>${out.map((c, i) => `<td class="${truth && c !== truth[i] ? "bad" : ""}">${c === undefined ? "?" : esc(chunk(c))}</td>`).join("")}</tr>`;
  if (truth) html += `<tr><th>oracle</th>${truth.map((c) => `<td>${esc(chunk(c))}</td>`).join("")}</tr>`;
  html += "</tbody></table>";
  const ok = truth && out.every((c, i) => c === truth[i]);
  html += `<p class="note">${x.length === 0 ? "Empty input: empty output." : ok ? "Matches the oracle." : "? marks an undefined state or output entry; red outputs disagree with the oracle."} Each column shows the left state before the symbol and the right state for the suffix after it.</p>`;
  box.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Rendering a step
// ---------------------------------------------------------------------------

const PHASES = [
  ["Prefix trees", (e) => e.kind === "init"],
  ["Merging", (e) => ["round", "pick", "reject-fold", "reject-data", "reject-witness", "accept", "merged", "promote", "pass-end", "converged"].includes(e.kind)],
  ["Completion", (e) => e.kind === "complete"],
  ["Minimization", (e) => e.kind === "minimize"],
  ["Done", (e) => e.kind === "done" || e.kind === "stopped"],
];

function currentRound() {
  for (let i = step; i >= 0; i--) if (run.events[i].kind === "round") return run.events[i].round;
  return null;
}

function renderDeck() {
  const d = deck(), at = deckStep[mode];
  const loc = d.locate(at);
  $("scrub").max = String(d.length - 1);
  $("scrub").value = String(at);
  $("counter").textContent = `Slide ${loc.slide + 1} / ${loc.slides}` + (loc.builds > 1 ? ` · ${loc.build + 1}/${loc.builds}` : "");
  $("b-play").textContent = timer ? "⏸ Pause" : "▶ Play";
  $("phase").innerHTML = d.sections().map((name, i) => `<span class="${i === loc.section ? "now" : ""} jump" data-sec="${i}">${name}</span>`).join("");
  for (const chip of $("phase").querySelectorAll("[data-sec]")) {
    chip.onclick = () => { stop(); go(d.sectionStart(Number(chip.dataset.sec)), false); };
  }
  d.render(at, deckAnimate);
  deckAnimate = false;
}

function render() {
  if (decks[mode]) return renderDeck();
  if (!run) return;
  const ev = run.events[step];
  const prev = step > 0 ? run.events[step - 1] : null;
  $("scrub").value = String(step);
  $("counter").textContent = `Step ${step + 1} / ${run.events.length}`;
  $("b-play").textContent = timer ? "⏸ Pause" : "▶ Play";

  const phaseIdx = PHASES.findIndex(([, f]) => f(ev));
  const round = currentRound();
  $("phase").innerHTML = PHASES.map(([name], i) => `<span class="${i === phaseIdx ? "now" : ""}">${name}${name === "Merging" && round && i === phaseIdx ? ` · round ${round}${ev.side ? `, ${ev.side === "L" ? "left" : "right"} pass` : ""}` : ""}</span>`).join("");

  $("step-text").textContent = ev.text;
  const guide = $("guide");
  const notes = ev.firstOfKind ? [...(GUIDE[ev.kind] || [])] : [];
  if (ev.kind === "done" && run.guided) notes.push(GUIDE_DONE_FIG1);
  guide.hidden = notes.length === 0;
  guide.innerHTML = notes.map((n) => `<p>${n}</p>`).join("");

  const snap = ev.snapshot;
  const onSide = (side) => ev.side === side;
  const rings = (side) => (onSide(side) && ev.classes ? ev.classes : []);
  const marks = (side) => {
    const m = new Map();
    if (onSide(side) && ev.u !== undefined && ev.kind !== "merged") {
      m.set(ev.u, "u");
      if (ev.r !== undefined) m.set(ev.r, "r");
    }
    return m;
  };
  const fresh = (side) => new Set(ev.kind === "merged" ? ev.newStates[side] : []);
  for (const side of ["L", "R"]) {
    drawDFA($(side === "L" ? "g-left" : "g-right"), side === "L" ? snap.left : snap.right, {
      alphabet: run.alphabet,
      mirror: side === "R",
      red: ev.red[side],
      blue: ev.blue[side],
      rings: rings(side),
      fresh: fresh(side),
      marks: marks(side),
    });
  }

  $("omega").innerHTML = omegaTable(snap, prev?.snapshot, ev);
  $("minimize").innerHTML = ev.kind === "minimize" ? minimizeTable(ev) : "";
  $("oracle-panel").innerHTML = oraclePanel(ev);
  $("q-count").textContent = `· ${ev.queryCount} distinct ${ev.queryCount === 1 ? "query" : "queries"} so far`;
  renderTester(snap);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function go(i, animate = true) {
  if (decks[mode]) {
    const next = Math.max(0, Math.min(deck().length - 1, i));
    deckAnimate = animate && next === deckStep[mode] + 1;
    deckStep[mode] = next;
    history.replaceState(null, "", `#${mode === "intro" ? "intro" : "exp"}=${next + 1}`);
    render();
    return;
  }
  if (!run) return;
  step = Math.max(0, Math.min(run.events.length - 1, i));
  if (run.guided) history.replaceState(null, "", `#step=${step + 1}`);
  render();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (run) render();
}
function play() {
  if (decks[mode]) {
    // In a slide deck, play runs through the builds of the current slide.
    if (timer) return stop();
    const at = deckStep[mode];
    const end = deck().slideStart(at, 1) - 1;
    const last = end < at ? deck().length - 1 : end;
    if (at >= last) return go(at + 1);
    timer = setInterval(() => {
      go(deckStep[mode] + 1);
      if (deckStep[mode] >= last) stop();
    }, 1800);
    render();
    return;
  }
  if (!run) return;
  if (timer) return stop();
  if (step >= run.events.length - 1) step = 0;
  timer = setInterval(() => {
    if (step >= run.events.length - 1) return stop();
    go(step + 1);
  }, 1400);
  render();
}

const cur = () => (decks[mode] ? deckStep[mode] : step);

$("b-first").onclick = () => { stop(); go(0); };
$("b-prev").onclick = () => { stop(); go(cur() - 1); };
$("b-next").onclick = () => { stop(); go(cur() + 1); };
$("b-last").onclick = () => { stop(); go(Infinity); };
$("b-play").onclick = play;
$("scrub").oninput = (e) => { stop(); go(Number(e.target.value), false); };
$("t-input").oninput = () => run && renderTester(run.events[step].snapshot);
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  // Presentation remotes usually send PageDown / PageUp.
  if (decks[mode] && e.shiftKey && e.key === "ArrowRight") { stop(); go(deck().slideStart(cur(), 1), false); }
  else if (decks[mode] && e.shiftKey && e.key === "ArrowLeft") { stop(); go(deck().slideStart(cur(), -1), false); }
  else if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); stop(); go(cur() + 1); }
  else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); stop(); go(cur() - 1); }
  else if (e.key === " ") { e.preventDefault(); play(); }
  else if (e.key === "Home") { stop(); go(0); }
  else if (e.key === "End") { stop(); go(Infinity); }
});

// Modes.
function showError(msg) {
  const box = $("c-error");
  box.hidden = !msg;
  box.textContent = msg || "";
}

function setMode(m) {
  stop();
  mode = m;
  for (const k of ["intro", "guided", "custom", "experiments"]) $(`mode-${k}`).classList.toggle("active", k === m);
  $("custom").hidden = m !== "custom";
  $("intro").hidden = m !== "intro";
  $("experiments").hidden = m !== "experiments";
  for (const e of document.querySelectorAll(".learner-only")) e.hidden = Boolean(decks[m]);
}

function introduction() {
  setMode("intro");
  go(deckStep.intro, false);
}

function experiments() {
  setMode("experiments");
  window.scrollTo(0, 0);
  go(deckStep.experiments, false);
}

function guided() {
  setMode("guided");
  window.scrollTo(0, 0);
  $("t-input").value = "aabbabaabb";
  const o = ORACLES[WALKTHROUGH.oracle];
  startRun({
    oracleKey: WALKTHROUGH.oracle, oracleSource: o.source, train: WALKTHROUGH.train,
    k: WALKTHROUGH.kWitness, len: WALKTHROUGH.contMaxLen, guided: true,
  });
}

function randomSample(alphabet, n = 6, maxLen = 5) {
  const words = new Set();
  let guard = 0;
  while (words.size < n && guard++ < 1000) {
    const len = 1 + Math.floor(Math.random() * maxLen);
    let w = "";
    for (let i = 0; i < len; i++) w += alphabet[Math.floor(Math.random() * alphabet.length)];
    words.add(w);
  }
  return [...words];
}

function loadPreset(key) {
  const o = ORACLES[key];
  $("c-oracle").value = o.source;
  $("c-train").value = key === WALKTHROUGH.oracle ? WALKTHROUGH.train.join(" ") : randomSample(o.alphabet).join(" ");
  $("t-input").value = randomSample(o.alphabet, 1, 8)[0];
}

function custom() {
  setMode("custom");
  if (run) $("scrub").max = String(run.events.length - 1);
  render();
  showError("");
}

function runCustom() {
  showError("");
  const button = $("c-run");
  button.disabled = true;
  button.textContent = "Learning…";
  // Let the browser repaint before the (possibly long) synchronous run.
  setTimeout(() => {
    try {
      startRun({
        oracleKey: $("c-preset").value,
        oracleSource: $("c-oracle").value,
        train: parseTrain($("c-train").value),
        k: Number($("c-k").value),
        len: Number($("c-len").value),
        guided: false,
      });
    } catch (err) {
      showError(err.message || String(err));
    } finally {
      button.disabled = false;
      button.textContent = "Learn";
    }
  }, 30);
}

const sel = $("c-preset");
for (const [key, o] of Object.entries(ORACLES)) {
  const opt = document.createElement("option");
  opt.value = key;
  opt.textContent = `${o.title}  (Σ = {${o.alphabet.join(", ")}})`;
  sel.appendChild(opt);
}
sel.onchange = () => loadPreset(sel.value);
$("c-random").onclick = () => { $("c-train").value = randomSample(ORACLES[sel.value].alphabet).join(" "); };
$("c-run").onclick = runCustom;
$("mode-intro").onclick = introduction;
$("mode-experiments").onclick = experiments;
$("mode-guided").onclick = guided;
$("mode-custom").onclick = custom;

// Links: #intro=N opens the introduction at step N (the default page);
// #exp=N opens the experiments slides at step N;
// #step=N opens the walkthrough at step N; #custom=TASK opens "Try your own"
// with that task and a random sample, and runs it.
const customLink = /custom=(\w+)/.exec(location.hash);
const stepLink = /(?:^#|&)step=(\d+)/.exec(location.hash);
const introLink = /intro=(\d+)/.exec(location.hash);
const expLink = /exp=(\d+)/.exec(location.hash);
if (customLink && ORACLES[customLink[1]]) {
  sel.value = customLink[1];
  loadPreset(sel.value);
  custom();
  runCustom();
} else if (stepLink) {
  loadPreset(sel.value);
  guided();
  go(Number(stepLink[1]) - 1);
} else if (expLink) {
  loadPreset(sel.value);
  deckStep.experiments = Math.max(0, Math.min(decks.experiments.length - 1, Number(expLink[1]) - 1));
  experiments();
} else {
  loadPreset(sel.value);
  deckStep.intro = introLink ? Math.max(0, Math.min(decks.intro.length - 1, Number(introLink[1]) - 1)) : 0;
  introduction();
}
