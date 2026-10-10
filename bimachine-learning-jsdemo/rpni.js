// A small red/blue RPNI for DFAs, used by the introduction slides.
// It records one event per step, in the same spirit as learner.js:
// a snapshot of the automaton plus the red/blue sets and any folded classes.

const shortlex = (u, v) => u.length - v.length || (u < v ? -1 : u > v ? 1 : 0);

class Automaton {
  constructor() {
    this.trans = new Map();   // state -> Map(symbol -> state)
    this.label = new Map();   // state -> "+" | "-"
    this.start = 0;
    this.n = 1;
    this.trans.set(0, new Map());
  }
  static prefixTree(pos, neg) {
    const A = new Automaton();
    const words = [...pos.map((w) => [w, "+"]), ...neg.map((w) => [w, "-"])];
    // Number states in shortlex order of their prefixes, as in the bimachine demo.
    const prefixes = new Set([""]);
    for (const [w] of words) for (let i = 1; i <= w.length; i++) prefixes.add(w.slice(0, i));
    const ids = new Map([...prefixes].sort(shortlex).map((p, i) => [p, i]));
    A.n = ids.size;
    for (const [p, id] of ids) {
      if (!A.trans.has(id)) A.trans.set(id, new Map());
      if (p) A.trans.get(ids.get(p.slice(0, -1))).set(p.at(-1), id);
    }
    for (const [w, l] of words) A.label.set(ids.get(w), l);
    return A;
  }
  clone() {
    const A = new Automaton();
    A.trans = new Map([...this.trans].map(([s, m]) => [s, new Map(m)]));
    A.label = new Map(this.label);
    A.start = this.start;
    A.n = this.n;
    return A;
  }
  states() { return [...this.trans.keys()]; }
  // Representatives: shortlex-least strings reaching each state.
  reprs(alphabet) {
    const rep = new Map([[this.start, ""]]);
    const queue = [this.start];
    while (queue.length) {
      const s = queue.shift();
      for (const a of alphabet) {
        const t = this.trans.get(s)?.get(a);
        if (t !== undefined && !rep.has(t)) { rep.set(t, rep.get(s) + a); queue.push(t); }
      }
    }
    return rep;
  }
  toJSON() {
    const edges = [];
    for (const [s, m] of this.trans) for (const [a, t] of m) edges.push([s, a, t]);
    return { states: this.states().sort((a, b) => a - b), start: this.start, edges, label: [...this.label], sink: null };
  }
}

// Merge `from` into `into` and fold until deterministic. Returns the merged
// automaton, the classes of identified states, and a label conflict if any.
function mergeAndFold(A, into, from, red) {
  const parent = new Map(A.states().map((s) => [s, s]));
  const find = (s) => (parent.get(s) === s ? s : find(parent.get(s)));
  const pending = [[into, from]];
  while (pending.length) {
    let [x, y] = pending.pop();
    x = find(x); y = find(y);
    if (x === y) continue;
    // Red states keep their names; otherwise the smaller number survives.
    if (red.has(y) || (!red.has(x) && y < x)) [x, y] = [y, x];
    parent.set(y, x);
    // Fold: equal symbols out of x and y must lead to the same state.
    for (const [a, ty] of A.trans.get(y)) {
      const tx = A.trans.get(x).get(a);
      if (tx === undefined) A.trans.get(x).set(a, ty);
      else pending.push([tx, ty]);
    }
  }
  const classes = new Map();
  for (const s of A.states()) {
    const r = find(s);
    if (!classes.has(r)) classes.set(r, []);
    classes.get(r).push(s);
  }
  const B = new Automaton();
  B.trans = new Map();
  B.start = find(A.start);
  let conflict = null;
  for (const [r, members] of classes) {
    B.trans.set(r, new Map());
    const labels = new Set(members.map((s) => A.label.get(s)).filter(Boolean));
    if (labels.size > 1) conflict = conflict || members.filter((s) => A.label.has(s));
    if (labels.size) B.label.set(r, [...labels][0]);
  }
  for (const [s, m] of A.trans) for (const [a, t] of m) B.trans.get(find(s)).set(a, find(t));
  return { merged: B, classes: [...classes.values()].filter((c) => c.length > 1), conflict };
}

export function rpni(pos, neg, alphabet) {
  let A = Automaton.prefixTree(pos, neg);
  const events = [];
  let red = [A.start];
  const blueOf = () => {
    const redSet = new Set(red);
    const rep = A.reprs(alphabet);
    const blue = new Set();
    for (const r of red) for (const t of A.trans.get(r).values()) if (!redSet.has(t)) blue.add(t);
    return [...blue].sort((u, v) => shortlex(rep.get(u), rep.get(v)));
  };
  const emit = (ev) => events.push({ ...ev, snapshot: ev.snapshot || A.toJSON(), red: [...red], blue: blueOf() });
  emit({ kind: "init", text: `Prefix tree: one state per prefix of the sample. Accepted words end in a state marked +, rejected words in a state marked −.` });
  for (;;) {
    const blue = blueOf();
    if (!blue.length) break;
    const u = blue[0];
    const rep = A.reprs(alphabet);
    let done = false;
    for (const r of [...red].sort((x, y) => shortlex(rep.get(x), rep.get(y)))) {
      const res = mergeAndFold(A.clone(), r, u, new Set(red));
      if (res.conflict) {
        emit({ kind: "reject", u, r, classes: res.classes, conflict: res.conflict,
          text: `Try merging blue ${u} into red ${r}. Folding identifies an accepting and a rejecting state, so the merge is rejected.` });
      } else {
        emit({ kind: "try", u, r, classes: res.classes,
          text: `Try merging blue ${u} into red ${r}. Folding keeps the automaton deterministic and no + state meets a − state: accept.` });
        A = res.merged;
        emit({ kind: "merged", u, r, text: `Merged ${u} into ${r}. The automaton now generalizes beyond the sample.` });
        done = true;
        break;
      }
    }
    if (!done) {
      red.push(u);
      emit({ kind: "promote", u, text: `No red state can absorb ${u}, so ${u} is promoted to red.` });
    }
  }
  emit({ kind: "done", text: `No blue states remain. The result is the minimal DFA for “an even number of a's”.` });
  return events;
}
