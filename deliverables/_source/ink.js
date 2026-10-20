/*
 * Countersign ink: hand-drawn SVG primitives for the deliverables (figures, deck, documents).
 * Every mark is a cobalt or navy stroke with round caps, displaced by a turbulence filter so no line is
 * mechanical, the same hand as the app's brush strokes, nib and icons. Pure functions returning SVG strings.
 */
(function () {
  const C = {
    cream: '#F4F0E5', creamDeep: '#EBE5D6', cobalt: '#2547C9', navy: '#1B2B6B',
    soft: '#5A679E', vermilion: '#C0391B', ochre: '#A06A12',
  };

  // Deterministic wobble so the same figure renders the same way every time
  function rng(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 - 0.5; };
  }

  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function defs() {
    return `<defs>
      <filter id="rough" filterUnits="userSpaceOnUse" x="-200" y="-200" width="4000" height="4000">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <filter id="roughBig" filterUnits="userSpaceOnUse" x="-200" y="-200" width="4000" height="4000">
        <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="9" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <radialGradient id="orbG" cx="34%" cy="30%" r="80%">
        <stop offset="0" stop-color="#35C8E8"/><stop offset="0.5" stop-color="#2547C9"/><stop offset="1" stop-color="#3A1F9E"/>
      </radialGradient>
      <radialGradient id="orbGloss" cx="34%" cy="22%" r="40%">
        <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
  }

  // Rounded rectangle drawn by hand: a wobbling loop that overshoots where it closes, plus a faint echo
  function box({ x, y, w, h, r = 14, seed = 1, stroke = C.cobalt, sw = 3, fill = 'rgba(235,229,214,0.75)', dashed = false, echo = true }) {
    const q = rng(seed);
    const j = (n = 2.2) => q() * n;
    const d = `M${x + r + j()} ${y + j()} L${x + w - r + j()} ${y + j()} Q${x + w + j()} ${y + j()} ${x + w + j()} ${y + r + j()}
      L${x + w + j()} ${y + h - r + j()} Q${x + w + j()} ${y + h + j()} ${x + w - r + j()} ${y + h + j()}
      L${x + r + j()} ${y + h + j()} Q${x + j()} ${y + h + j()} ${x + j()} ${y + h - r + j()}
      L${x + j()} ${y + r + j()} Q${x + j()} ${y + j()} ${x + r + j()} ${y + j()} L${x + r + 22 + j()} ${y + 1 + j()}`;
    const dash = dashed ? ` stroke-dasharray="9 8"` : '';
    return `<g filter="url(#rough)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="none"/>
      <path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"${dash}/>
      ${echo && !dashed ? `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw * 0.45}" stroke-opacity="0.32" transform="translate(2 2)" stroke-linecap="round"/>` : ''}
    </g>`;
  }

  // Curved arrow with a two-stroke head; bend > 0 curves to the left of the direction of travel
  function arrow({ x1, y1, x2, y2, bend = 0, color = C.cobalt, sw = 3, dashed = false, head = true, both = false }) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
    const d = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
    const headAt = (px, py, fx, fy) => {
      const a = Math.atan2(py - fy, px - fx), s = 15;
      return `M${px - s * Math.cos(a - 0.45)} ${py - s * Math.sin(a - 0.45)} L${px} ${py} L${px - s * Math.cos(a + 0.45)} ${py - s * Math.sin(a + 0.45)}`;
    };
    const dash = dashed ? ` stroke-dasharray="10 9"` : '';
    return `<g filter="url(#rough)" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
      <path d="${d}"${dash}/>
      ${head ? `<path d="${headAt(x2, y2, cx, cy)}"/>` : ''}
      ${both ? `<path d="${headAt(x1, y1, cx, cy)}"/>` : ''}
    </g>`;
  }

  function wrap(text, maxChars) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const w of para.split(' ')) {
        if ((line + ' ' + w).trim().length > maxChars && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
      }
      out.push(line);
    }
    return out;
  }

  function text(x, y, t, { size = 22, font = 'sans', color = C.navy, anchor = 'start', weight = 400, max = 0, lh = 1.3, italic = false, spacing = 0, upper = false } = {}) {
    const fam = font === 'display' ? "'Cormorant Garamond', Georgia, serif" : font === 'mono' ? "'IBM Plex Mono', monospace" : "Inter, sans-serif";
    const lines = max ? wrap(t, max) : String(t).split('\n');
    const tsp = lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : size * lh}">${esc(upper ? l.toUpperCase() : l)}</tspan>`).join('');
    return `<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${tsp}</text>`;
  }

  const eyebrow = (x, y, t, o = {}) => text(x, y, t, { size: 14, color: C.soft, spacing: 2.4, upper: true, weight: 500, ...o });

  const ICONS = {
    person: ['M8.6 8a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0', 'M5 20c.6-3.8 3.4-6 7-6s6.4 2.2 7 6'],
    bank: ['M3.5 9.5 12 4.5l8.5 5', 'M5.5 10.5v7.5', 'M9.8 10.5v7.5', 'M14.2 10.5v7.5', 'M18.5 10.5v7.5', 'M3.5 19.8h17'],
    shield: ['M12 3.2c2.6 1.6 5 2.3 7.4 2.4.2 6.7-2.2 11.4-7.4 14.4-5.2-3-7.6-7.7-7.4-14.4 2.4-.1 4.8-.8 7.4-2.4Z', 'M8.8 12.2l2.2 2.2 4.4-4.6'],
    key: ['M4.6 15.4a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0', 'M10.4 13 19.2 4.4', 'M16.4 7.2l2.4 2.4', 'M14 9.6l1.8 1.8'],
    wallet: ['M3.5 7.5c5.6-.6 11.4-.6 17 0 .5 3.5.5 7.5 0 11-5.6.6-11.4.6-17 0-.5-3.5-.5-7.5 0-11Z', 'M15.6 12.9h2.6', 'M5 7.1 15.4 4l1.1 3.2'],
    doc: ['M6 3.5h8.5l3.5 3.5v13.5H6Z', 'M14.5 3.5V7H18', 'M8.8 11h6.4', 'M8.8 14.2h6.4', 'M8.8 17.4h4'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2'],
    globe: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0', 'M3.8 12h16.4', 'M12 3.5c2.6 2.4 3.6 5.2 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.2-3.6-8.5s1-6.1 3.6-8.5Z'],
    eye: ['M2.8 12c2.4-4.2 5.6-6.3 9.2-6.3s6.8 2.1 9.2 6.3c-2.4 4.2-5.6 6.3-9.2 6.3S5.2 16.2 2.8 12Z', 'M9.4 12a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0'],
    lock: ['M6 11h12v9.5H6Z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    pen: ['M4 20c3-.6 5.4-2 7.4-4.2L19 8.2l-3.2-3.2-7.6 7.6C6 14.6 4.6 17 4 20Z', 'M13.8 7l3.2 3.2'],
    check: ['M5 12.5l4.2 4.2L19 7'],
    cross: ['M6.2 6l11.6 12.1', 'M17.9 6.1 6.1 18'],
    clock: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0', 'M12 7.5V12l3 2'],
    server: ['M4.5 4.5h15v6h-15Z', 'M4.5 13.5h15v6h-15Z', 'M7.6 7.5h.01', 'M7.6 16.5h.01'],
    scale: ['M12 4v16', 'M7.5 20h9', 'M4.5 7.5h15', 'M4.5 7.5 2.3 13c1 1.3 3.4 1.3 4.4 0Z', 'M19.5 7.5 17.3 13c1 1.3 3.4 1.3 4.4 0Z'],
    chat: ['M4 6.5c5.3-.6 10.7-.6 16 0 .4 2.9.4 5.6 0 8.5-3 .4-6 .5-9 .4L6.5 19l.3-3.8c-1-.1-1.9-.1-2.8-.2-.4-2.9-.4-5.6 0-8.5Z'],
    search: ['M4.5 10.5a6 6 0 1 0 12 0a6 6 0 1 0 -12 0', 'M15 15l5 5'],
    pause: ['M8.5 5.5v13', 'M15.5 5.5v13'],
    alert: ['M12 4 21 19.5H3Z', 'M12 10v4.5', 'M12 17.2h.01'],
    layers: ['M12 4 21 8.5 12 13 3 8.5Z', 'M3 12.5 12 17l9-4.5', 'M3 16.5 12 21l9-4.5'],
    hash: ['M9.5 4 7.8 20', 'M16.2 4 14.5 20', 'M4.6 9h15.6', 'M3.8 15h15.6'],
    coin: ['M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0', 'M14.4 9.4c-.8-.9-4.6-1-4.6 1 0 2.1 4.6 1 4.6 3.2 0 2-3.9 1.8-4.8 1', 'M12 6.8v1.6', 'M12 15.6v1.6'],
    graph: ['M5 6.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0', 'M15.4 6.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0', 'M10.2 17.5a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0', 'M8.6 6.5h6.8', 'M7.6 8l3.6 8', 'M16.4 8l-3.6 8'],
    refresh: ['M19 8.5A7.6 7.6 0 0 0 5.4 9', 'M5 15.5a7.6 7.6 0 0 0 13.6.5', 'M19.2 4.6v4.2H15', 'M4.8 19.4v-4.2H9'],
  };

  function icon(name, x, y, size = 48, color = C.cobalt, sw = 1.7) {
    const s = size / 24;
    return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${(ICONS[name] || []).map((d) => `<path d="${d}"/>`).join('')}</g>`;
  }

  // The agent: a small sphere of blue light, the only gradient allowed
  function orb(cx, cy, r) {
    return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#orbG)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#orbGloss)"/></g>`;
  }

  // The nib (viewBox 0 0 240 240) placed at x,y with a target size
  function nib(x, y, size = 120, color = C.cobalt, baseline = true) {
    const s = size / 240;
    return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" filter="url(#rough)">
      <path d="M80 30C63 54 57 82 65 104C77 136 100 166 120 196" stroke-width="8"/>
      <path d="M160 31C177 55 183 82 175 104C163 136 140 166 120 196" stroke-width="8"/>
      <path d="M80 30C98 25 142 25 160 31" stroke-width="7" stroke-opacity="0.85"/>
      <path d="M111 104a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" stroke-width="5.5"/>
      <path d="M120 122C118.6 146 121.2 170 120 190" stroke-width="5.5"/>
      <path d="M120 196C134 214 158 220 180 208C194 200 206 202 222 212" stroke-width="5.5" stroke-opacity="0.85"/>
      ${baseline ? '<path d="M20 226C78 220 162 222 222 226" stroke-width="3" stroke-opacity="0.4"/>' : ''}
    </g>`;
  }

  // A brush underline, the short swash used under headlines
  function brush(x, y, w, color = C.cobalt) {
    const s = w / 240;
    return `<g transform="translate(${x} ${y}) scale(${s} ${s})" fill="none" stroke="${color}" stroke-linecap="round" filter="url(#roughBig)">
      <path d="M5 21C40 9 90 28 140 16S210 8 235 18" stroke-width="9" stroke-opacity="0.85"/>
      <path d="M7 27C44 16 94 33 144 22S212 14 233 24" stroke-width="4.5" stroke-opacity="0.5"/>
    </g>`;
  }

  // Titled node: hand-drawn box with an icon, a title and a sub line
  function node({ x, y, w, h, icon: ic, title, sub, seed = 1, stroke = C.cobalt, titleSize = 26, subSize = 16, subMax = 30, agent = false, fill }) {
    let out = box({ x, y, w, h, seed, stroke, fill });
    const ix = x + 22, iy = y + 22;
    if (agent) out += orb(ix + 22, iy + 22, 20);
    else if (ic) out += icon(ic, ix, iy, 44, stroke);
    out += text(x + 80, y + 50, title, { size: titleSize, font: 'display', weight: 600 });
    if (sub) out += text(x + 22, y + 92, sub, { size: subSize, color: C.soft, max: subMax, lh: 1.4 });
    return out;
  }

  function svg(w, h, body, bg = C.cream) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defs()}<rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
  }

  window.ink = { C, box, arrow, text, eyebrow, icon, orb, nib, brush, node, svg, wrap, defs };
})();
