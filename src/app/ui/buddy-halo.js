// Halo's buddy: a ring of light, no face. It breathes while idle, sweeps while it looks or thinks, spins while it
// works, ripples while it talks, flares gold when a task is done and turns coral when it has to stop.
// Same contract as buddy-sprite.js (Clawd) and buddy-red.js; whichever loads last wins.
// Preview the others with ?mascot=clawd or ?mascot=red.
(function () {
  "use strict";
  if (["clawd", "red"].includes(new URLSearchParams(location.search).get("mascot"))) return;
  const NS = "http://www.w3.org/2000/svg";
  const CX = 60, CY = 66, R = 26;
  const MOODS = {
    calm: { a: "#ffd772", b: "#ffffff", c: "#7fe6ff", glow: "#ffc94d" },
    look: { a: "#7fe6ff", b: "#ffffff", c: "#ffd772", glow: "#7fe6ff" },
    stop: { a: "#ff8a7a", b: "#ffd3c9", c: "#ff5f6d", glow: "#ff6b5b" },
  };
  const moodFor = (pose) => (pose === "stop" || pose === "sad" ? MOODS.stop : pose === "scan" || pose === "think" || pose === "type" ? MOODS.look : MOODS.calm);
  let uid = 0;

  function render(pose, frame, o = {}) {
    const id = "hl" + (++uid % 1000);
    const t = performance.now() / 1000;
    const m = moodFor(pose);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("width", "120");
    svg.setAttribute("height", "120");
    svg.setAttribute("aria-hidden", "true");
    svg.style.shapeRendering = "geometricPrecision";
    const add = (tag, attrs, parent = svg) => {
      const node = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      parent.appendChild(node);
      return node;
    };

    // How the ring moves for each moment.
    const spinSpeed = pose === "type" ? 420 : pose === "scan" || pose === "think" ? 200 : 40;
    const angle = (t * spinSpeed) % 360;
    const talking = o.talking || pose === "talk";
    const breathe = Math.sin(t * 2.1) * 1.2;
    const voice = talking ? Math.abs(Math.sin(t * 13)) * 2.6 + Math.abs(Math.sin(t * 7.3)) * 1.4 : 0;
    const flare = pose === "celebrate" ? (Math.sin(t * 6) + 1) * 2.5 : 0;
    const r = R + breathe + voice + flare;
    const width = pose === "celebrate" ? 6 : talking ? 5 + voice * 0.4 : 4.5;

    const defs = add("defs", {});
    const grad = add("linearGradient", { id: id + "r", gradientUnits: "userSpaceOnUse", x1: CX - R, y1: CY, x2: CX + R, y2: CY, gradientTransform: `rotate(${angle} ${CX} ${CY})` }, defs);
    add("stop", { offset: "0", "stop-color": m.a }, grad);
    add("stop", { offset: ".5", "stop-color": m.b }, grad);
    add("stop", { offset: "1", "stop-color": m.c }, grad);
    const halo = add("radialGradient", { id: id + "g" }, defs);
    add("stop", { offset: ".45", "stop-color": m.glow, "stop-opacity": .38 }, halo);
    add("stop", { offset: "1", "stop-color": m.glow, "stop-opacity": 0 }, halo);
    const core = add("radialGradient", { id: id + "c" }, defs);
    add("stop", { offset: "0", "stop-color": "#ffffff", "stop-opacity": .14 }, core);
    add("stop", { offset: "1", "stop-color": "#ffffff", "stop-opacity": 0 }, core);
    const blur = add("filter", { id: id + "b", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
    add("feGaussianBlur", { stdDeviation: 3.2 }, blur);

    // Soft light it casts below and around itself.
    add("ellipse", { cx: CX, cy: 112, rx: 22, ry: 4, fill: m.glow, opacity: .22, filter: `url(#${id}b)` });
    add("circle", { cx: CX, cy: CY, r: r + 22, fill: `url(#${id}g)`, opacity: pose === "celebrate" ? 1 : .75 });
    add("circle", { cx: CX, cy: CY, r: r - 2, fill: `url(#${id}c)` });

    // The ring: a blurred copy for the glow, the ring itself, and a thin bright inner edge.
    add("circle", { cx: CX, cy: CY, r, fill: "none", stroke: `url(#${id}r)`, "stroke-width": width + 3, opacity: .55, filter: `url(#${id}b)` });
    add("circle", { cx: CX, cy: CY, r, fill: "none", stroke: `url(#${id}r)`, "stroke-width": width });
    add("circle", { cx: CX, cy: CY, r: r - width / 2 + .4, fill: "none", stroke: "#ffffff", "stroke-width": .8, opacity: .6 });

    // A bright comet travels the ring while it looks, thinks or works.
    if (pose === "scan" || pose === "think" || pose === "type") {
      const c = 2 * Math.PI * r;
      add("circle", { cx: CX, cy: CY, r, fill: "none", stroke: "#ffffff", "stroke-width": width - 1, "stroke-linecap": "round", "stroke-dasharray": `${c * 0.16} ${c}`, transform: `rotate(${angle * 1.6} ${CX} ${CY})`, opacity: .95 });
    }
    // Pointing: a short beam of light toward the target.
    if (pose === "point") {
      const dir = o.aim === "up" ? -90 : o.aim === "down" ? 90 : 0;
      const g = add("g", { transform: `rotate(${dir} ${CX} ${CY})` });
      const pulse = (Math.sin(t * 5) + 1) * 2;
      add("path", { d: `M${CX + r + 6 + pulse} ${CY - 6} L${CX + r + 16 + pulse} ${CY} L${CX + r + 6 + pulse} ${CY + 6}`, fill: "none", stroke: m.a, "stroke-width": 3.4, "stroke-linecap": "round", "stroke-linejoin": "round" }, g);
    }
    // Done: a few sparks orbit outward.
    if (pose === "celebrate") {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + t * 1.5;
        const d = r + 12 + Math.sin(t * 4 + i) * 3;
        add("circle", { cx: CX + Math.cos(a) * d, cy: CY + Math.sin(a) * d, r: 1.6, fill: i % 2 ? "#ffffff" : m.a });
      }
    }
    return svg;
  }

  window.BuddySprite = {
    size: { w: 120, h: 120 }, anchor: { x: 60, y: 120 }, fps: 30, headY: -96, teleport: true,
    tips: { side: { x: 46, y: -54 }, up: { x: 0, y: -100 }, down: { x: 0, y: -8 } },
    bounds: () => ({ left: -58, right: 60, top: -110 }),
    render,
  };
})();
