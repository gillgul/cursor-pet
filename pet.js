/*
 * Cursor Pet — a little character that floats after the mouse.
 *
 * Drop it on any page:
 *   <script src="pet/pet.js" data-size="140" data-gap="110"></script>
 *
 *   data-size  height of the character in px          (default 140)
 *   data-gap   space kept between her and the cursor  (default 110)
 *
 * The images in pet/assets/ are transparent PNGs, so she sits on any background.
 * She never catches clicks (pointer-events: none) and, when the mouse rests,
 * lands on an empty spot at the screen edge opposite the cursor, away from text.
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const ASSETS = new URL('assets/', script.src).href;
  const H = parseInt(script.dataset.size || '140', 10);
  const W = Math.round(H * 0.75);           // sprites are 3:4
  const GAP = parseInt(script.dataset.gap || '110', 10);
  const EDGE = 16;                          // margin from the screen edge when landed
  const IDLE_MS = 1100;                     // mouse still this long -> go land

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noHover = matchMedia('(hover: none)').matches;

  // ---------- styles ----------
  const css = `
  .cpet{position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:2147483000;
        will-change:transform;opacity:0;transition:opacity .4s}
  .cpet.ready{opacity:1}
  .cpet *{pointer-events:none;user-select:none;-webkit-user-drag:none}
  .cpet-flip,.cpet-tilt,.cpet-float,.cpet-pose{position:absolute;inset:0}
  .cpet-flip{transition:transform .18s}
  .cpet-tilt{transition:transform .25s}
  .cpet-float{animation:cpet-float 2.6s ease-in-out infinite}
  .cpet img{position:absolute;inset:0;width:100%;height:100%}
  .cpet-pose{visibility:hidden}
  .cpet-pose.on{visibility:visible}
  .cpet-wave img,.cpet-lid{visibility:hidden}
  .cpet-wave.on img.on,.cpet-wave.on .cpet-lid.on{visibility:visible}
  .cpet-run{--stride:.21s}
  .cpet-run .cpet-body{position:absolute;inset:0;animation:cpet-bob var(--stride) ease-in-out infinite alternate}
  .cpet-legb{transform-origin:45.12% 59.39%;animation:cpet-swb var(--stride) ease-in-out infinite alternate}
  .cpet-legf{transform-origin:72.74% 60.77%;animation:cpet-swf var(--stride) ease-in-out infinite alternate}
  @keyframes cpet-swb{from{transform:rotate(4deg)}to{transform:rotate(-50deg)}}
  @keyframes cpet-swf{from{transform:rotate(-4deg)}to{transform:rotate(38deg)}}
  @keyframes cpet-bob{from{transform:translateY(-3.5%)}to{transform:translateY(0)}}
  @keyframes cpet-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5%)}}
  @media (prefers-reduced-motion:reduce){.cpet-float,.cpet-run *{animation:none!important}}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- DOM ----------
  const img = (src, cls) => `<img src="${ASSETS}${src}" class="${cls || ''}" alt="" draggable="false">`;
  const pet = document.createElement('div');
  pet.className = 'cpet';
  pet.setAttribute('aria-hidden', 'true');
  pet.innerHTML = `
    <div class="cpet-flip"><div class="cpet-tilt"><div class="cpet-float">
      <div class="cpet-pose cpet-wave on">
        ${img('wave-1.png', 'on')}${img('wave-4.png')}${img('wave-3.png')}${img('wave-2.png')}
        ${img('lid-half.png', 'cpet-lid')}${img('lid-closed.png', 'cpet-lid')}
      </div>
      <div class="cpet-pose cpet-run"><div class="cpet-body">
        ${img('run-leg-back.png', 'cpet-legb')}${img('run-leg-front.png', 'cpet-legf')}${img('run-body.png')}
      </div></div>
    </div></div></div>`;

  const flip = pet.querySelector('.cpet-flip');
  const tilt = pet.querySelector('.cpet-tilt');
  const wavePose = pet.querySelector('.cpet-wave');
  const runPose = pet.querySelector('.cpet-run');
  const waveFrames = [...wavePose.querySelectorAll('img:not(.cpet-lid)')];   // arm low -> high
  const [lidHalf, lidClosed] = wavePose.querySelectorAll('.cpet-lid');

  // ---------- state ----------
  const vw = () => document.documentElement.clientWidth;
  const vh = () => document.documentElement.clientHeight;
  // pos = centre of the character
  const pos = { x: vw() - EDGE - W / 2, y: vh() - EDGE - H / 2 };
  const vel = { x: 0, y: 0 };
  const mouse = { x: -1, y: -1, seen: false };
  let mode = 'landed';          // 'follow' | 'landing' | 'landed'
  let landing = null;           // target spot when landing
  let lastMove = 0;
  let facing = 1;               // 1 = right, -1 = left
  let pose = 'wave';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clampToScreen = (p) => ({
    x: clamp(p.x, W / 2 + 4, vw() - W / 2 - 4),
    y: clamp(p.y, H / 2 + 4, vh() - H / 2 - 4),
  });

  // ---------- finding empty space (no text, images, buttons, inputs) ----------
  const SOLID = /^(IMG|VIDEO|CANVAS|SVG|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON|PICTURE)$/i;

  function textAt(x, y) {
    const el = document.elementFromPoint(x, y);   // the pet is skipped: pointer-events none
    if (!el || el === document.documentElement || el === document.body) return false;
    if (SOLID.test(el.tagName)) return true;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const box of r.getClientRects()) {
        if (x >= box.left - 6 && x <= box.right + 6 && y >= box.top - 6 && y <= box.bottom + 6) return true;
      }
    }
    return false;
  }

  function busyScore(cx, cy) {
    let hits = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 5; j++) {
        const x = cx - W / 2 + (W * (i + 0.5)) / 4;
        const y = cy - H / 2 + (H * (j + 0.5)) / 5;
        if (textAt(x, y)) hits++;
      }
    }
    return hits;
  }

  // She only ever stops in the left or right edge lane. Each lane is split into
  // slots, and how much text sits under each slot is cached (refreshed on scroll/resize).
  const laneX = (side) => side < 0 ? W / 2 + EDGE : vw() - W / 2 - EDGE;
  let slots = null, slotsAt = 0;
  function laneSlots() {
    if (!slots || performance.now() - slotsAt > 1500) {
      const top = H / 2 + EDGE, bottom = vh() - H / 2 - EDGE, step = 24;
      slots = { '-1': [], '1': [] };
      for (const side of [-1, 1]) {
        for (let y = top; y <= bottom + 1; y += step) {
          const yy = Math.min(y, bottom);
          slots[side].push({ y: yy, busy: busyScore(laneX(side), yy) });
        }
      }
      slotsAt = performance.now();
    }
    return slots;
  }
  const invalidateSlots = () => { slots = null; };

  // best spot in one lane: free of text first, then a gap from the cursor, then near its height
  function laneSpot(side) {
    const x = laneX(side);
    const R = GAP + Math.max(W, H) / 2;
    let best = null;
    for (const s of laneSlots()[side]) {
      const d = mouse.seen ? Math.hypot(x - mouse.x, s.y - mouse.y) : 9999;
      const score = s.busy * 1000
        + (d < R ? 600 + (R - d) * 4 : 0)
        + (mouse.seen ? Math.abs(s.y - mouse.y) : 0);
      if (!best || score < best.score) best = { x, y: s.y, score };
    }
    return best;
  }

  // landing: the edge opposite the cursor (falls back to the other edge if that one is all text)
  function pickLandingSpot() {
    const opposite = mouse.seen && mouse.x < vw() / 2 ? 1 : -1;
    const a = laneSpot(opposite), b = laneSpot(-opposite);
    return b.score + 300 < a.score ? b : a;
  }

  // following: the edge nearest the cursor, so she runs across when the cursor does
  function followSpot() {
    const near = mouse.x < vw() / 2 ? -1 : 1;
    const a = laneSpot(near), b = laneSpot(-near);
    return b.score + 300 < a.score ? b : a;
  }

  // ---------- poses ----------
  function setPose(p) {
    if (p === pose) return;
    pose = p;
    wavePose.classList.toggle('on', p === 'wave');
    runPose.classList.toggle('on', p === 'run');
  }

  // wave: arm swings low -> high -> low, with rests
  const swing = [0, 1, 2, 3, 2, 1];
  let swingStep = 0, swingLoops = 0, shownFrame = 0;
  function waveTick() {
    if (pose === 'wave' && !reduceMotion) {
      const f = swing[swingStep];
      waveFrames[shownFrame].classList.remove('on');
      waveFrames[f].classList.add('on');
      shownFrame = f;
      swingStep = (swingStep + 1) % swing.length;
      let delay = f === 3 ? 180 : 110;
      if (swingStep === 0 && ++swingLoops % 3 === 0) delay = 1400;   // pause between waves
      setTimeout(waveTick, delay);
    } else {
      setTimeout(waveTick, 200);
    }
  }

  function setLids(state) {
    lidHalf.classList.toggle('on', state === 'half');
    lidClosed.classList.toggle('on', state === 'closed');
  }
  function blinkLoop() {
    setTimeout(() => {
      if (pose === 'wave') {
        setLids('half');
        setTimeout(() => setLids('closed'), 45);
        setTimeout(() => setLids('half'), 140);
        setTimeout(() => setLids('open'), 190);
      }
      blinkLoop();
    }, 1800 + Math.random() * 2800);
  }

  // ---------- movement ----------
  function goLand() {
    landing = clampToScreen(pickLandingSpot());
    mode = 'landing';
  }

  function frame() {
    let target;
    if (mode === 'follow' && mouse.seen) {
      // track the cursor from the edge lane nearest to it, keeping the gap
      target = followSpot();
      if (performance.now() - lastMove > IDLE_MS) goLand();
    } else {
      target = landing || pos;
    }

    // springy follow with a little lag
    const k = mode === 'follow' ? 0.045 : 0.035;
    vel.x = (vel.x + (target.x - pos.x) * k) * 0.84;
    vel.y = (vel.y + (target.y - pos.y) * k) * 0.84;
    const sp = Math.hypot(vel.x, vel.y), MAX = 22;
    if (sp > MAX) { vel.x *= MAX / sp; vel.y *= MAX / sp; }
    pos.x += vel.x;
    pos.y += vel.y;

    if (mode === 'landing' && Math.hypot(target.x - pos.x, target.y - pos.y) < 2 && sp < 0.3) mode = 'landed';

    const moving = sp > 1.6;
    setPose(moving ? 'run' : 'wave');
    if (moving) {
      if (Math.abs(vel.x) > 0.8) facing = vel.x > 0 ? 1 : -1;     // run art faces right
      tilt.style.transform = `rotate(${clamp(vel.x * 0.7, -14, 14)}deg)`;
    } else {
      // wave art: her waving hand is on the left, so turn it toward the cursor
      if (mouse.seen) facing = mouse.x > pos.x ? -1 : 1;
      tilt.style.transform = 'rotate(0deg)';
    }
    flip.style.transform = `scaleX(${facing})`;
    pet.style.transform = `translate3d(${pos.x - W / 2}px, ${pos.y - H / 2}px, 0)`;
    requestAnimationFrame(frame);
  }

  // ---------- events ----------
  addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true;
    lastMove = performance.now();
    if (!reduceMotion && !noHover) mode = 'follow';
  }, { passive: true });

  document.addEventListener('mouseleave', () => { if (mode === 'follow') goLand(); });

  let scrollTimer;
  addEventListener('scroll', () => {
    invalidateSlots();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { invalidateSlots(); if (mode !== 'follow') goLand(); }, 250);   // text moved under her
  }, { passive: true });

  addEventListener('resize', () => { invalidateSlots(); if (mode !== 'follow') goLand(); });

  // ---------- start ----------
  function start() {
    document.body.appendChild(pet);
    const imgs = [...pet.querySelectorAll('img')];
    Promise.all(imgs.map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })))
      .then(() => {
        goLand();
        Object.assign(pos, landing);
        pet.classList.add('ready');
        waveTick();
        blinkLoop();
        requestAnimationFrame(frame);
      });
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
