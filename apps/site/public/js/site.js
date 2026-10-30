// Cairn's site: smooth scrolling (Lenis), scroll reveals, and the small live
// demos. Everything still works, just stiller, with reduced motion.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  // Smooth scroll, with in-page links landing below the fixed header.
  let lenis = null;
  if (window.Lenis && !still.matches) {
    lenis = new Lenis({ autoRaf: true, anchors: { offset: -72 }, allowNestedScroll: true, stopInertiaOnNavigate: true });
  }
  const onScroll = (fn) => (lenis ? lenis.on("scroll", fn) : addEventListener("scroll", fn, { passive: true }));

  // The header gains a backdrop once the page moves.
  const nav = document.querySelector("[data-nav]");
  const navState = () => nav && nav.classList.toggle("scrolled", scrollY > 12);
  onScroll(navState);
  navState();

  // Sections rise into place as they come into view.
  const reveal = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        reveal.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  document.querySelectorAll("[data-reveal]").forEach((el, index) => {
    el.style.transitionDelay = el.closest(".hero") ? `${index * 90}ms` : "";
    reveal.observe(el);
  });

  // A loop that runs only while its element is on screen.
  function whileVisible(el, start, stop) {
    let on = false;
    new IntersectionObserver((entries) => {
      const visible = entries[entries.length - 1].isIntersecting;
      if (visible && !on) { on = true; start(); }
      if (!visible && on) { on = false; stop(); }
    }, { rootMargin: "80px 0px" }).observe(el);
  }

  // The hero: an interview email arrives, is filed as important, and becomes a task on both screens.
  const hero = document.querySelector("[data-hero]");
  if (hero) {
    const q = (s) => hero.querySelector(s);
    const checked = [q("[data-p-checked]"), q("[data-w-sync]")];
    const setText = (el, text) => el && el.textContent !== text && (el.textContent = text);
    const STEPS = [
      [0, () => { hero.className = "hero-stage"; checked.forEach((el) => setText(el, "Checked 3 min ago")); setText(q("[data-p-count]"), "0"); setText(q("[data-w-mail]"), "0"); setText(q("[data-w-count]"), "2"); setText(q("[data-p-add]"), "Add as task"); }],
      [1400, () => { hero.classList.add("checking"); checked.forEach((el) => setText(el, "Checking mail…")); }],
      [2600, () => { hero.classList.add("pushed"); }],
      [3300, () => { hero.classList.remove("checking"); hero.classList.add("found"); checked.forEach((el) => setText(el, "Checked just now")); setText(q("[data-p-count]"), "1"); setText(q("[data-w-mail]"), "1"); }],
      [5600, () => { hero.classList.remove("pushed"); }],
      [6200, () => { hero.classList.add("added"); setText(q("[data-p-add]"), "✓ In Tasks"); setText(q("[data-w-count]"), "3"); }],
    ];
    const LOOP = 11000;
    let timers = [];
    const play = () => {
      timers.forEach(clearTimeout);
      timers = STEPS.map(([at, fn]) => setTimeout(fn, at));
      timers.push(setTimeout(play, LOOP));
    };
    const finalState = () => STEPS.forEach(([, fn]) => fn());
    if (still.matches) {
      finalState();
      hero.classList.remove("checking", "pushed");
    } else {
      whileVisible(hero, play, () => { timers.forEach(clearTimeout); timers = []; });
    }
  }

  // Quick capture: a line typed the way you'd say it, then what Cairn made of it.
  const typing = document.querySelector("[data-typing]");
  if (typing) {
    const text = typing.querySelector("[data-typing-text]");
    const result = typing.querySelector("[data-typing-result]");
    const LINE = "submit DBMS lab fri 6pm #dbms";
    let timer = 0;
    const run = (at = 0) => {
      if (at === 0) { result.classList.remove("show"); text.textContent = ""; }
      if (at < LINE.length) {
        text.textContent = LINE.slice(0, at + 1);
        timer = setTimeout(() => run(at + 1), 55 + Math.random() * 50);
      } else {
        timer = setTimeout(() => { result.classList.add("show"); timer = setTimeout(() => run(0), 3400); }, 380);
      }
    };
    if (still.matches) { text.textContent = LINE; result.classList.add("show"); }
    else whileVisible(typing, () => run(0), () => clearTimeout(timer));
  }

  // The cairn builds itself, stone by stone, as you scroll past it.
  const stones = document.querySelector("[data-stones]");
  if (stones) {
    const parts = [...stones.querySelectorAll("[data-stone]")];
    const tags = [...stones.querySelectorAll("[data-tag]")];
    const ease = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
    const paint = () => {
      const box = stones.getBoundingClientRect();
      const travel = box.height - innerHeight;
      const progress = still.matches ? 1 : Math.min(1, Math.max(0, -box.top / Math.max(1, travel * 0.82)));
      parts.forEach((el, index) => {
        const share = ease((progress - index * 0.17) / 0.2);
        el.style.setProperty("--drop", String(1 - share));
      });
      tags.forEach((el) => el.style.setProperty("--show", String(ease((progress - Number(el.dataset.tag) * 0.17 - 0.1) / 0.14))));
    };
    onScroll(paint);
    addEventListener("resize", paint);
    paint();
  }

  const year = document.querySelector("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());
})();
