// tree.js — TreeNode, layout, parsing, color picker, and utility functions

const NODE_PAD_Y_BASE = 3;
const NODE_PAD_X_BASE = 4;
const NODE_MIN_W = 24;
function getNodePadX() { return Math.round(NODE_PAD_X_BASE * (_fontSize / 12)); }
function getNodePadY() { return Math.round(NODE_PAD_Y_BASE * (_fontSize / 12)); }
const LEVEL_GAP_BASE = 55;
const LEVEL_GAP_SINGLE_BASE = 40;
const SIBLING_GAP = 16;
const ELBOW_SNAP = 12;         // snap threshold for elbow drag near extension points
const BRANCH_HIT_WIDTH = 24;   // invisible stroke width for branch click hit area
const TRIANGLE_HIT_WIDTH = 20; // invisible stroke width for triangle click hit area

// ── Font settings ──
const FONT_OPTIONS = [
  { label: 'Times New Roman', value: '"Times New Roman", Georgia, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
];

const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20];

let _fontFamily = FONT_OPTIONS[0].value;
let _fontSize = 12;

function getFontFamily() { return _fontFamily; }
function setFontFamily(f) { _fontFamily = f; }
function getFontSize() { return _fontSize; }
function setFontSize(s) { _fontSize = s; }
function getLevelGap() { return Math.round(LEVEL_GAP_BASE * (_fontSize / 12)); }
function getLevelGapSingle() { return Math.round(LEVEL_GAP_SINGLE_BASE * (_fontSize / 12)); }

const COLORS = [
  { name: 'Black',  hex: '#333333' },
  { name: 'Red',    hex: '#dc2626' },
  { name: 'Blue',   hex: '#2563eb' },
  { name: 'Green',  hex: '#16a34a' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Purple', hex: '#7c3aed' },
];

/* ── Simple color picker ── */
function openColorPicker(anchorEl, currentHex, onPick) {
  // Remove any existing picker
  closeColorPicker();

  let hue = 0, sat = 1, val = 1;

  // Parse currentHex into HSV
  if (currentHex) {
    const rgb = hexToRgb(currentHex);
    if (rgb) { const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); hue = hsv.h; sat = hsv.s; val = hsv.v; }
  }

  const overlay = document.createElement('div');
  overlay.className = 'color-picker-overlay';
  overlay.onmousedown = (e) => { if (e.target === overlay) closeColorPicker(); };

  const picker = document.createElement('div');
  picker.className = 'color-picker';

  // Position near the anchor button
  const rect = anchorEl.getBoundingClientRect();
  picker.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  picker.style.top = (rect.bottom + 6) + 'px';

  // --- Gradient (saturation-x, value-y) ---
  const grad = document.createElement('div');
  grad.className = 'cp-gradient';
  const gradThumb = document.createElement('div');
  gradThumb.className = 'cp-gradient-thumb';
  grad.appendChild(gradThumb);

  // --- Hue bar ---
  const hueBar = document.createElement('div');
  hueBar.className = 'cp-hue-bar';
  const hueThumb = document.createElement('div');
  hueThumb.className = 'cp-hue-thumb';
  hueBar.appendChild(hueThumb);

  // --- Preview + hex input + OK + Fav ---
  const previewRow = document.createElement('div');
  previewRow.className = 'cp-preview-row';
  const preview = document.createElement('div');
  preview.className = 'cp-preview';
  const inputCol = document.createElement('div');
  inputCol.className = 'cp-input-col';
  const hexInput = document.createElement('input');
  hexInput.className = 'cp-hex-input';
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  const btnRow = document.createElement('div');
  btnRow.className = 'cp-btn-row';
  const okBtn = document.createElement('button');
  okBtn.className = 'cp-ok-btn';
  okBtn.textContent = 'OK';
  const favBtn = document.createElement('button');
  favBtn.className = 'cp-fav-btn';
  favBtn.innerHTML = '&#9734; Save';
  btnRow.appendChild(okBtn);
  btnRow.appendChild(favBtn);
  inputCol.appendChild(hexInput);
  inputCol.appendChild(btnRow);
  previewRow.appendChild(preview);
  previewRow.appendChild(inputCol);

  // --- Favorites row ---
  const favsRow = document.createElement('div');
  favsRow.className = 'cp-favorites';

  function renderFavs() {
    favsRow.innerHTML = '';
    const favs = getFavoriteColors();
    favs.forEach(c => {
      const s = document.createElement('button');
      s.className = 'cp-fav-swatch';
      s.style.background = c;
      s.title = c;
      s.onclick = () => {
        const rgb = hexToRgb(c);
        if (rgb) { const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b); hue = hsv.h; sat = hsv.s; val = hsv.v; updateUI(); }
      };
      const rm = document.createElement('button');
      rm.className = 'cp-fav-remove';
      rm.textContent = '×';
      rm.onclick = (e) => {
        e.stopPropagation();
        removeFavoriteColor(c);
        renderFavs();
      };
      s.appendChild(rm);
      favsRow.appendChild(s);
    });
  }
  renderFavs();

  picker.appendChild(grad);
  picker.appendChild(hueBar);
  picker.appendChild(previewRow);
  picker.appendChild(favsRow);
  overlay.appendChild(picker);
  document.body.appendChild(overlay);

  function currentHexValue() { return hsvToHex(hue, sat, val); }

  function updateUI() {
    const pureHex = hsvToHex(hue, 1, 1);
    grad.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHex})`;
    gradThumb.style.left = (sat * 100) + '%';
    gradThumb.style.top = ((1 - val) * 100) + '%';
    hueThumb.style.left = (hue / 360 * 100) + '%';
    const hex = currentHexValue();
    preview.style.background = hex;
    hexInput.value = hex;
  }

  function dragGrad(e) {
    const r = grad.getBoundingClientRect();
    sat = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    val = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    updateUI();
  }
  grad.onmousedown = (e) => {
    e.preventDefault();
    dragGrad(e);
    const onMove = (ev) => dragGrad(ev);
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  function dragHue(e) {
    const r = hueBar.getBoundingClientRect();
    hue = Math.max(0, Math.min(360, (e.clientX - r.left) / r.width * 360));
    updateUI();
  }
  hueBar.onmousedown = (e) => {
    e.preventDefault();
    dragHue(e);
    const onMove = (ev) => dragHue(ev);
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  hexInput.onchange = () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    const rgb = hexToRgb(v);
    if (rgb) {
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hue = hsv.h; sat = hsv.s; val = hsv.v;
      updateUI();
    }
  };
  hexInput.onkeydown = (e) => {
    if (e.key === 'Enter') { hexInput.onchange(); okBtn.click(); }
    if (e.key === 'Escape') closeColorPicker();
  };

  okBtn.onclick = () => {
    const hex = currentHexValue();
    closeColorPicker();
    onPick(hex);
  };

  favBtn.onclick = () => {
    const hex = currentHexValue();
    addFavoriteColor(hex);
    renderFavs();
    favBtn.innerHTML = '&#9733; Saved';
    setTimeout(() => { favBtn.innerHTML = '&#9734; Save'; }, 800);
  };

  updateUI();
  window._activeColorPicker = overlay;
}

function closeColorPicker() {
  if (window._activeColorPicker) {
    window._activeColorPicker.remove();
    window._activeColorPicker = null;
  }
}

// Favorite colors (persisted in localStorage)
function getFavoriteColors() {
  try { return JSON.parse(localStorage.getItem('merge-fav-colors') || '[]'); }
  catch { return []; }
}
function addFavoriteColor(hex) {
  const favs = getFavoriteColors();
  const normalized = hex.toLowerCase();
  if (favs.includes(normalized)) return;
  favs.push(normalized);
  if (favs.length > 12) favs.shift(); // keep max 12
  localStorage.setItem('merge-fav-colors', JSON.stringify(favs));
}
function removeFavoriteColor(hex) {
  const favs = getFavoriteColors().filter(c => c !== hex.toLowerCase());
  localStorage.setItem('merge-fav-colors', JSON.stringify(favs));
}

// Color math helpers
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) {
    const s = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
    if (!s) return null;
    return { r: parseInt(s[1]+s[1],16), g: parseInt(s[2]+s[2],16), b: parseInt(s[3]+s[3],16) };
  }
  return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function addCustomColorButton(container, onPick) {
  const btn = document.createElement('button');
  btn.className = 'cp-custom-swatch';
  btn.title = 'Custom color';
  const inner = document.createElement('div');
  inner.className = 'cp-custom-swatch-inner';
  btn.appendChild(inner);
  btn.onclick = (e) => {
    e.stopPropagation();
    openColorPicker(btn, null, onPick);
  };
  container.appendChild(btn);
}

let nextId = 1;
function genId() { return nextId++; }
function setNextId(val) { nextId = val; }
function getNextId() { return nextId; }

// --- Runs model ---

function defaultRuns(label) {
  return [{ text: label }];
}

function runsToPlainText(runs) {
  return runs.map(r => r.text).join('');
}

function getArrowLabelRuns(arrow) {
  // Backward compat: convert old string label to runs
  if (arrow.labelRuns && arrow.labelRuns.length > 0) return arrow.labelRuns;
  if (arrow.label) return defaultRuns(arrow.label);
  return [];
}

function splitRunsIntoLines(runs) {
  const lines = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) {
        const copy = { ...r, text: part };
        lines[lines.length - 1].push(copy);
      }
    });
  }
  return lines;
}

function runsToHTML(runs) {
  return runs.map(r => {
    let t = escHtml(r.text).replace(/\n/g, '<br>');
    if (r.bold) t = `<b>${t}</b>`;
    if (r.italic) t = `<i>${t}</i>`;
    if (r.sub) t = `<sub>${t}</sub>`;
    if (r.sup) t = `<sup>${t}</sup>`;
    if (r.underline) t = `<u>${t}</u>`;
    if (r.strike) t = `<s>${t}</s>`;
    if (r.smallcaps) t = `<span style="font-variant:small-caps">${t}</span>`;
    if (r.color && r.color !== '#333333') t = `<span style="color:${r.color}">${t}</span>`;
    return t;
  }).join('');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function htmlToRuns(el) {
  const runs = [];
  function walk(node, fmt) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) runs.push({ text, ...fmt });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const f = { ...fmt };
    const tag = node.tagName.toLowerCase();
    if (tag === 'b' || tag === 'strong') f.bold = true;
    if (tag === 'i' || tag === 'em') f.italic = true;
    if (tag === 'sub') f.sub = true;
    if (tag === 'sup') f.sup = true;
    if (tag === 'u' || tag === 'ins') f.underline = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') f.strike = true;
    if (tag === 'br') {
      runs.push({ text: '\n', ...fmt });
      return;
    }
    if (node.style && node.style.color) {
      f.color = rgbToHex(node.style.color);
    }
    if (node.style && node.style.fontVariant === 'small-caps') {
      f.smallcaps = true;
    }
    if (tag === 'span' || tag === 'font') {
      const c = node.getAttribute('color');
      if (c) f.color = c;
    }
    // block-level elements (div, p) insert a line break before their content
    // (browsers wrap lines in divs inside contenteditable)
    const isBlock = tag === 'div' || tag === 'p';
    if (isBlock && runs.length > 0) {
      const last = runs[runs.length - 1];
      if (last.text && !last.text.endsWith('\n')) {
        runs.push({ text: '\n', ...fmt });
      }
    }
    for (const child of node.childNodes) walk(child, f);
  }
  walk(el, {});

  // merge adjacent runs with same format
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic &&
        !!last.sub === !!r.sub && !!last.sup === !!r.sup &&
        !!last.underline === !!r.underline && !!last.strike === !!r.strike && !!last.smallcaps === !!r.smallcaps &&
        (last.color || '') === (r.color || '')) {
      last.text += r.text;
    } else {
      merged.push({ ...r });
    }
  }
  return merged.map(r => {
    const o = { text: r.text };
    if (r.bold) o.bold = true;
    if (r.italic) o.italic = true;
    if (r.sub) o.sub = true;
    if (r.sup) o.sup = true;
    if (r.underline) o.underline = true;
    if (r.strike) o.strike = true;
    if (r.smallcaps) o.smallcaps = true;
    if (r.color && r.color !== '#333333') o.color = r.color;
    return o;
  });
}

function rgbToHex(rgb) {
  if (!rgb) return '';
  if (rgb.startsWith('#')) return rgb;
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return rgb;
  return '#' + m.slice(0,3).map(x => (+x).toString(16).padStart(2,'0')).join('');
}

// --- TreeNode ---

class TreeNode {
  constructor(label, parent = null) {
    this.id = genId();
    this.runs = defaultRuns(label);
    this.parent = parent;
    this.children = [];
    this.triangle = false;
    this.branchColor = null;
    this.borderColor = null;
    this.fillColor = null;
    this.triangleFillColor = null;
    this.x = 0;
    this.y = 0;
    this.w = 0;
    this.h = 0;
    this.subtreeW = 0;
  }

  get label() { return runsToPlainText(this.runs); }

  get lineCount() {
    return splitRunsIntoLines(this.runs).length;
  }

  get isLeaf() { return this.children.length === 0; }

  get leafCount() {
    if (this.isLeaf) return 1;
    return this.children.reduce((s, c) => s + c.leafCount, 0);
  }

  toLabeledBrackets() {
    const lbl = this.label.replace(/\n/g, ' ');
    if (this.isLeaf) return `[${lbl}]`;
    return `[${lbl} ${this.children.map(c => c.toLabeledBrackets()).join(' ')}]`;
  }

  toJSON() {
    const o = { runs: this.runs, children: this.children.map(c => c.toJSON()) };
    if (this.triangle) o.triangle = true;
    if (this.branchColor) o.branchColor = this.branchColor;
    if (this.borderColor) o.borderColor = this.borderColor;
    if (this.fillColor) o.fillColor = this.fillColor;
    if (this.triangleFillColor) o.triangleFillColor = this.triangleFillColor;
    return o;
  }

  static fromJSON(obj, parent = null) {
    const n = new TreeNode('', parent);
    n.runs = obj.runs || defaultRuns(obj.label || '');
    n.triangle = obj.triangle || false;
    n.branchColor = obj.branchColor || null;
    n.borderColor = obj.borderColor || null;
    n.fillColor = obj.fillColor || null;
    n.triangleFillColor = obj.triangleFillColor || null;
    n.children = (obj.children || []).map(c => TreeNode.fromJSON(c, n));
    return n;
  }
}

function parseBracketNotation(str) {
  str = str.trim();
  if (!str.startsWith('[')) return null;
  let pos = 0;
  function parse(parent) {
    if (str[pos] !== '[') return null;
    pos++;
    skipWs();
    let label = '';
    while (pos < str.length && str[pos] !== ' ' && str[pos] !== '[' && str[pos] !== ']') {
      label += str[pos++];
    }
    skipWs();
    // If next char is '[', this node has children; otherwise consume rest as multi-word leaf label
    if (pos < str.length && str[pos] !== '[' && str[pos] !== ']') {
      // Multi-word leaf: read everything up to the closing ']', treat spaces as newlines
      while (pos < str.length && str[pos] !== ']') {
        label += str[pos++];
      }
      label = label.trimEnd();
    }
    const node = new TreeNode(label.replace(/ /g, '\n'), parent);
    while (pos < str.length && str[pos] === '[') {
      const child = parse(node);
      if (child) node.children.push(child);
      skipWs();
    }
    if (str[pos] === ']') pos++;
    return node;
  }
  function skipWs() { while (pos < str.length && str[pos] === ' ') pos++; }
  return parse(null);
}

// --- Measure ---

const _mc = document.createElement('canvas');
const _mx = _mc.getContext('2d');

function measureLineRuns(lineRuns) {
  let total = 0;
  const subSupSz = Math.round(_fontSize * 0.67);
  for (const r of lineRuns) {
    const sz = (r.sub || r.sup) ? subSupSz : _fontSize;
    const bold = r.bold ? 'bold ' : '';
    const italic = r.italic ? 'italic ' : '';
    if (r.smallcaps) {
      // small-caps: uppercase stays full size, lowercase rendered as ~80%-sized uppercase
      const scSz = Math.round(sz * 0.8);
      let w = 0;
      for (const ch of r.text) {
        if (ch !== ch.toUpperCase() && ch === ch.toLowerCase()) {
          _mx.font = `${italic}${bold}${scSz}px ${_fontFamily}`;
          w += _mx.measureText(ch.toUpperCase()).width;
        } else {
          _mx.font = `${italic}${bold}${sz}px ${_fontFamily}`;
          w += _mx.measureText(ch).width;
        }
      }
      total += w;
    } else {
      _mx.font = `${italic}${bold}${sz}px ${_fontFamily}`;
      total += _mx.measureText(r.text).width;
    }
  }
  return total;
}

function getLineHeight() {
  return Math.round(_fontSize * 1.35);
}

function measureNodeSize(node) {
  const lines = splitRunsIntoLines(node.runs);
  let maxW = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, measureLineRuns(line));
  }
  const lineH = getLineHeight();
  const padX = getNodePadX();
  const padY = getNodePadY();
  const w = Math.max(NODE_MIN_W, maxW + padX * 2);
  const h = padY * 2 + lines.length * lineH;
  return { w, h };
}

// --- Layout ---

function layoutTree(root, alignBottom) {
  if (!root) return;

  function computeWidths(node) {
    const size = measureNodeSize(node);
    node.w = size.w;
    node.h = size.h;
    node.children.forEach(c => computeWidths(c));
    if (node.isLeaf) {
      node.subtreeW = node.w;
    } else {
      const childrenW = node.children.reduce((s, c) => s + c.subtreeW, 0)
        + SIBLING_GAP * (node.children.length - 1);
      node.subtreeW = Math.max(node.w, childrenW);
    }
  }

  function assignPositions(node, left, top) {
    node.y = top;
    if (node.isLeaf) {
      node.x = left + node.subtreeW / 2;
    } else {
      const childrenTotalW = node.children.reduce((s, c) => s + c.subtreeW, 0)
        + SIBLING_GAP * (node.children.length - 1);
      let cx = left + (node.subtreeW - childrenTotalW) / 2;
      node.children.forEach(c => {
        const gap = node.children.length === 1 ? getLevelGapSingle() : getLevelGap();
        assignPositions(c, cx, top + node.h + gap - getNodePadY() * 2 - getLineHeight());
        cx += c.subtreeW + SIBLING_GAP;
      });
      const first = node.children[0];
      const last = node.children[node.children.length - 1];
      node.x = (first.x + last.x) / 2;
    }
  }

  computeWidths(root);
  assignPositions(root, 40, 30);

  if (alignBottom) {
    // Find the maximum bottom edge (y + h) among all leaf nodes
    let maxLeafBottom = 0;
    function findMaxBottom(n) {
      if (n.isLeaf) { maxLeafBottom = Math.max(maxLeafBottom, n.y + n.h); }
      n.children.forEach(findMaxBottom);
    }
    findMaxBottom(root);
    // Shift all leaf nodes so their bottom edge aligns
    function alignLeaves(n) {
      if (n.isLeaf) { n.y = maxLeafBottom - n.h; }
      n.children.forEach(alignLeaves);
    }
    alignLeaves(root);
    // Bottom-up pass: pull parents down to stay a natural distance above their children
    function adjustParents(n) {
      if (n.isLeaf) return;
      n.children.forEach(adjustParents);
      const minChildY = Math.min(...n.children.map(c => c.y));
      const gap = n.children.length === 1 ? getLevelGapSingle() : getLevelGap();
      const naturalY = minChildY - gap + getNodePadY() * 2 + getLineHeight() - n.h;
      // Only move down, never up
      if (naturalY > n.y) n.y = naturalY;
    }
    adjustParents(root);
  }
}

// --- SVG helpers ---

function createSvgRunSpans(textEl, runs, cx, cy, nodeH) {
  const lines = splitRunsIntoLines(runs);
  const lineH = getLineHeight();
  const totalTextH = lines.length * lineH;
  const startY = cy - totalTextH / 2 + lineH / 2;

  lines.forEach((lineRuns, li) => {
    if (lineRuns.length === 0) return;
    let needsReset = false;
    lineRuns.forEach((r, ri) => {
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.textContent = r.text;
      // first tspan of each line sets x and dy
      if (ri === 0) {
        tspan.setAttribute('x', cx);
        if (li === 0) {
          tspan.setAttribute('y', startY);
        } else {
          tspan.setAttribute('dy', lineH);
        }
      }
      if (r.bold) tspan.setAttribute('font-weight', 'bold');
      if (r.italic) tspan.setAttribute('font-style', 'italic');
      if (r.sub) {
        tspan.setAttribute('font-size', Math.round(_fontSize * 0.67));
        tspan.setAttribute('baseline-shift', 'sub');
        needsReset = true;
      } else if (r.sup) {
        tspan.setAttribute('font-size', Math.round(_fontSize * 0.67));
        tspan.setAttribute('baseline-shift', 'super');
        needsReset = true;
      } else if (needsReset) {
        tspan.setAttribute('font-size', _fontSize);
        tspan.setAttribute('baseline-shift', '0');
        needsReset = false;
      }
      if (r.underline && r.strike) tspan.setAttribute('text-decoration', 'underline line-through');
      else if (r.underline) tspan.setAttribute('text-decoration', 'underline');
      else if (r.strike) tspan.setAttribute('text-decoration', 'line-through');
      if (r.smallcaps) tspan.setAttribute('font-variant', 'small-caps');
      if (r.color) tspan.setAttribute('fill', r.color);
      textEl.appendChild(tspan);
    });
  });
}

// --- Anchor helpers ---

function getAnchorPos(node, anchor, offset) {
  const t = offset || 0; // -0.5 to 0.5, 0 = center of edge
  switch (anchor) {
    case 'top':    return { x: node.x + t * node.w, y: node.y };
    case 'bottom': return { x: node.x + t * node.w, y: node.y + node.h };
    case 'left':   return { x: node.x - node.w / 2, y: node.y + node.h / 2 + t * node.h };
    case 'right':  return { x: node.x + node.w / 2, y: node.y + node.h / 2 + t * node.h };
    default:       return { x: node.x + t * node.w, y: node.y + node.h };
  }
}

function getAnchorDir(anchor) {
  switch (anchor) {
    case 'top':    return { dx: 0, dy: -1 };
    case 'bottom': return { dx: 0, dy: 1 };
    case 'left':   return { dx: -1, dy: 0 };
    case 'right':  return { dx: 1, dy: 0 };
    default:       return { dx: 0, dy: 1 };
  }
}

export {
  getNodePadY, getNodePadX, NODE_MIN_W,
  LEVEL_GAP_BASE, LEVEL_GAP_SINGLE_BASE, getLevelGap, getLevelGapSingle, SIBLING_GAP,
  ELBOW_SNAP, BRANCH_HIT_WIDTH, TRIANGLE_HIT_WIDTH,
  COLORS, FONT_OPTIONS, FONT_SIZES,
  getFontFamily, setFontFamily, getFontSize, setFontSize,
  openColorPicker, closeColorPicker, addCustomColorButton,
  getFavoriteColors, addFavoriteColor, removeFavoriteColor,
  hexToRgb, rgbToHsv, hsvToHex, rgbToHex,
  genId, setNextId, getNextId,
  defaultRuns, runsToPlainText, getArrowLabelRuns,
  splitRunsIntoLines, runsToHTML, escHtml, htmlToRuns,
  TreeNode, parseBracketNotation,
  measureNodeSize, measureLineRuns, getLineHeight,
  layoutTree,
  createSvgRunSpans,
  getAnchorPos, getAnchorDir,
};
