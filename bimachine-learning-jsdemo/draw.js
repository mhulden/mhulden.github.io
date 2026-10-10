// Automaton drawing shared by the learner view and the introduction slides.

const SVGNS = "http://www.w3.org/2000/svg";
export const RING_COLORS = ["#eb6834", "#1baf7a", "#4a3aa7", "#e8a800", "#e87ba4", "#008300", "#2a78d6", "#8a4b2a"];

export function el(tag, attrs = {}, parent = null) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function layout(dfa, alphabet) {
  const trans = new Map();
  for (const [s, a, t] of dfa.edges) {
    if (!trans.has(s)) trans.set(s, new Map());
    trans.get(s).set(a, t);
  }
  const depth = new Map([[dfa.start, 0]]);
  const repr = new Map([[dfa.start, ""]]);
  const order = [dfa.start];
  for (let i = 0; i < order.length; i++) {
    const s = order[i];
    for (const a of alphabet) {
      const t = trans.get(s)?.get(a);
      if (t === undefined || depth.has(t)) continue;
      depth.set(t, depth.get(s) + 1);
      repr.set(t, repr.get(s) + a);
      order.push(t);
    }
  }
  const maxD = Math.max(0, ...depth.values());
  for (const s of dfa.states) {
    if (!depth.has(s)) {
      depth.set(s, maxD + 1);
      repr.set(s, "?");
      order.push(s);
    }
  }
  const layers = new Map();
  for (const s of order) {
    const d = depth.get(s);
    if (!layers.has(d)) layers.set(d, []);
    layers.get(d).push(s);
  }
  return { trans, depth, repr, layers };
}

export function drawDFA(container, dfa, opts) {
  const { alphabet, mirror, red, blue, rings, fresh, marks, accept, reject, conflict } = opts;
  container.innerHTML = "";
  const L = layout(dfa, alphabet);
  const DX = 64, DY = 42, R = 13, PAD = 34, TOP = 30;
  const nLayers = Math.max(...L.layers.keys()) + 1;
  const maxRows = Math.max(...[...L.layers.values()].map((l) => l.length));
  const W = PAD * 2 + (nLayers - 1) * DX + 30;
  const H = PAD * 2 + (maxRows - 1) * DY + 10 + TOP;
  const pos = new Map();
  for (const [d, states] of L.layers) {
    states.forEach((s, i) => {
      const x = PAD + 15 + d * DX;
      const y = TOP + PAD + (i - (states.length - 1) / 2) * DY + ((maxRows - 1) * DY) / 2;
      pos.set(s, [mirror ? W - x : x, y]);
    });
  }
  const scale = W < 320 ? 1.5 : 1;  // draw small machines larger
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W * scale, height: H * scale, role: "img" });
  const defs = el("defs", {}, svg);
  const m = el("marker", { id: `arrow-${container.id}`, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
  el("path", { d: "M0,0 L10,5 L0,10 z", fill: "currentColor", class: "arrowhead" }, m);
  svg.style.color = getComputedStyle(document.documentElement).getPropertyValue("--edge");

  // Edges grouped by (source, target).
  const groups = new Map();
  for (const [s, a, t] of dfa.edges) {
    const k = `${s}>${t}`;
    if (!groups.has(k)) groups.set(k, { s, t, labels: [] });
    groups.get(k).labels.push(a);
  }
  const edgeLayer = el("g", {}, svg);
  for (const { s, t, labels } of groups.values()) {
    const [x1, y1] = pos.get(s);
    const [x2, y2] = pos.get(t);
    const label = labels.sort().join(",");
    let d, lx, ly;
    if (s === t) {
      d = `M ${x1 - 6} ${y1 - R + 2} C ${x1 - 16} ${y1 - R - 22}, ${x1 + 16} ${y1 - R - 22}, ${x1 + 6} ${y1 - R + 2}`;
      lx = x1; ly = y1 - R - 19;
    } else {
      const forward = L.depth.get(t) === L.depth.get(s) + 1 && !groups.has(`${t}>${s}`);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;
      const sx = x1 + ux * R, sy = y1 + uy * R, ex = x2 - ux * R, ey = y2 - uy * R;
      if (forward) {
        d = `M ${sx} ${sy} L ${ex} ${ey}`;
        lx = (sx + ex) / 2; ly = (sy + ey) / 2 - 4;
      } else {
        const bend = groups.has(`${t}>${s}`) ? 18 : 26 + Math.min(40, Math.abs(L.depth.get(t) - L.depth.get(s)) * 6);
        const cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend;
        const a1 = Math.atan2(cy - y1, cx - x1), a2 = Math.atan2(cy - y2, cx - x2);
        d = `M ${x1 + R * Math.cos(a1)} ${y1 + R * Math.sin(a1)} Q ${cx} ${cy} ${x2 + R * Math.cos(a2)} ${y2 + R * Math.sin(a2)}`;
        lx = (x1 + x2) / 4 + cx / 2; ly = (y1 + y2) / 4 + cy / 2;
      }
    }
    el("path", { d, class: "edge", "marker-end": `url(#arrow-${container.id})` }, edgeLayer);
    const tx = el("text", { x: lx, y: ly, class: "elabel", "text-anchor": "middle" }, edgeLayer);
    tx.textContent = label;
  }

  // Start arrow.
  const [sx, sy] = pos.get(dfa.start);
  const dir = mirror ? 1 : -1;
  el("line", { x1: sx + dir * (R + 18), y1: sy, x2: sx + dir * (R + 2), y2: sy, class: "startarrow", "marker-end": `url(#arrow-${container.id})` }, edgeLayer);

  // Nodes.
  const ringOf = new Map();
  (rings || []).forEach((cls, i) => cls.forEach((s) => ringOf.set(s, RING_COLORS[i % RING_COLORS.length])));
  for (const s of dfa.states) {
    const [x, y] = pos.get(s);
    const classes = ["node"];
    if (red.includes(s)) classes.push("red");
    else if (blue.includes(s)) classes.push("blue");
    if (s === dfa.sink) classes.push("sink");
    if (fresh && fresh.has(s)) classes.push("fresh");
    const g = el("g", { class: classes.join(" ") }, svg);
    const title = el("title", {}, g);
    const rep = L.repr.get(s);
    title.textContent = `state ${s}; representative ${mirror ? "suffix" : "prefix"} "${mirror ? [...rep].reverse().join("") : rep}"${s === dfa.sink ? " (sink)" : ""}`;
    if (ringOf.has(s)) el("circle", { cx: x, cy: y, r: R + 4, class: "ring", stroke: ringOf.get(s) }, g);
    el("circle", { cx: x, cy: y, r: R, class: "body" }, g);
    // Optional DFA labels (RPNI slide): double circle for accepting, cross-hatch for rejecting.
    if (accept && accept.has(s)) el("circle", { cx: x, cy: y, r: R - 3, class: "body accept" }, g);
    if (reject && reject.has(s)) {
      g.classList.add("reject");
      el("text", { x: x + R - 1, y: y - R + 1, class: "rsign", "text-anchor": "middle" }, g).textContent = "−";
    }
    if (conflict && conflict.has(s)) g.classList.add("conflict");
    const t = el("text", { x, y }, g);
    t.textContent = String(s);
    if (marks && marks.has(s)) {
      const tag = el("text", { x, y: y + R + 10, class: "tag", "text-anchor": "middle" }, g);
      tag.textContent = marks.get(s);
    }
  }
  container.appendChild(svg);
}

