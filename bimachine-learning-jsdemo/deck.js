// A deck of presentation slides driven by the page's step controls. Each slide
// has a number of builds; the controls step through all builds of all slides in
// order. Used by the "Introduction" and "Experiments" tabs.
//
// A slide is { section, title, builds, html(), update(root, build, animate) }.
// Elements with data-b="k" become visible at build k, and buttons with
// data-action="name" call actions[name]().

export class Deck {
  constructor(container, slides, sections, actions = {}) {
    this.container = container;
    this.slides = slides;
    this.sectionNames = sections;
    this.actions = actions;
    this.index = [];  // step -> [slide, build]
    slides.forEach((s, i) => { for (let b = 0; b < s.builds; b++) this.index.push([i, b]); });
    this.mounted = -1;
  }
  get length() { return this.index.length; }
  sections() { return this.sectionNames; }
  locate(step) {
    const [slide, build] = this.index[step];
    return { slide, build, slides: this.slides.length, builds: this.slides[slide].builds, section: this.slides[slide].section };
  }
  // First step of the slide containing `step`, or of the slide `delta` slides away.
  slideStart(step, delta = 0) {
    const target = Math.max(0, Math.min(this.slides.length - 1, this.index[step][0] + delta));
    return this.index.findIndex(([s]) => s === target);
  }
  sectionStart(sec) { return this.index.findIndex(([s]) => this.slides[s].section === sec); }
  render(step, animate) {
    const [i, b] = this.index[step];
    const slide = this.slides[i];
    if (this.mounted !== i) {
      const head = slide.section === null ? "" : `<div class="kicker">${this.sectionNames[slide.section]}</div><h2 class="stitle">${slide.title}</h2>`;
      this.container.innerHTML = `<article class="slide">${head}<div class="sbody">${slide.html()}</div></article>`;
      this.mounted = i;
      for (const btn of this.container.querySelectorAll("[data-action]")) {
        btn.onclick = () => this.actions[btn.dataset.action]?.();
      }
    }
    const root = this.container.querySelector(".slide");
    for (const e of root.querySelectorAll("[data-b]")) {
      const k = Number(e.dataset.b);
      e.classList.toggle("shown", k <= b);
      e.classList.remove("enter");
      if (animate && k === b) { void e.offsetWidth; e.classList.add("enter"); }
    }
    if (slide.update) slide.update.call(slide, root, b, animate);
  }
}
