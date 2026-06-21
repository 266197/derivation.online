// app.js — Main application class
import {
  getNodePadY, getNodePadX, NODE_MIN_W,
  LEVEL_GAP_BASE, LEVEL_GAP_SINGLE_BASE, getLevelGap, getLevelGapSingle, SIBLING_GAP,
  ELBOW_SNAP, BRANCH_HIT_WIDTH, TRIANGLE_HIT_WIDTH,
  COLORS, FONT_OPTIONS, FONT_SIZES,
  getFontFamily, setFontFamily, getFontSize, setFontSize,
  openColorPicker, closeColorPicker, addCustomColorButton,
  hexToRgb, rgbToHex,
  genId, getNextId, setNextId,
  defaultRuns, runsToPlainText, getArrowLabelRuns,
  splitRunsIntoLines, runsToHTML, escHtml, htmlToRuns,
  TreeNode, parseBracketNotation,
  measureNodeSize,
  layoutTree, applyOffsets,
  createSvgRunSpans,
  getAnchorPos, getAnchorDir,
} from './tree.js';

// ── Tutorial ──

class Tutorial {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.stepIndex = 0;
    this._savedState = null;
    this._pollTimer = null;
    this._completed = false; // current step completed?

    this.overlay = document.getElementById('tutorial-overlay');
    this.spotlight = document.getElementById('tutorial-spotlight');
    this.panel = document.getElementById('tutorial-panel');
    this.contentEl = document.getElementById('tutorial-content');
    this.progressText = document.getElementById('tutorial-progress-text');
    this.progressFill = document.getElementById('tutorial-progress-fill');
    this.nextBtn = document.getElementById('tutorial-next');
    this.skipBtn = document.getElementById('tutorial-skip');

    this.nextBtn.addEventListener('click', () => this.next());
    this.skipBtn.addEventListener('click', () => this.end());

    this._onResize = () => { if (this.active) this._positionAll(); };
    this._onScroll = () => { if (this.active) this._positionAll(); };

    this.steps = this._defineSteps();
  }

  start() {
    if (this.active) return;
    // Save current user state
    this._savedState = this.app._getProjectData();
    // Clear canvas for tutorial
    this.app.root = null;
    this.app.arrows = [];
    this.app.selectedId = null;
    this.app.selectedArrowIdx = null;
    this.app.undoStack = [];
    this.app.redoStack = [];
    this.app.render();

    // Ensure bracket panel is collapsed for a clean start
    const panel = document.getElementById('side-panel');
    if (!panel.classList.contains('collapsed')) {
      this.app.toggleSidePanel();
    }

    this.active = true;
    this.stepIndex = 0;
    this.overlay.style.display = '';
    window.addEventListener('resize', this._onResize);
    document.getElementById('canvas-wrapper').addEventListener('scroll', this._onScroll, true);
    this._goToStep(0);
  }

  end() {
    this.active = false;
    this._stopPolling();
    this.overlay.style.display = 'none';
    this.spotlight.classList.add('hidden');
    window.removeEventListener('resize', this._onResize);
    document.getElementById('canvas-wrapper').removeEventListener('scroll', this._onScroll, true);

    // Restore user's tree
    if (this._savedState) {
      this.app._loadProjectData(this._savedState);
      this._savedState = null;
    }
    this.app.render();
    localStorage.setItem('derivation-tutorial-seen', '1');
  }

  next() {
    if (this.stepIndex < this.steps.length - 1) {
      this._goToStep(this.stepIndex + 1);
    } else {
      this.end();
    }
  }

  _goToStep(idx) {
    this.stepIndex = idx;
    this._completed = false;
    this._stopPolling();

    // Clean up any open state from previous step
    if (this.app.editingNode) this.app.commitEdit();
    if (this.app.editingArrowIdx !== null) this.app.commitArrowEdit();
    if (this.app.arrowMode) this.app.toggleArrowMode();
    // Deselect all to start fresh
    this.app.deselectAll();
    this.app.render();

    const step = this.steps[idx];
    const total = this.steps.length;

    // Progress
    this.progressText.textContent = `Step ${idx + 1} of ${total}`;
    this.progressFill.style.width = `${((idx + 1) / total) * 100}%`;

    // Content
    this.contentEl.innerHTML =
      `<h3>${step.title}</h3><p>${step.text}</p>`;

    // Next button
    if (step.manualAdvance) {
      this.nextBtn.style.display = '';
      this.nextBtn.textContent = idx === total - 1 ? 'Finish' : 'Next';
    } else {
      this.nextBtn.style.display = 'none';
    }

    // Setup hook
    if (step.setup) step.setup(this.app);

    // Spotlight
    this._positionAll();

    // Start polling for completion
    if (step.check && !step.manualAdvance) {
      this._startPolling();
    }
  }

  _positionAll() {
    const step = this.steps[this.stepIndex];
    const targetEl = step.target ? step.target() : null;

    if (targetEl) {
      const r = targetEl instanceof Element ? targetEl.getBoundingClientRect() : targetEl;
      const pad = 4;
      this.spotlight.style.left = (r.left - pad) + 'px';
      this.spotlight.style.top = (r.top - pad) + 'px';
      this.spotlight.style.width = (r.width + pad * 2) + 'px';
      this.spotlight.style.height = (r.height + pad * 2) + 'px';
      this.spotlight.classList.remove('hidden');
      this.spotlight.classList.toggle('waiting', !this._completed);
      if (step.panelPosition === 'bottom-right') {
        this._positionPanelCorner();
      } else {
        this._positionPanelNear(r);
      }
    } else {
      // Center panel, no spotlight
      this.spotlight.classList.add('hidden');
      this.panel.style.left = '50%';
      this.panel.style.top = '50%';
      this.panel.style.transform = 'translate(-50%, -50%)';
    }
  }

  _positionPanelNear(targetRect) {
    this.panel.style.transform = '';
    const pw = this.panel.offsetWidth || 320;
    const ph = this.panel.offsetHeight || 200;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left, top;

    // Try below
    if (targetRect.bottom + gap + ph < vh) {
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - pw / 2;
    }
    // Try above
    else if (targetRect.top - gap - ph > 0) {
      top = targetRect.top - gap - ph;
      left = targetRect.left + targetRect.width / 2 - pw / 2;
    }
    // Try right
    else if (targetRect.right + gap + pw < vw) {
      left = targetRect.right + gap;
      top = targetRect.top + targetRect.height / 2 - ph / 2;
    }
    // Try left
    else {
      left = targetRect.left - gap - pw;
      top = targetRect.top + targetRect.height / 2 - ph / 2;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, vw - pw - 12));
    top = Math.max(12, Math.min(top, vh - ph - 12));

    this.panel.style.left = left + 'px';
    this.panel.style.top = top + 'px';
  }

  _positionPanelCorner() {
    this.panel.style.transform = '';
    const pw = this.panel.offsetWidth || 320;
    const ph = this.panel.offsetHeight || 200;
    this.panel.style.left = (window.innerWidth - pw - 16) + 'px';
    this.panel.style.top = (window.innerHeight - ph - 16) + 'px';
  }

  _startPolling() {
    this._pollTimer = setInterval(() => this._checkStep(), 200);
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  _checkStep() {
    const step = this.steps[this.stepIndex];
    if (!step.check || this._completed) return;

    if (step.check(this.app)) {
      this._completed = true;
      this._stopPolling();
      this.spotlight.classList.remove('waiting');

      // Run step-specific cleanup
      if (step.onComplete) step.onComplete(this.app);

      // Show checkmark
      const checkEl = document.createElement('div');
      checkEl.className = 'tutorial-check';
      checkEl.textContent = '✔ Done!';
      this.contentEl.appendChild(checkEl);

      // Show Next button
      this.nextBtn.style.display = '';
      this.nextBtn.textContent = this.stepIndex === this.steps.length - 1 ? 'Finish' : 'Next';
    }
  }

  _defineSteps() {
    return [
      // 0: Welcome
      {
        title: 'Welcome to derivation',
        text: 'This quick tutorial will walk you through the main features. You\'ll build a syntax tree and learn about arrows, brackets, and more.',
        target: null,
        check: null,
        manualAdvance: true,
      },
      // 1: Add Root
      {
        title: 'Add a Root Node',
        text: 'Click the <b>Add Root</b> button in the toolbar to create the root of your tree.',
        target: () => document.getElementById('btn-add-root'),
        check: (app) => app.root !== null,
      },
      // 2: Add Child
      {
        title: 'Add a Child',
        text: 'With the root selected, click <b>Add Child</b> or press <kbd>Tab</kbd> to add a child node.',
        target: () => document.getElementById('btn-add-child'),
        setup: (app) => {
          if (app.root) app.select(app.root.id);
        },
        check: (app) => app.root && app.root.children.length > 0,
      },
      // 3: Add Triangle
      {
        title: 'Add a Triangle',
        text: 'Select a leaf node, then click <b>Add Triangle</b> to create a triangle terminal.',
        target: () => document.getElementById('btn-add-triangle'),
        setup: (app) => {
          if (app.root) {
            const leaves = [];
            function findLeaves(n) { if (n.isLeaf) leaves.push(n); n.children.forEach(findLeaves); }
            findLeaves(app.root);
            if (leaves.length) app.select(leaves[0].id);
          }
        },
        check: (app) => {
          if (!app.root) return false;
          let found = false;
          function walk(n) { if (n.triangle) found = true; n.children.forEach(walk); }
          walk(app.root);
          return found;
        },
      },
      // 4: Edit Label
      {
        title: 'Edit a Label',
        text: 'Double-click any node to edit its label. Try changing the root\'s text.',
        target: () => {
          if (!this.app.root) return null;
          return this.app.svg.querySelector(`.node-group[data-id="${this.app.root.id}"]`);
        },
        panelPosition: 'bottom-right',
        check: (app) => !!document.querySelector('.inline-edit'),
      },
      // 5: Open Bracket Panel
      {
        title: 'Open the Bracket Panel',
        text: 'Click the <b>Brackets</b> tab on the left edge to open the bracket notation panel.',
        target: () => document.getElementById('side-panel-toggle'),
        check: () => !document.getElementById('side-panel').classList.contains('collapsed'),
      },
      // 6: Parse Brackets
      {
        title: 'Parse a Tree',
        text: 'We\'ve added a sample tree. Click <b>Parse</b> to build it from bracket notation.',
        target: () => document.querySelector('.bracket-actions button'),
        setup: (app) => {
          app.bracketInput.value = '[S\n  [NP\n    [\\triangle{the cat}]\n  ]\n  [VP\n    [V\\\\chased]\n    [NP\n      [\\triangle{the mouse}]\n    ]\n  ]\n]';
          app._highlightBrackets();
        },
        check: (app) => app.root && app.root.children.length >= 2,
      },
      // 7: Node Formatting
      {
        title: 'Node Formatting',
        text: 'Selecting a node reveals <b>fill</b> and <b>border</b> color options in the toolbar. <b>Double-click</b> a node to edit its text — this opens the text format bar with <b>Bold</b>, <b>Italic</b>, <b>Underline</b>, <b>Strikethrough</b>, <b>Subscript</b>, <b>Superscript</b>, <b>Small Caps</b>, and <b>text color</b> swatches.',
        panelPosition: 'bottom-right',
        target: () => {
          const a = document.getElementById('node-fill-bar');
          const b = document.getElementById('node-border-bar');
          if (!a || a.style.display === 'none') return null;
          const ra = a.getBoundingClientRect();
          const rb = b && b.style.display !== 'none' ? b.getBoundingClientRect() : ra;
          return {
            left: Math.min(ra.left, rb.left),
            top: Math.min(ra.top, rb.top),
            right: Math.max(ra.right, rb.right),
            bottom: Math.max(ra.bottom, rb.bottom),
            width: Math.max(ra.right, rb.right) - Math.min(ra.left, rb.left),
            height: Math.max(ra.bottom, rb.bottom) - Math.min(ra.top, rb.top),
          };
        },
        setup: (app) => {
          if (app.root) app.select(app.root.id);
        },
        check: null,
        manualAdvance: true,
      },
      // 8: Branch Formatting
      {
        title: 'Branch Formatting',
        text: 'Click on a <b>branch line</b> between two nodes. The toolbar shows branch options: <b>Solid</b>, <b>Dashed</b>, or <b>Dotted</b> styles, and <b>branch color</b> swatches. For triangles, you can also set a <b>fill color</b>.',
        panelPosition: 'bottom-right',
        target: () => document.getElementById('branch-format-bar'),
        setup: (app) => {
          // Select the first branch
          if (app.root && app.root.children.length > 0) {
            app.selectBranch(app.root.children[0].id);
          }
        },
        check: null,
        manualAdvance: true,
      },
      // 9: Create Arrow
      {
        title: 'Draw an Arrow',
        text: 'Click <b>Add Arrow</b>, then click a source node followed by a target node to draw a movement arrow.',
        target: () => document.getElementById('btn-arrow'),
        check: (app) => app.arrows.length > 0,
      },
      // 10: Arrow Formatting
      {
        title: 'Arrow Formatting',
        text: 'Click on an <b>arrow</b> to select it. The toolbar shows: <b>Curve</b>, <b>Straight</b>, or <b>Elbow</b> shapes; <b>Solid</b>, <b>Dashed</b>, or <b>Dotted</b> line styles; <b>arrowhead toggles</b> for start/end (remove both for multidominance); and <b>color</b> swatches.',
        panelPosition: 'bottom-right',
        target: () => document.getElementById('arrow-format-bar'),
        setup: (app) => {
          if (app.arrows.length > 0) app.selectArrow(0);
        },
        check: null,
        manualAdvance: true,
      },
      // 11: Export Info
      {
        title: 'Export Your Tree',
        text: 'Open the <b>File</b> menu to export your tree as PNG or SVG, save your project, or load an existing one.',
        target: () => document.querySelector('.tb-dropdown-wrap button'),
        check: null,
        manualAdvance: true,
      },
      // 12: Completion
      {
        title: 'You\'re all set!',
        text: 'You now know the key features of derivation. Press <kbd>?</kbd> for keyboard shortcuts, or visit the <b>Docs</b> page for the full guide. Happy diagramming!',
        target: null,
        check: null,
        manualAdvance: true,
      },
    ];
  }
}

function branchDashArray(style) {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '1.5 3';
  return null;
}

class App {
  constructor() {
    this.root = null;
    this.nodeMap = new Map();
    this.selectedId = null;
    this.selectedIds = new Set();
    this.selectedBranchIds = new Set();
    this.arrows = [];
    this.selectedArrowIdx = null;
    this.selectedBranchId = null;
    this.arrowMode = null;
    this.arrowSource = null;
    this.undoStack = [];
    this.redoStack = [];
    this.editingNode = null;
    this.editingArrowIdx = null;
    this.alignBottom = false;
    this._clipboard = null;  // subtree JSON for copy/cut-paste
    this._draggingNodeId = null;  // node being dragged (for snap guides)
    this.zoomLevel = 1;
    this._rawZoom = 1;  // tracks intended zoom before snap
    this._spaceDown = false;  // for space+drag panning
    this._isPanning = false;
    this.svg = document.getElementById('tree-canvas');
    this.wrapper = document.getElementById('canvas-wrapper');
    this.emptyState = document.getElementById('empty-state');
    this.bracketInput = document.getElementById('bracket-input');
    this.bracketInput.placeholder =
      '[S\n' +
      '  [NP\n' +
      '    [\\triangle{the cat}]\n' +
      '  ]\n' +
      '  [VP\n' +
      '    [V\\\\chased]\n' +
      '    [NP\n' +
      '      [\\triangle{the mouse}]\n' +
      '    ]\n' +
      '  ]\n' +
      ']';

    this.sidePanel = document.getElementById('side-panel');

    this.buildColorSwatches();
    this.buildBranchColorSwatches();
    this.buildNodeFillSwatches();
    this.buildNodeBorderSwatches();
    this.buildArrowColorSwatches();

    const deselectHandler = (e) => {
      if (this._draggingArrow) return;
      if (this._spaceDown || this._isPanning) return;
      if (e.target.closest('.node-group') || e.target.closest('.arrow-group') || e.target.closest('.arrow-drag-handle') || e.target.closest('.label-drag-handle') || e.target.closest('.branch-drag-handle') || e.target.closest('.branch-group')) return;
      if (!this.arrowMode) {
        this.commitEdit();
        this.deselectAll();
      }
      this.hideContextMenu();
    };
    this.svg.addEventListener('click', deselectHandler);
    this.wrapper.addEventListener('click', (e) => {
      if (e.target === this.wrapper) deselectHandler(e);
    });

    // Flush any pending debounced autosave before the page unloads
    window.addEventListener('beforeunload', () => {
      if (this._autoSaveTimer) this._autoSaveNow();
    });

    // Space+drag panning
    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' && !e.target.closest('.inline-edit') && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (!this._spaceDown) {
          this._spaceDown = true;
          this.wrapper.classList.add('pan-mode');
        }
        e.preventDefault();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this._spaceDown = false;
        if (!this._isPanning) this.wrapper.classList.remove('pan-mode');
      }
    });

    this.wrapper.addEventListener('pointerdown', (e) => {
      // Space+left click or middle mouse button
      const isMiddle = e.button === 1;
      const isSpaceDrag = e.button === 0 && this._spaceDown;
      if (!isMiddle && !isSpaceDrag) return;
      e.preventDefault();
      this._isPanning = true;
      this.wrapper.classList.add('pan-mode', 'panning');
      let lastX = e.clientX, lastY = e.clientY;

      const onMove = (ev) => {
        this.wrapper.scrollLeft -= (ev.clientX - lastX);
        this.wrapper.scrollTop -= (ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
      };
      const onUp = () => {
        this._isPanning = false;
        this.wrapper.classList.remove('panning');
        if (!this._spaceDown) this.wrapper.classList.remove('pan-mode');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    // Ctrl/Cmd + scroll wheel / trackpad pinch zoom
    this.wrapper.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Trackpad pinch sends small deltaY values; mouse wheel sends large ones.
        // Scale proportionally for smooth trackpad zoom, cap for mouse wheel.
        const raw = -e.deltaY;
        const step = Math.sign(raw) * Math.min(Math.abs(raw) * 0.005, 0.1);
        this.setZoom(this._rawZoom + step, e);
      }
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const inEdit = e.target.closest('.inline-edit') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

      // Escape — cancel arrow mode, editing, or deselect
      if (e.key === 'Escape') {
        if (this.arrowMode) { this.cancelArrowMode(); return; }
        if (this.editingNode || this.editingArrowIdx != null) { this.cancelEdit(); return; }
        this.deselectAll();
        return;
      }

      // Shortcuts that work even in edit mode
      if (mod && e.key === 'z') {
        if (inEdit) return;
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
        return;
      }

      // Zoom: Ctrl/Cmd + / - / 0
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.zoomIn();
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        this.zoomOut();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        this.zoomReset();
        return;
      }

      // Shortcuts that require the help modal
      if (e.key === '?' || (mod && e.key === '/')) {
        e.preventDefault();
        this.toggleShortcutsHelp();
        return;
      }

      // Ctrl/Cmd+C — copy subtree
      if (mod && e.key === 'c' && !inEdit) {
        if (this.selectedId) {
          e.preventDefault();
          this.copySubtree();
        }
        return;
      }

      // Ctrl/Cmd+X — cut subtree
      if (mod && e.key === 'x' && !inEdit) {
        if (this.selectedId) {
          e.preventDefault();
          this.cutSubtree();
        }
        return;
      }

      // Ctrl/Cmd+V — paste subtree
      if (mod && e.key === 'v' && !inEdit) {
        e.preventDefault();
        this.pasteSubtree();
        return;
      }

      if (inEdit) return;

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (this.selectedArrowIdx !== null) this.deleteSelectedArrow();
        else this.deleteSelected();
        return;
      }

      // Tab — add child to selected node
      if (e.key === 'Tab' && !e.shiftKey) {
        if (this.selectedId) {
          e.preventDefault();
          this.addChildToSelected();
        }
        return;
      }

      // Enter — edit selected node
      if (e.key === 'Enter') {
        if (this.selectedId) {
          e.preventDefault();
          this.startEditing(this.selectedId);
        }
        return;
      }

      // T — add triangle child
      if (e.key === 't' && !mod && this.selectedId) {
        e.preventDefault();
        this.addTriangleChild();
        return;
      }

      // A — toggle arrow mode
      if (e.key === 'a' && !mod) {
        e.preventDefault();
        this.toggleArrowMode();
        return;
      }

      // Arrow keys — navigate between nodes
      if (e.key.startsWith('Arrow') && this.selectedId && this.root) {
        e.preventDefault();
        const node = this.findNode(this.selectedId);
        if (!node) return;
        let target = null;
        if (e.key === 'ArrowUp' && node.parent) {
          target = node.parent;
        } else if (e.key === 'ArrowDown' && node.children.length > 0) {
          target = node.children[0];
        } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && node.parent) {
          const siblings = node.parent.children;
          const idx = siblings.indexOf(node);
          if (e.key === 'ArrowLeft' && idx > 0) target = siblings[idx - 1];
          if (e.key === 'ArrowRight' && idx < siblings.length - 1) target = siblings[idx + 1];
        }
        if (target) this.select(target.id);
        return;
      }

      // Ctrl/Cmd+S — save
      if (mod && e.key === 's') {
        e.preventDefault();
        this.saveJson();
        return;
      }

      // Ctrl/Cmd+E — export PNG
      if (mod && e.key === 'e') {
        e.preventDefault();
        this.exportPng();
        return;
      }

    });

    this.bracketInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.parseBrackets();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.target;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (e.shiftKey) {
          // Shift+Tab: outdent selected lines
          const val = ta.value;
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = end;
          const block = val.substring(lineStart, lineEnd);
          const outdented = block.replace(/^  /gm, '');
          const removed = block.length - outdented.length;
          ta.value = val.substring(0, lineStart) + outdented + val.substring(lineEnd);
          ta.selectionStart = Math.max(lineStart, start - (val.substring(lineStart, start).match(/^  /) ? 2 : 0));
          ta.selectionEnd = end - removed;
        } else if (start !== end) {
          // Tab with selection: indent all selected lines
          const val = ta.value;
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const block = val.substring(lineStart, end);
          const indented = block.replace(/^/gm, '  ');
          const added = indented.length - block.length;
          ta.value = val.substring(0, lineStart) + indented + val.substring(end);
          ta.selectionStart = start + 2;
          ta.selectionEnd = end + added;
        } else {
          // Tab without selection: insert two spaces
          ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = start + 2;
        }
      }
    });

    // Bracket highlighting
    this.bracketBackdrop = document.getElementById('bracket-backdrop');
    this.bracketInput.addEventListener('input', () => this._highlightBrackets());
    this.bracketInput.addEventListener('keyup', () => this._highlightBrackets());
    this.bracketInput.addEventListener('click', () => this._highlightBrackets());
    this.bracketInput.addEventListener('scroll', () => {
      this.bracketBackdrop.scrollTop = this.bracketInput.scrollTop;
      this.bracketBackdrop.scrollLeft = this.bracketInput.scrollLeft;
    });

    document.getElementById('file-input').addEventListener('change', (e) => {
      this._handleFileLoad(e);
    });

    this._initFontSelectors();
    this._initSidePanelResize();
    document.getElementById('zoom-level').addEventListener('dblclick', () => this.zoomReset());

    // Restore from URL hash (shared link) or fall back to autosave
    this._restoreAutoSave();
    this.render();
    this._restoreFromURL().then(restored => {
      if (restored) this.render();
    });

    // Tutorial
    this.tutorial = new Tutorial(this);
    if (!localStorage.getItem('derivation-tutorial-seen')) {
      setTimeout(() => this.tutorial.start(), 600);
    }
  }

  _initFontSelectors() {
    const famSelect = document.getElementById('font-family-select');
    const sizeSelect = document.getElementById('font-size-select');
    FONT_OPTIONS.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.value;
      opt.textContent = f.label;
      opt.style.fontFamily = f.value;
      famSelect.appendChild(opt);
    });
    FONT_SIZES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s + 'px';
      sizeSelect.appendChild(opt);
    });
    famSelect.value = getFontFamily();
    sizeSelect.value = getFontSize();
    this._applyFontCSS();
  }

  changeFont(value) {
    if (this.root) this.saveState();
    setFontFamily(value);
    this._applyFontCSS();
    if (this.root) {
      this.render();
      this._autoSave();
    }
  }

  changeFontSize(value) {
    if (this.root) this.saveState();
    setFontSize(value);
    this._applyFontCSS();
    if (this.root) {
      this.render();
      this._autoSave();
    }
  }

  _applyFontCSS() {
    this.svg.style.setProperty('--tree-font', getFontFamily());
    this.svg.style.setProperty('--tree-font-size', getFontSize() + 'px');
    this.svg.style.setProperty('--arrow-label-size', Math.round(getFontSize() * 0.75) + 'px');
    this.wrapper.style.setProperty('--tree-font', getFontFamily());
    this.wrapper.style.setProperty('--tree-font-size', getFontSize() + 'px');
  }

  // Convert mouse event to SVG coordinates (accounts for scroll and zoom)
  svgPoint(e) {
    const wr = this.wrapper.getBoundingClientRect();
    return {
      x: (e.clientX - wr.left + this.wrapper.scrollLeft) / this.zoomLevel,
      y: (e.clientY - wr.top + this.wrapper.scrollTop) / this.zoomLevel
    };
  }

  buildColorSwatches() {
    const container = document.getElementById('color-swatches');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'fmt-swatch';
      btn.title = c.name;
      btn.dataset.color = c.hex;
      btn.setAttribute('onmousedown', 'event.preventDefault()');
      btn.onclick = () => this.applyColor(c.hex);
      const inner = document.createElement('div');
      inner.className = 'fmt-swatch-inner';
      inner.style.background = c.hex;
      btn.appendChild(inner);
      container.appendChild(btn);
    });
    addCustomColorButton(container, (hex) => this.applyColor(hex));
  }

  buildBranchColorSwatches() {
    const container = document.getElementById('branch-color-swatches-bar');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'fmt-swatch';
      btn.title = c.name;
      btn.dataset.color = c.hex;
      btn.onclick = () => this.setBranchColor(c.hex);
      const inner = document.createElement('div');
      inner.className = 'fmt-swatch-inner';
      inner.style.background = c.hex;
      btn.appendChild(inner);
      container.appendChild(btn);
    });
    addCustomColorButton(container, (hex) => this.setBranchColor(hex));
  }


  clearAllSelections() {
    this.selectedId = null;
    this.selectedIds.clear();
    this.selectedBranchId = null;
    this.selectedBranchIds.clear();
    this.selectedArrowIdx = null;
    this._nodeFormatTarget = null;
  }

  deselectAll() {
    this.clearAllSelections();
    document.getElementById('branch-format-bar').style.display = 'none';
    document.getElementById('node-fill-bar').style.display = 'none';
    document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    document.getElementById('btn-delete-arrow').style.display = 'none';
    this.hideFormatBar();
    this.updateArrowFormatBar();
    this.updateToolbar();
    this.svg.querySelectorAll('.node-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.arrow-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.branch-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.arrow-drag-handle').forEach(el => el.remove());
    this.svg.querySelectorAll('.label-drag-handle').forEach(el => el.remove());
    this.svg.querySelectorAll('.branch-drag-handle').forEach(el => el.remove());
    this.svg.querySelectorAll('.curve-guide').forEach(el => el.remove());
  }

  selectBranch(childId) {
    const changed = this.selectedBranchId !== childId;
    this.selectedBranchId = childId;
    this.selectedBranchIds.clear();
    if (childId) this.selectedBranchIds.add(childId);
    if (childId !== null) {
      this.selectedId = null;
      this.selectedIds.clear();
      this.selectedArrowIdx = null;
      this.hideFormatBar();
      this.updateArrowFormatBar();
      // For triangles, show fill/border bar targeting the child node
      const node = childId ? this.findNode(childId) : null;
      if (node && node.triangle) {
        this._nodeFormatTarget = childId;
        document.getElementById('node-fill-bar').style.display = 'flex';
        document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
      } else {
        this._nodeFormatTarget = null;
        document.getElementById('node-fill-bar').style.display = 'none';
        document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
      }
    } else {
      this._nodeFormatTarget = null;
    }
    document.getElementById('branch-format-bar').style.display = childId !== null ? 'flex' : 'none';
    if (childId !== null) {
      const node = childId ? this.findNode(childId) : null;
      this._updateBranchStyleButtons(node ? node.branchStyle : null);
    }
    if (changed) this.render();
  }

  toggleSelectBranch(childId) {
    if (this.selectedBranchIds.has(childId)) {
      this.selectedBranchIds.delete(childId);
    } else {
      this.selectedBranchIds.add(childId);
    }
    if (this.selectedBranchIds.size > 0) {
      this.selectedBranchId = childId;
      this.selectedId = null;
      this.selectedIds.clear();
      this.selectedArrowIdx = null;
      this.hideFormatBar();
      this.updateArrowFormatBar();
      // Show triangle fill bar if any selected is a triangle
      let hasTriangle = false;
      this.selectedBranchIds.forEach(id => {
        const node = this.findNode(id);
        if (node && node.triangle) hasTriangle = true;
      });
      if (hasTriangle) {
        this._nodeFormatTarget = childId;
        document.getElementById('node-fill-bar').style.display = 'flex';
        document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
      } else {
        this._nodeFormatTarget = null;
        document.getElementById('node-fill-bar').style.display = 'none';
        document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
      }
    } else {
      this.selectedBranchId = null;
      this._nodeFormatTarget = null;
      document.getElementById('node-fill-bar').style.display = 'none';
      document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    }
    const hasSelection = this.selectedBranchIds.size > 0;
    document.getElementById('branch-format-bar').style.display = hasSelection ? 'flex' : 'none';
    this.render();
  }

  setBranchStyle(style) {
    if (this.selectedBranchIds.size > 1) {
      if (!this.root) return;
      this.saveState();
      this.selectedBranchIds.forEach(id => {
        const node = this.findNode(id);
        if (node) node.branchStyle = style;
      });
      this.render();
      this._reapplyMultiBranchSelect();
      return;
    }
    if (!this.selectedBranchId || !this.root) return;
    const node = this.findNode(this.selectedBranchId);
    if (!node) return;
    this.saveState();
    node.branchStyle = style;
    this.render();
    this.selectBranch(this.selectedBranchId);
  }

  _updateBranchStyleButtons(style) {
    document.getElementById('bfmt-solid').classList.toggle('on', !style);
    document.getElementById('bfmt-dashed').classList.toggle('on', style === 'dashed');
    document.getElementById('bfmt-dotted').classList.toggle('on', style === 'dotted');
  }

  setBranchColor(hex) {
    if (this.selectedBranchIds.size > 1) {
      if (!this.root) return;
      this.saveState();
      this.selectedBranchIds.forEach(id => {
        const node = this.findNode(id);
        if (node) node.branchColor = hex;
      });
      this.render();
      this._reapplyMultiBranchSelect();
      return;
    }
    if (!this.selectedBranchId || !this.root) return;
    const node = this.findNode(this.selectedBranchId);
    if (!node) return;
    this.saveState();
    node.branchColor = hex;
    this.render();
    this.selectBranch(this.selectedBranchId);
  }

  buildNodeBorderSwatches() {
    const container = document.getElementById('node-border-swatches');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'fmt-swatch';
      btn.title = c.name;
      btn.dataset.color = c.hex;
      btn.onclick = () => this.setNodeBorderColor(c.hex);
      const inner = document.createElement('div');
      inner.className = 'fmt-swatch-inner';
      inner.style.background = c.hex;
      btn.appendChild(inner);
      container.appendChild(btn);
    });
    addCustomColorButton(container, (hex) => this.setNodeBorderColor(hex));
  }

  setNodeBorderColor(hex) {
    if (this.selectedIds.size > 1) {
      if (!this.root) return;
      this.saveState();
      this.selectedIds.forEach(id => {
        const node = this.findNode(id);
        if (node) node.borderColor = hex;
      });
      this.render();
      this._reapplyMultiSelect();
      return;
    }
    const targetId = this.selectedId || this._nodeFormatTarget;
    if (!targetId || !this.root) return;
    const node = this.findNode(targetId);
    if (!node) return;
    this.saveState();
    node.borderColor = hex;
    this.render();
    if (this.selectedId) this.select(this.selectedId);
    else if (this._nodeFormatTarget) this.selectBranch(this._nodeFormatTarget);
  }

  buildNodeFillSwatches() {
    const container = document.getElementById('node-fill-swatches');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'fmt-swatch';
      btn.title = c.name;
      btn.dataset.color = c.hex;
      btn.onclick = () => this.setNodeFillColor(c.hex);
      const inner = document.createElement('div');
      inner.className = 'fmt-swatch-inner';
      inner.style.background = c.hex;
      btn.appendChild(inner);
      container.appendChild(btn);
    });
    addCustomColorButton(container, (hex) => this.setNodeFillColor(hex));
  }

  setNodeFillColor(hex) {
    // Multi-select nodes
    if (this.selectedIds.size > 1) {
      if (!this.root) return;
      this.saveState();
      this.selectedIds.forEach(id => {
        const node = this.findNode(id);
        if (node) node.fillColor = hex;
      });
      this.render();
      this._reapplyMultiSelect();
      return;
    }
    // Multi-select branches/triangles
    if (this.selectedBranchIds.size > 1 && this._nodeFormatTarget && !this.selectedId) {
      if (!this.root) return;
      this.saveState();
      this.selectedBranchIds.forEach(id => {
        const node = this.findNode(id);
        if (node && node.triangle) node.triangleFillColor = hex;
      });
      this.render();
      this._reapplyMultiBranchSelect();
      return;
    }
    const targetId = this.selectedId || this._nodeFormatTarget;
    if (!targetId || !this.root) return;
    const node = this.findNode(targetId);
    if (!node) return;
    this.saveState();
    // If triggered from triangle selection, set triangle fill; otherwise node fill
    if (this._nodeFormatTarget && !this.selectedId) {
      node.triangleFillColor = hex;
    } else {
      node.fillColor = hex;
    }
    this.render();
    if (this.selectedId) this.select(this.selectedId);
    else if (this._nodeFormatTarget) this.selectBranch(this._nodeFormatTarget);
  }

  setNodeAlign(align) {
    // align: 'left', 'center', 'right' — null means center
    const val = align === 'center' ? null : align;
    if (this.selectedIds.size > 1) {
      if (!this.root) return;
      this.saveState();
      this.selectedIds.forEach(id => {
        const node = this.findNode(id);
        if (node) node.align = val;
      });
      this.render();
      this._reapplyMultiSelect();
      this._updateAlignButtons();
      return;
    }
    const targetId = this.selectedId || this.editingNode;
    if (!targetId || !this.root) return;
    const node = this.findNode(targetId);
    if (!node) return;
    this.saveState();
    node.align = val;
    // Update inline edit alignment if currently editing
    const editDiv = document.querySelector('.inline-edit');
    if (editDiv) {
      editDiv.style.textAlign = val || 'center';
    }
    this.render();
    if (this.selectedId) this.select(this.selectedId);
    this._updateAlignButtons();
  }

  _updateAlignButtons() {
    const targetId = this.selectedId || this.editingNode;
    const node = targetId ? this.findNode(targetId) : null;
    const align = node ? (node.align || 'center') : 'center';
    // Update both format-bar and node-bar align buttons
    ['fmt-align-', 'nfmt-align-'].forEach(prefix => {
      const l = document.getElementById(prefix + 'left');
      const c = document.getElementById(prefix + 'center');
      const r = document.getElementById(prefix + 'right');
      if (l) l.classList.toggle('on', align === 'left');
      if (c) c.classList.toggle('on', align === 'center');
      if (r) r.classList.toggle('on', align === 'right');
    });
  }

  buildArrowColorSwatches() {
    const container = document.getElementById('arrow-color-swatches');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'fmt-swatch';
      btn.title = c.name;
      btn.dataset.color = c.hex;
      btn.onclick = () => this.setArrowColor(c.hex);
      const inner = document.createElement('div');
      inner.className = 'fmt-swatch-inner';
      inner.style.background = c.hex;
      btn.appendChild(inner);
      container.appendChild(btn);
    });
    addCustomColorButton(container, (hex) => this.setArrowColor(hex));
  }

  setArrowShape(shape) {
    if (this.selectedArrowIdx === null) return;
    this.saveState();
    this.arrows[this.selectedArrowIdx].shape = shape;
    delete this.arrows[this.selectedArrowIdx].elbowMidValue;
    delete this.arrows[this.selectedArrowIdx].elbowMidValue2;
    delete this.arrows[this.selectedArrowIdx].elbowMidValue3;
    this.render();
    this.selectArrow(this.selectedArrowIdx);
  }

  setArrowStyle(style) {
    if (this.selectedArrowIdx === null) return;
    this.saveState();
    this.arrows[this.selectedArrowIdx].style = style;
    this.render();
    this.selectArrow(this.selectedArrowIdx);
  }

  toggleArrowHead(which) {
    if (this.selectedArrowIdx === null) return;
    this.saveState();
    const arrow = this.arrows[this.selectedArrowIdx];
    if (which === 'start') {
      arrow.headStart = !arrow.headStart;
    } else {
      arrow.headEnd = arrow.headEnd === false ? true : false;
    }
    this.render();
    this.selectArrow(this.selectedArrowIdx);
  }

  setArrowColor(hex) {
    if (this.selectedArrowIdx === null) return;
    this.saveState();
    this.arrows[this.selectedArrowIdx].color = hex;
    this.render();
    this.selectArrow(this.selectedArrowIdx);
  }

  updateArrowFormatBar() {
    const bar = document.getElementById('arrow-format-bar');
    if (this.selectedArrowIdx === null) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const arrow = this.arrows[this.selectedArrowIdx];
    const shape = arrow.shape || 'curve';
    document.getElementById('afmt-curve').classList.toggle('on', shape === 'curve');
    document.getElementById('afmt-straight').classList.toggle('on', shape === 'straight');
    document.getElementById('afmt-elbow').classList.toggle('on', shape === 'elbow');
    const style = arrow.style || 'dash';
    document.getElementById('afmt-solid').classList.toggle('on', style === 'solid');
    document.getElementById('afmt-dash').classList.toggle('on', style === 'dash');
    document.getElementById('afmt-dot').classList.toggle('on', style === 'dot');
    const color = arrow.color || '#333333';
    document.querySelectorAll('#arrow-color-swatches .fmt-swatch').forEach(s => {
      s.classList.toggle('on', s.dataset.color === color);
    });
    document.getElementById('afmt-head-start').classList.toggle('on', !!arrow.headStart);
    document.getElementById('afmt-head-end').classList.toggle('on', arrow.headEnd !== false);
  }

  findNode(id) {
    // O(1) lookup from map built during render(); fallback to tree walk if map is stale
    if (this.nodeMap.has(id)) return this.nodeMap.get(id);
    if (!this.root) return null;
    function find(n) {
      if (n.id === id) return n;
      for (const c of n.children) { const r = find(c); if (r) return r; }
      return null;
    }
    return find(this.root);
  }

  _snapshot() {
    return {
      tree: this.root ? this.root.toJSON() : null,
      arrows: JSON.parse(JSON.stringify(this.arrows)),
      fontFamily: getFontFamily(),
      fontSize: getFontSize(),
      alignBottom: this.alignBottom,
    };
  }

  saveState() {
    // Commit any ongoing inline edit so the snapshot reflects the latest text
    const snap = this._snapshot();
    // Deduplicate: skip if identical to top of undo stack
    if (this.undoStack.length > 0) {
      const top = this.undoStack[this.undoStack.length - 1];
      if (JSON.stringify(top) === JSON.stringify(snap)) return;
    }
    this.undoStack.push(snap);
    this.redoStack = [];
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  _restoreSnapshot(state) {
    this.root = state.tree ? TreeNode.fromJSON(state.tree) : null;
    this._syncNextId();
    this.arrows = state.arrows ? JSON.parse(JSON.stringify(state.arrows)) : [];
    if (state.fontFamily && state.fontFamily !== getFontFamily()) {
      setFontFamily(state.fontFamily);
      document.getElementById('font-family-select').value = state.fontFamily;
    }
    if (state.fontSize != null && state.fontSize !== getFontSize()) {
      setFontSize(state.fontSize);
      document.getElementById('font-size-select').value = state.fontSize;
    }
    if (state.alignBottom != null) {
      this.alignBottom = state.alignBottom;
      this._updateAlignBottomBtn();
    }
    this._applyFontCSS();
    // Clear all selections
    this.selectedId = null;
    this.selectedIds = new Set();
    this.selectedBranchId = null;
    this.selectedBranchIds = new Set();
    this.selectedArrowIdx = null;
    this._nodeFormatTarget = null;
    this.editingNode = null;
    document.getElementById('branch-format-bar').style.display = 'none';
    document.getElementById('node-fill-bar').style.display = 'none';
    document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
  }

  // Silently commit any open editor without creating an undo entry
  _commitEditSilent() {
    if (this.editingArrowIdx != null) {
      // Commit arrow edit without undo
      const div = document.querySelector('.inline-edit');
      if (div && this.editingArrowIdx != null) {
        const arrow = this.arrows[this.editingArrowIdx];
        if (arrow) {
          const newRuns = htmlToRuns(div);
          const newLabel = newRuns.length > 0 && runsToPlainText(newRuns).trim() ? newRuns : [];
          arrow.labelRuns = newLabel;
          delete arrow.label;
        }
        div.remove();
        this.editingArrowIdx = null;
        this.hideFormatBar();
      }
      return;
    }
    const div = document.querySelector('.inline-edit');
    if (!div || !this.editingNode) return;
    const node = this.findNode(this.editingNode);
    if (node) {
      const newRuns = htmlToRuns(div);
      if (newRuns.length > 0 && runsToPlainText(newRuns).trim()) {
        node.runs = newRuns;
      }
    }
    this.editingNode = null;
    div.remove();
    this.hideFormatBar();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    // Commit open editor as part of the current state (no new undo entry)
    this._commitEditSilent();
    // Save current state to redo stack
    this.redoStack.push(this._snapshot());
    const state = this.undoStack.pop();
    this._restoreSnapshot(state);
    this.render();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    this._commitEditSilent();
    this.undoStack.push(this._snapshot());
    const state = this.redoStack.pop();
    this._restoreSnapshot(state);
    this.render();
  }

  // --- Arrow mode ---

  toggleArrowMode() {
    if (this.arrowMode) {
      this.cancelArrowMode();
    } else {
      this.commitEdit();
      this.arrowMode = 'pick-source';
      this.arrowSource = null;
      this.selectedId = null;
      this.selectedArrowIdx = null;
      document.getElementById('arrow-banner').style.display = 'flex';
      document.getElementById('arrow-step').textContent = 'Step 1: Click the source node';
      document.getElementById('btn-arrow').classList.add('active');
      this.svg.classList.add('arrow-mode-active');
      this.render();
    }
  }

  cancelArrowMode() {
    this.arrowMode = null;
    this.arrowSource = null;
    this._arrowSourceAnchor = null;
    document.getElementById('arrow-banner').style.display = 'none';
    document.getElementById('btn-arrow').classList.remove('active');
    this.svg.classList.remove('arrow-mode-active');
    this.render();
  }

  toggleDropdown(id) {
    // Close any other open dropdowns first
    document.querySelectorAll('.toolbar-dropdown').forEach(dd => {
      if (dd.id !== id) dd.style.display = 'none';
    });
    const dd = document.getElementById(id);
    const visible = dd.style.display !== 'none';
    dd.style.display = visible ? 'none' : 'block';
    if (!visible) {
      const close = (e) => {
        if (!e.target.closest('.toolbar-dropdown') && !e.target.closest('.tb-dropdown-wrap') && !e.target.closest('.menu-bar')) {
          document.querySelectorAll('.toolbar-dropdown').forEach(d => d.style.display = 'none');
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }
  }

  closeDropdowns() {
    document.querySelectorAll('.toolbar-dropdown').forEach(dd => dd.style.display = 'none');
  }

  toggleShortcutsHelp() {
    const overlay = document.getElementById('shortcuts-overlay');
    const visible = overlay.style.display !== 'none';
    overlay.style.display = visible ? 'none' : 'flex';
    if (!visible) {
      const closeOnKey = (e) => {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          e.stopPropagation();
          overlay.style.display = 'none';
          document.removeEventListener('keydown', closeOnKey, true);
        }
      };
      document.addEventListener('keydown', closeOnKey, true);
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          overlay.style.display = 'none';
          document.removeEventListener('keydown', closeOnKey, true);
        }
      };
    }
  }

  handleArrowClick(nodeId, e) {
    // Determine which anchor edge the user clicked closest to
    const node = this.findNode(nodeId);
    let anchor = 'bottom';
    if (node && e) {
      const pt = this.svgPoint(e);
      let bestDist = Infinity;
      for (const a of ['top', 'bottom', 'left', 'right']) {
        const p = getAnchorPos(node, a);
        const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
        if (d < bestDist) { bestDist = d; anchor = a; }
      }
    }

    if (this.arrowMode === 'pick-source') {
      this.arrowSource = nodeId;
      this._arrowSourceAnchor = anchor;
      this.arrowMode = 'pick-target';
      document.getElementById('arrow-step').textContent = 'Step 2: Click the target node';
      this.render();
    } else if (this.arrowMode === 'pick-target') {
      if (nodeId === this.arrowSource) {
        this.toast('Source and target must be different');
        return;
      }
      this.saveState();
      this.arrows.push({
        fromId: this.arrowSource, toId: nodeId, labelRuns: [],
        fromAnchor: this._arrowSourceAnchor || 'bottom', toAnchor: anchor
      });
      this._arrowSourceAnchor = null;
      this.cancelArrowMode();
      this.toast('Arrow added');
    }
  }

  selectArrow(idx) {
    const changed = this.selectedArrowIdx !== idx;
    this.clearAllSelections();
    this.selectedArrowIdx = idx;
    document.getElementById('branch-format-bar').style.display = 'none';
    document.getElementById('node-fill-bar').style.display = 'none';
    document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    this.hideFormatBar();
    this.updateArrowFormatBar();
    const btn = document.getElementById('btn-delete-arrow');
    btn.style.display = idx !== null ? '' : 'none';
    btn.disabled = idx === null;
    this.updateToolbar();
    if (changed) this.render();
  }

  deleteSelectedArrow() {
    if (this.selectedArrowIdx === null) return;
    this.saveState();
    this.arrows.splice(this.selectedArrowIdx, 1);
    this.selectedArrowIdx = null;
    this.render();
  }

  // --- Inline rich text editing ---

  startEditing(id) {
    this.commitEdit();
    const node = this.findNode(id);
    if (!node) return;
    this.editingNode = id;

    const existing = document.querySelector('.inline-edit');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'inline-edit';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.innerHTML = runsToHTML(node.runs);

    const z = this.zoomLevel;
    const padX = 8, padY = 4, border = 2; // must match .inline-edit CSS
    div.style.left = ((node.x - node.w / 2) * z - padX - border) + 'px';
    div.style.top = ((node.y) * z - padY - border) + 'px';
    div.style.minWidth = (node.w * z) + 'px';
    div.style.minHeight = (node.h * z) + 'px';
    div.style.fontSize = (getFontSize() * z) + 'px';
    div.style.textAlign = node.align || 'center';

    div.addEventListener('keydown', (e) => {
      // Shift+Enter or just Enter inserts a new line; plain Enter without shift commits
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitEdit();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold', false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic', false);
      }
    });

    this.showFormatBar();
    document.getElementById('color-swatches').style.display = '';
    document.getElementById('node-fill-bar').style.display = 'none';
    document.getElementById('node-border-bar').style.display = 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    this.wrapper.appendChild(div);
    div.focus();
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  commitEdit() {
    if (this.editingArrowIdx != null) { this.commitArrowEdit(); return; }
    const div = document.querySelector('.inline-edit');
    if (!div || !this.editingNode) return;
    const node = this.findNode(this.editingNode);
    if (node) {
      const newRuns = htmlToRuns(div);
      if (newRuns.length > 0 && runsToPlainText(newRuns).trim()) {
        this.saveState();
        node.runs = newRuns;
      }
    }
    this.editingNode = null;
    div.remove();
    this.hideFormatBar();
    this._clearEditCaret();
    this.render();
  }

  cancelEdit() {
    const div = document.querySelector('.inline-edit');
    if (div) div.remove();
    this.editingNode = null;
    this.editingArrowIdx = null;
    this.hideFormatBar();
    this._clearEditCaret();
  }

  // Firefox keeps a collapsed document selection (blinking caret) on the page
  // after a focused contentEditable edit box is removed. Clear it explicitly.
  _clearEditCaret() {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    const ae = document.activeElement;
    if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
  }

  startEditingArrow(idx, labelX, labelY) {
    this.commitEdit();
    this.commitArrowEdit();
    const arrow = this.arrows[idx];
    if (!arrow) return;
    this.editingArrowIdx = idx;
    this.selectArrow(idx);

    const existing = document.querySelector('.inline-edit');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'inline-edit';
    div.contentEditable = 'true';
    div.spellcheck = false;
    const z = this.zoomLevel;
    div.style.fontSize = Math.round(getFontSize() * 0.75 * z) + 'px';
    div.style.textAlign = 'center';

    const runs = getArrowLabelRuns(arrow);
    div.innerHTML = runs.length > 0 ? runsToHTML(runs) : '';

    div.style.left = ((labelX - 40) * z) + 'px';
    div.style.top = ((labelY - 8) * z) + 'px';
    div.style.minWidth = (80 * z) + 'px';
    div.style.minHeight = (18 * z) + 'px';

    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitArrowEdit();
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold', false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic', false);
      }
    });

    this.showFormatBar();
    this.wrapper.appendChild(div);
    div.focus();
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  commitArrowEdit() {
    const div = document.querySelector('.inline-edit');
    if (!div || this.editingArrowIdx == null) return;
    const arrow = this.arrows[this.editingArrowIdx];
    if (arrow) {
      const newRuns = htmlToRuns(div);
      const newLabel = newRuns.length > 0 && runsToPlainText(newRuns).trim() ? newRuns : [];
      const oldLabel = JSON.stringify(arrow.labelRuns || []);
      if (JSON.stringify(newLabel) !== oldLabel) {
        this.saveState();
        arrow.labelRuns = newLabel;
        delete arrow.label;
      }
    }
    this.editingArrowIdx = null;
    div.remove();
    this.hideFormatBar();
    this._clearEditCaret();
    this.render();
  }

  // --- Format commands ---

  execFmt(command) {
    const div = document.querySelector('.inline-edit');
    if (!div) {
      // Apply to entire node(s) when selected but not editing
      const ids = this.selectedIds.size > 0 ? [...this.selectedIds] : this.selectedId ? [this.selectedId] : [];
      if (ids.length > 0) {
        const fmtKey = command === 'bold' ? 'bold'
                     : command === 'italic' ? 'italic'
                     : command === 'underline' ? 'underline'
                     : command === 'strikeThrough' ? 'strike'
                     : command === 'subscript' ? 'sub'
                     : command === 'superscript' ? 'sup'
                     : command === 'smallcaps' ? 'smallcaps'
                     : null;
        if (!fmtKey) return;
        this.saveState();
        // Toggle: if all runs of all nodes have it, remove; otherwise add
        const nodes = ids.map(id => this.findNode(id)).filter(Boolean);
        const allHave = nodes.every(n => n.runs.every(r => r[fmtKey]));
        nodes.forEach(n => n.runs.forEach(r => { r[fmtKey] = !allHave; }));
        this.render();
        if (this.selectedIds.size > 1) this._reapplyMultiSelect();
        else if (this.selectedId) this.select(this.selectedId);
      }
      return;
    }
    div.focus();
    if (command === 'smallcaps') {
      this._toggleSmallCaps(div);
    } else {
      document.execCommand(command, false);
    }
  }

  _toggleSmallCaps(editDiv) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);

    // Walk up from both anchor and focus to find a small-caps span
    function findSmallCapsSpan(node) {
      while (node && node !== editDiv) {
        if (node.nodeType === 1 && node.style && node.style.fontVariant === 'small-caps') return node;
        node = node.parentNode;
      }
      return null;
    }
    const scSpan = findSmallCapsSpan(sel.anchorNode) || findSmallCapsSpan(sel.focusNode);

    if (scSpan) {
      // Remove small-caps: unwrap the span, preserving children
      const parent = scSpan.parentNode;
      const frag = document.createDocumentFragment();
      while (scSpan.firstChild) frag.appendChild(scSpan.firstChild);
      // Use empty <b> markers that survive normalize()
      const sMark = document.createElement('b');
      const eMark = document.createElement('b');
      parent.insertBefore(sMark, scSpan);
      parent.insertBefore(eMark, scSpan.nextSibling);
      parent.replaceChild(frag, scSpan);
      parent.normalize();
      const newRange = document.createRange();
      newRange.setStartAfter(sMark);
      newRange.setEndBefore(eMark);
      sel.removeAllRanges();
      sel.addRange(newRange);
      sMark.remove();
      eMark.remove();
    } else {
      // Wrap selection in a small-caps span
      const span = document.createElement('span');
      span.style.fontVariant = 'small-caps';
      try {
        range.surroundContents(span);
      } catch (e) {
        // surroundContents fails if selection crosses element boundaries
        // Fall back: extract, wrap, re-insert
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
      }
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      sel.addRange(newRange);
    }
  }

  applyColor(hex) {
    const div = document.querySelector('.inline-edit');
    if (!div) {
      if (this.selectedId) {
        this.startEditing(this.selectedId);
        setTimeout(() => document.execCommand('foreColor', false, hex), 10);
      }
      return;
    }
    div.focus();
    document.execCommand('foreColor', false, hex);
  }

  showFormatBar() {
    document.getElementById('format-bar').style.display = 'flex';
    this._updateAlignButtons();
  }

  hideFormatBar() {
    document.getElementById('format-bar').style.display = 'none';
  }

  toggleWhiteCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.classList.toggle('white-canvas');
    const btn = document.getElementById('btn-white-canvas');
    btn.classList.toggle('on', wrapper.classList.contains('white-canvas'));
  }

  toggleAlignBottom(on) {
    if (this.root) this.saveState();
    this.alignBottom = on;
    this._updateAlignBottomBtn();
    if (this.root) this.render();
  }

  _updateAlignBottomBtn() {
    const btn = document.getElementById('btn-align-bottom');
    if (btn) btn.classList.toggle('on', this.alignBottom);
  }

  // --- Arrows rendering ---

  renderArrows() {
    if (!this.root) return;
    this._pendingElbowHandles = null;
    this._pendingCurveHandles = null;
    this._pendingCurveBendHandle = null;

    const nodeMap = {};
    function collect(n) { nodeMap[n.id] = n; n.children.forEach(collect); }
    collect(this.root);

    const validArrows = [];
    this.arrows.forEach((arrow, idx) => {
      const from = nodeMap[arrow.fromId];
      const to = nodeMap[arrow.toId];
      if (!from || !to) return;
      if (!arrow.fromAnchor) arrow.fromAnchor = 'bottom';
      if (!arrow.toAnchor) arrow.toAnchor = 'bottom';
      validArrows.push({ arrow, idx, from, to });
    });

    validArrows.forEach(({ arrow, idx, from, to }) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `arrow-group${idx === this.selectedArrowIdx ? ' selected' : ''}`);
      g.dataset.idx = idx;

      const p1 = getAnchorPos(from, arrow.fromAnchor, arrow.fromAnchorOffset);
      const p2 = getAnchorPos(to, arrow.toAnchor, arrow.toAnchorOffset);
      const d1 = getAnchorDir(arrow.fromAnchor);
      const d2 = getAnchorDir(arrow.toAnchor);
      const shape = arrow.shape || 'curve';

      const arrowSize = 7;
      const hasHeadEnd = arrow.headEnd !== false;
      const hasHeadStart = !!arrow.headStart;
      let pathD, ux, uy, tipX, tipY, labelX, labelY;
      let startUx, startUy; // unit vector pointing INTO start point (for start arrowhead)

      if (shape === 'straight') {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        ux = dx / len; uy = dy / len;
        startUx = -ux; startUy = -uy;
        tipX = p2.x; tipY = p2.y;
        const endX = hasHeadEnd ? tipX - ux * arrowSize * 0.8 : tipX;
        const endY = hasHeadEnd ? tipY - uy * arrowSize * 0.8 : tipY;
        const startX = hasHeadStart ? p1.x + ux * arrowSize * 0.8 : p1.x;
        const startY = hasHeadStart ? p1.y + uy * arrowSize * 0.8 : p1.y;
        pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
        labelX = (p1.x + p2.x) / 2;
        labelY = (p1.y + p2.y) / 2 - 6;

      } else if (shape === 'elbow') {
        // Extend from both endpoints in their anchor directions,
        // then connect with draggable midpoints.
        const gap = 25;
        const d1h = d1.dx !== 0;
        const d2h = d2.dx !== 0;
        const sameAxis = d1h === d2h;
        const e1 = { x: p1.x + d1.dx * gap, y: p1.y + d1.dy * gap };
        const e2 = { x: p2.x + d2.dx * gap, y: p2.y + d2.dy * gap };
        const pts = [{ x: p1.x, y: p1.y }, { x: e1.x, y: e1.y }];

        let handles = []; // drag handle positions
        const ESNAP = ELBOW_SNAP;
        if (sameAxis && d1h) {
          // Both horizontal: 4 elbows, 3 drag handles
          const defaultMidY = Math.max(e1.y, e2.y) + 30;
          const midY = arrow.elbowMidValue != null ? arrow.elbowMidValue : defaultMidY;
          let lx = arrow.elbowMidValue2 != null ? arrow.elbowMidValue2 : e1.x;
          let rx = arrow.elbowMidValue3 != null ? arrow.elbowMidValue3 : e2.x;
          if (Math.abs(lx - e1.x) < ESNAP) lx = e1.x;
          if (Math.abs(rx - e2.x) < ESNAP) rx = e2.x;
          pts.push({ x: lx, y: e1.y });
          pts.push({ x: lx, y: midY });
          pts.push({ x: rx, y: midY });
          pts.push({ x: rx, y: e2.y });
          handles.push({ x: lx, y: (e1.y + midY) / 2, axis: 'x', which: 2 });
          handles.push({ x: (lx + rx) / 2, y: midY, axis: 'y', which: 1 });
          handles.push({ x: rx, y: (midY + e2.y) / 2, axis: 'x', which: 3 });
        } else if (sameAxis && !d1h) {
          // Both vertical: 2 elbows, 1 drag handle
          const defaultMid = Math.max(e1.y, e2.y) + 20;
          const mid = arrow.elbowMidValue != null ? arrow.elbowMidValue : defaultMid;
          pts.push({ x: e1.x, y: mid });
          pts.push({ x: e2.x, y: mid });
          handles.push({ x: (e1.x + e2.x) / 2, y: mid, axis: 'y', which: 1 });
        } else {
          // Perpendicular axes: 3 elbows, 2 drag handles
          if (d1h) {
            const defaultMid1 = (e1.x + e2.x) / 2;
            const defaultMid2 = e2.y;
            let mid1 = arrow.elbowMidValue != null ? arrow.elbowMidValue : defaultMid1;
            let mid2 = arrow.elbowMidValue2 != null ? arrow.elbowMidValue2 : defaultMid2;
            if (Math.abs(mid1 - e1.x) < ESNAP) mid1 = e1.x;
            if (Math.abs(mid2 - e2.y) < ESNAP) mid2 = e2.y;
            pts.push({ x: mid1, y: e1.y });
            pts.push({ x: mid1, y: mid2 });
            pts.push({ x: e2.x, y: mid2 });
            handles.push({ x: mid1, y: (e1.y + mid2) / 2, axis: 'x', which: 1 });
            handles.push({ x: (mid1 + e2.x) / 2, y: mid2, axis: 'y', which: 2 });
          } else {
            const defaultMid1 = (e1.y + e2.y) / 2;
            const defaultMid2 = e2.x;
            let mid1 = arrow.elbowMidValue != null ? arrow.elbowMidValue : defaultMid1;
            let mid2 = arrow.elbowMidValue2 != null ? arrow.elbowMidValue2 : defaultMid2;
            if (Math.abs(mid1 - e1.y) < ESNAP) mid1 = e1.y;
            if (Math.abs(mid2 - e2.x) < ESNAP) mid2 = e2.x;
            pts.push({ x: e1.x, y: mid1 });
            pts.push({ x: mid2, y: mid1 });
            pts.push({ x: mid2, y: e2.y });
            handles.push({ x: (e1.x + mid2) / 2, y: mid1, axis: 'y', which: 1 });
            handles.push({ x: mid2, y: (mid1 + e2.y) / 2, axis: 'x', which: 2 });
          }
        }

        pts.push({ x: e2.x, y: e2.y });

        // Arrowhead direction: strictly from target anchor orientation
        ux = -d2.dx; uy = -d2.dy;
        startUx = -d1.dx; startUy = -d1.dy; // points INTO p1 from the path direction
        tipX = p2.x; tipY = p2.y;
        if (hasHeadEnd) {
          const endX = tipX - ux * arrowSize * 0.8;
          const endY = tipY - uy * arrowSize * 0.8;
          pts.push({ x: endX, y: endY });
        }
        if (hasHeadStart) {
          // Adjust the first segment start to leave room for start arrowhead
          pts[0] = { x: p1.x + d1.dx * arrowSize * 0.8, y: p1.y + d1.dy * arrowSize * 0.8 };
        }

        // Remove collinear middle points (three points on same horizontal/vertical line)
        for (let i = pts.length - 3; i >= 0; i--) {
          const a = pts[i], b = pts[i + 1], c = pts[i + 2];
          const sameX = Math.abs(a.x - b.x) < 1 && Math.abs(b.x - c.x) < 1;
          const sameY = Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1;
          if (sameX || sameY) pts.splice(i + 1, 1);
        }

        pathD = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
        // Label at midpoint of the crossover segment (clamped after collinear removal)
        let crossIdx = (sameAxis && d1h) ? 3 : sameAxis ? 2 : 3;
        if (crossIdx + 1 >= pts.length) crossIdx = pts.length - 2;
        if (crossIdx < 0) crossIdx = 0;
        labelX = (pts[crossIdx].x + pts[crossIdx + 1].x) / 2;
        labelY = (pts[crossIdx].y + pts[crossIdx + 1].y) / 2 - 6;

        if (idx === this.selectedArrowIdx) {
          this._pendingElbowHandles = handles.map(h => ({
            x: h.x, y: h.y, idx, axis: h.axis, which: h.which
          }));
        }

      } else {
        const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        const defaultArm = Math.max(30, Math.min(80, dist * 0.4));
        const { cp1x, cp1y, cp2x, cp2y } = this._curveControlPoints(arrow, p1, p2, d1, d2, defaultArm);
        const tx = 3 * (p2.x - cp2x);
        const ty = 3 * (p2.y - cp2y);
        const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
        ux = tx / tLen; uy = ty / tLen;
        // Start tangent: from p1 toward cp1
        const stx = cp1x - p1.x, sty = cp1y - p1.y;
        const stLen = Math.sqrt(stx * stx + sty * sty) || 1;
        startUx = -stx / stLen; startUy = -sty / stLen; // points INTO p1
        tipX = p2.x; tipY = p2.y;
        const endX = hasHeadEnd ? tipX - ux * arrowSize * 0.8 : tipX;
        const endY = hasHeadEnd ? tipY - uy * arrowSize * 0.8 : tipY;
        const startX = hasHeadStart ? p1.x - startUx * arrowSize * 0.8 : p1.x;
        const startY = hasHeadStart ? p1.y - startUy * arrowSize * 0.8 : p1.y;
        pathD = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

        // Bezier midpoint for label positioning
        const midBx = 0.125 * p1.x + 0.375 * cp1x + 0.375 * cp2x + 0.125 * endX;
        const midBy = 0.125 * p1.y + 0.375 * cp1y + 0.375 * cp2y + 0.125 * endY;
        labelX = (p1.x + p2.x) / 2;
        labelY = midBy + 14;

        if (idx === this.selectedArrowIdx) {
          this._pendingCurveHandles = [
            { x: cp1x, y: cp1y, idx, which: 1, p1, p2, d1, d2 },
            { x: cp2x, y: cp2y, idx, which: 2, p1, p2, d1, d2 },
          ];
          // Midpoint bend handle
          const bhx = 0.125 * p1.x + 0.375 * cp1x + 0.375 * cp2x + 0.125 * p2.x;
          const bhy = 0.125 * p1.y + 0.375 * cp1y + 0.375 * cp2y + 0.125 * p2.y;
          this._pendingCurveBendHandle = { x: bhx, y: bhy, idx, p1, p2, d1, d2, defaultArm };
        }
      }

      const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hitArea.setAttribute('d', pathD);
      hitArea.setAttribute('stroke', 'transparent');
      hitArea.setAttribute('stroke-width', '14');
      hitArea.setAttribute('fill', 'none');
      hitArea.setAttribute('pointer-events', 'stroke');
      hitArea.style.cursor = 'pointer';
      g.appendChild(hitArea);

      const arrowColor = arrow.color || '#333';
      const arrowStyle = arrow.style || 'dash';
      const dashVal = arrowStyle === 'solid' ? 'none' : arrowStyle === 'dot' ? '2 3' : '5 3';

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('class', 'arrow-path');
      const dashStyle = dashVal !== 'none' ? `stroke-dasharray:${dashVal};` : 'stroke-dasharray:none;';
      path.setAttribute('style', `stroke:${arrowColor};${dashStyle}`);
      g.appendChild(path);

      if (hasHeadEnd) {
        const px = -uy, py = ux;
        const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        head.setAttribute('points',
          `${tipX},${tipY} ${tipX-ux*arrowSize+px*arrowSize*0.45},${tipY-uy*arrowSize+py*arrowSize*0.45} ${tipX-ux*arrowSize-px*arrowSize*0.45},${tipY-uy*arrowSize-py*arrowSize*0.45}`);
        head.setAttribute('class', 'arrow-head arrow-head-end');
        head.setAttribute('style', `fill:${arrowColor};`);
        g.appendChild(head);
      }
      if (hasHeadStart) {
        const sux = startUx, suy = startUy;
        const spx = -suy, spy = sux;
        const headS = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        headS.setAttribute('points',
          `${p1.x},${p1.y} ${p1.x-sux*arrowSize+spx*arrowSize*0.45},${p1.y-suy*arrowSize+spy*arrowSize*0.45} ${p1.x-sux*arrowSize-spx*arrowSize*0.45},${p1.y-suy*arrowSize-spy*arrowSize*0.45}`);
        headS.setAttribute('class', 'arrow-head arrow-head-start');
        headS.setAttribute('style', `fill:${arrowColor};`);
        g.appendChild(headS);
      }

      // Apply label offset
      const finalLabelX = labelX + (arrow.labelOffsetX || 0);
      const finalLabelY = labelY + (arrow.labelOffsetY || 0);

      const arrowRuns = getArrowLabelRuns(arrow);
      if (arrowRuns.length > 0) {
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('x', finalLabelX);
        lbl.setAttribute('y', finalLabelY);
        lbl.setAttribute('class', 'arrow-label');
        for (const r of arrowRuns) {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.textContent = r.text;
          if (r.bold) tspan.setAttribute('font-weight', 'bold');
          if (r.italic) tspan.setAttribute('font-style', 'italic');
          if (r.sub) { tspan.setAttribute('font-size', '7'); tspan.setAttribute('baseline-shift', 'sub'); }
          if (r.sup) { tspan.setAttribute('font-size', '7'); tspan.setAttribute('baseline-shift', 'super'); }
          if (r.strike) tspan.setAttribute('text-decoration', 'line-through');
          if (r.smallcaps) tspan.setAttribute('font-variant', 'small-caps');
          tspan.setAttribute('fill', r.color || arrowColor);
          lbl.appendChild(tspan);
        }
        g.appendChild(lbl);
      }

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!this.arrowMode && !this._draggingArrow) this.selectArrow(idx);
      });

      g.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startEditingArrow(idx, finalLabelX, finalLabelY);
      });

      this.svg.appendChild(g);

      if (idx === this.selectedArrowIdx) {
        this._renderDragHandle(p1.x, p1.y, idx, 'from', nodeMap);
        this._renderDragHandle(tipX, tipY, idx, 'to', nodeMap);
        // Label drag handle
        if (arrowRuns.length > 0) {
          this._renderLabelDragHandle(finalLabelX, finalLabelY, idx, labelX, labelY);
        }
      }
    });

    if (this._pendingElbowHandles) {
      for (const h of this._pendingElbowHandles) {
        this._renderElbowHandle(h.x, h.y, h.idx, h.axis, h.which);
      }
      this._pendingElbowHandles = null;
    }
    if (this._pendingCurveHandles) {
      for (const h of this._pendingCurveHandles) {
        this._renderCurveHandle(h.x, h.y, h.idx, h.which, h.p1, h.p2, h.d1, h.d2);
      }
      this._pendingCurveHandles = null;
    }
    if (this._pendingCurveBendHandle) {
      const h = this._pendingCurveBendHandle;
      this._renderCurveBendHandle(h.x, h.y, h.idx, h.p1, h.p2, h.d1, h.d2, h.defaultArm);
      this._pendingCurveBendHandle = null;
    }
  }

  _renderDragHandle(cx, cy, arrowIdx, endpoint, nodeMap) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 6);
    circle.setAttribute('class', 'arrow-drag-handle');

    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startAnchorDrag(arrowIdx, endpoint, nodeMap, e);
    });

    this.svg.appendChild(circle);
  }

  _renderLabelDragHandle(cx, cy, arrowIdx, baseLabelX, baseLabelY) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 5);
    circle.setAttribute('class', 'label-drag-handle');

    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startLabelDrag(arrowIdx, baseLabelX, baseLabelY, e);
    });

    this.svg.appendChild(circle);
  }

  _startLabelDrag(arrowIdx, baseLabelX, baseLabelY, mouseEvent) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    this._draggingArrow = true;
    let saved = false;

    const svgPt = (e) => this.svgPoint(e);
    const startPt = svgPt(mouseEvent);
    const startOffX = arrow.labelOffsetX || 0;
    const startOffY = arrow.labelOffsetY || 0;

    // Find the label text and the drag handle for live updates
    const arrowGroup = this.svg.querySelector(`.arrow-group[data-idx="${arrowIdx}"]`);
    const lblEl = arrowGroup ? arrowGroup.querySelector('.arrow-label') : null;
    const handleEl = this.svg.querySelector('.label-drag-handle');

    const onMove = (e) => {
      if (!saved) { this.saveState(); saved = true; }
      const pt = svgPt(e);
      arrow.labelOffsetX = startOffX + (pt.x - startPt.x);
      arrow.labelOffsetY = startOffY + (pt.y - startPt.y);

      // Live update label and handle position without full re-render
      const newX = baseLabelX + arrow.labelOffsetX;
      const newY = baseLabelY + arrow.labelOffsetY;
      if (lblEl) {
        lblEl.setAttribute('x', newX);
        lblEl.setAttribute('y', newY);
      }
      if (handleEl) {
        handleEl.setAttribute('cx', newX);
        handleEl.setAttribute('cy', newY);
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { this._draggingArrow = false; }, 50);
      this.render();
      this.selectArrow(arrowIdx);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _renderElbowHandle(cx, cy, arrowIdx, axis, which) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const size = 8;
    rect.setAttribute('x', cx - size / 2);
    rect.setAttribute('y', cy - size / 2);
    rect.setAttribute('width', size);
    rect.setAttribute('height', size);
    rect.setAttribute('rx', 2);
    rect.setAttribute('class', 'arrow-drag-handle');
    rect.dataset.which = which;
    rect.style.cursor = axis === 'x' ? 'ew-resize' : 'ns-resize';

    rect.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startElbowDrag(arrowIdx, axis, which);
    });

    this.svg.appendChild(rect);
  }

  // Resolve the two cubic control points for a curved arrow. Each control point
  // is a free 2D offset from its anchor (arrow.cp1Off / cp2Off); for arrows that
  // predate free handles we fall back to the old arm-along-anchor-direction value
  // so existing diagrams render unchanged. A shared bend offset (from the
  // midpoint handle) is added to both.
  _curveControlPoints(arrow, p1, p2, d1, d2, defaultArm) {
    const arm1 = arrow.curveArm1 != null ? arrow.curveArm1 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
    const arm2 = arrow.curveArm2 != null ? arrow.curveArm2 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
    const off1 = arrow.cp1Off ? arrow.cp1Off : { x: d1.dx * arm1, y: d1.dy * arm1 };
    const off2 = arrow.cp2Off ? arrow.cp2Off : { x: d2.dx * arm2, y: d2.dy * arm2 };
    const bx = arrow.curveBendX || 0, by = arrow.curveBendY || 0;
    return {
      off1, off2, bx, by,
      cp1x: p1.x + off1.x + bx, cp1y: p1.y + off1.y + by,
      cp2x: p2.x + off2.x + bx, cp2y: p2.y + off2.y + by,
    };
  }

  // Grow the SVG canvas to keep dragged arrow geometry visible. Updates the
  // viewBox AND the scaled width/height together — changing width/height alone
  // (as the drag code used to) rescales the whole viewBox, which made the tree
  // appear to shift during an arrow drag and snap back on release.
  _growCanvas(xs, ys) {
    const vb = (this.svg.getAttribute('viewBox') || '0 0 0 0').split(/\s+/).map(Number);
    const baseW = vb[2] || 0, baseH = vb[3] || 0;
    let w = baseW, h = baseH;
    for (const x of xs) if (x + 60 > w) w = x + 60;
    for (const y of ys) if (y + 60 > h) h = y + 60;
    if (w === baseW && h === baseH) return;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const sw = w * this.zoomLevel, sh = h * this.zoomLevel;
    this.svg.setAttribute('width', sw);
    this.svg.setAttribute('height', sh);
    this.svg.style.minWidth = sw + 'px';
    this.svg.style.minHeight = sh + 'px';
  }

  // Recompute the curve geometry from the arrow's current control points and
  // update all related DOM (path, hit area, arrowheads, handles, guides, canvas)
  // in place. Shared by the endpoint drag and the midpoint-bend drag.
  _applyCurveLive(arrowIdx, p1, p2, d1, d2, defaultArm) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    const { cp1x, cp1y, cp2x, cp2y } = this._curveControlPoints(arrow, p1, p2, d1, d2, defaultArm);

    const tx = 3 * (p2.x - cp2x), ty = 3 * (p2.y - cp2y);
    const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
    const ux = tx / tLen, uy = ty / tLen;
    const hasEnd = arrow.headEnd !== false;
    const hasStart = !!arrow.headStart;
    const endX = hasEnd ? p2.x - ux * 7 * 0.8 : p2.x;
    const endY = hasEnd ? p2.y - uy * 7 * 0.8 : p2.y;
    const stx2 = cp1x - p1.x, sty2 = cp1y - p1.y;
    const stLen2 = Math.sqrt(stx2 * stx2 + sty2 * sty2) || 1;
    const sux = -stx2 / stLen2, suy = -sty2 / stLen2;
    const startX = hasStart ? p1.x - sux * 7 * 0.8 : p1.x;
    const startY = hasStart ? p1.y - suy * 7 * 0.8 : p1.y;
    const newD = `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

    const arrowGroup = this.svg.querySelector(`.arrow-group[data-idx="${arrowIdx}"]`);
    const pathEl = arrowGroup ? arrowGroup.querySelector('.arrow-path') : null;
    const hitEl = arrowGroup ? arrowGroup.querySelector('path[stroke="transparent"]') : null;
    if (pathEl) pathEl.setAttribute('d', newD);
    if (hitEl) hitEl.setAttribute('d', newD);

    const headEnd = arrowGroup ? arrowGroup.querySelector('.arrow-head-end') : null;
    if (headEnd) {
      const px = -uy, py = ux, sz = 7;
      headEnd.setAttribute('points',
        `${p2.x},${p2.y} ${p2.x-ux*sz+px*sz*0.45},${p2.y-uy*sz+py*sz*0.45} ${p2.x-ux*sz-px*sz*0.45},${p2.y-uy*sz-py*sz*0.45}`);
    }
    const headStart = arrowGroup ? arrowGroup.querySelector('.arrow-head-start') : null;
    if (headStart) {
      const spx = -suy, spy = sux, sz = 7;
      headStart.setAttribute('points',
        `${p1.x},${p1.y} ${p1.x-sux*sz+spx*sz*0.45},${p1.y-suy*sz+spy*sz*0.45} ${p1.x-sux*sz-spx*sz*0.45},${p1.y-suy*sz-spy*sz*0.45}`);
    }

    const handle1 = this.svg.querySelector('.arrow-drag-handle[data-curve-which="1"]');
    const handle2 = this.svg.querySelector('.arrow-drag-handle[data-curve-which="2"]');
    if (handle1) { handle1.setAttribute('cx', cp1x); handle1.setAttribute('cy', cp1y); }
    if (handle2) { handle2.setAttribute('cx', cp2x); handle2.setAttribute('cy', cp2y); }
    const guide1 = this.svg.querySelector('.curve-guide[data-curve-which="1"]');
    const guide2 = this.svg.querySelector('.curve-guide[data-curve-which="2"]');
    if (guide1) { guide1.setAttribute('x2', cp1x); guide1.setAttribute('y2', cp1y); }
    if (guide2) { guide2.setAttribute('x2', cp2x); guide2.setAttribute('y2', cp2y); }

    // Midpoint bend handle position
    const bhx = 0.125 * p1.x + 0.375 * cp1x + 0.375 * cp2x + 0.125 * p2.x;
    const bhy = 0.125 * p1.y + 0.375 * cp1y + 0.375 * cp2y + 0.125 * p2.y;
    const bendHandle = this.svg.querySelector('.arrow-curve-bend-handle');
    if (bendHandle) { bendHandle.setAttribute('cx', bhx); bendHandle.setAttribute('cy', bhy); }

    // Expand canvas if needed (viewBox + scaled size together, no rescale)
    this._growCanvas([cp1x, cp2x, endX, bhx], [cp1y, cp2y, endY, bhy]);
  }

  _renderCurveBendHandle(cx, cy, arrowIdx, p1, p2, d1, d2, defaultArm) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 6);
    circle.setAttribute('class', 'arrow-drag-handle arrow-curve-bend-handle');
    circle.style.cursor = 'move';

    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startCurveBendDrag(arrowIdx, p1, p2, d1, d2, defaultArm);
    });

    this.svg.appendChild(circle);
  }

  _startCurveBendDrag(arrowIdx, p1, p2, d1, d2, defaultArm) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    this._draggingArrow = true;
    let saved = false;
    const svgPt = (e) => this.svgPoint(e);

    const onMove = (e) => {
      if (!saved) { this.saveState(); saved = true; }
      const pt = svgPt(e);
      // Midpoint with bend = 0 (depends only on the current control-point offsets)
      const { off1, off2 } = this._curveControlPoints(arrow, p1, p2, d1, d2, defaultArm);
      const c1x0 = p1.x + off1.x, c1y0 = p1.y + off1.y;
      const c2x0 = p2.x + off2.x, c2y0 = p2.y + off2.y;
      const baseX = 0.125 * p1.x + 0.375 * c1x0 + 0.375 * c2x0 + 0.125 * p2.x;
      const baseY = 0.125 * p1.y + 0.375 * c1y0 + 0.375 * c2y0 + 0.125 * p2.y;
      // Midpoint moves 0.75 * bend, so solve for the bend that puts it under the cursor
      arrow.curveBendX = (pt.x - baseX) / 0.75;
      arrow.curveBendY = (pt.y - baseY) / 0.75;
      this._applyCurveLive(arrowIdx, p1, p2, d1, d2, defaultArm);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.render();
      this.selectArrow(arrowIdx);
      setTimeout(() => { this._draggingArrow = false; }, 50);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _renderCurveHandle(cx, cy, arrowIdx, which, p1, p2, d1, d2) {
    // Draw a thin line from anchor to control point
    const anchor = which === 1 ? p1 : p2;
    const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    guide.setAttribute('x1', anchor.x);
    guide.setAttribute('y1', anchor.y);
    guide.setAttribute('x2', cx);
    guide.setAttribute('y2', cy);
    guide.setAttribute('stroke', '#7c3aed');
    guide.setAttribute('stroke-width', '1');
    guide.setAttribute('stroke-dasharray', '3 2');
    guide.setAttribute('pointer-events', 'none');
    guide.setAttribute('class', 'curve-guide');
    guide.dataset.curveWhich = which;
    this.svg.appendChild(guide);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 5);
    circle.setAttribute('class', 'arrow-drag-handle');
    circle.dataset.curveWhich = which;
    circle.style.cursor = 'move';

    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startCurveDrag(arrowIdx, which, p1, p2, d1, d2);
    });

    this.svg.appendChild(circle);
  }

  _startCurveDrag(arrowIdx, which, p1, p2, d1, d2) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    this._draggingArrow = true;
    let saved = false;

    const svgPt = (e) => this.svgPoint(e);
    const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    const defaultArm = Math.max(30, Math.min(80, dist * 0.4));

    // The anchor the dragged control point hangs off of
    const anchor = which === 1 ? p1 : p2;

    const onMove = (e) => {
      if (!saved) { this.saveState(); saved = true; }
      const pt = svgPt(e);

      // Free 2D control point: store its offset from the anchor (minus the shared
      // bend, so the bend handle stays independent). Keep a small minimum length
      // so the control point never collapses onto the anchor.
      const bx = arrow.curveBendX || 0, by = arrow.curveBendY || 0;
      let offX = pt.x - anchor.x - bx, offY = pt.y - anchor.y - by;
      const len = Math.sqrt(offX * offX + offY * offY);
      if (len < 5) {
        const dir = which === 1 ? d1 : d2;
        offX = dir.dx * 5; offY = dir.dy * 5;
      }
      const off = { x: offX, y: offY };
      if (which === 1) arrow.cp1Off = off;
      else arrow.cp2Off = off;

      this._applyCurveLive(arrowIdx, p1, p2, d1, d2, defaultArm);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.render();
      this.selectArrow(arrowIdx);
      setTimeout(() => { this._draggingArrow = false; }, 50);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _startElbowDrag(arrowIdx, axis, which) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    this._draggingArrow = true;
    let saved = false;

    const svgPt = (e) => this.svgPoint(e);

    // Find DOM elements for direct manipulation during drag
    const arrowGroup = this.svg.querySelector(`.arrow-group[data-idx="${arrowIdx}"]`);
    const pathEl = arrowGroup ? arrowGroup.querySelector('.arrow-path') : null;
    const hitEl = arrowGroup ? arrowGroup.querySelector('path[stroke="transparent"]') : null;
    const handle1 = this.svg.querySelector('.arrow-drag-handle[data-which="1"]');
    const handle2 = this.svg.querySelector('.arrow-drag-handle[data-which="2"]');
    const handle3 = this.svg.querySelector('.arrow-drag-handle[data-which="3"]');

    const onMove = (e) => {
      if (!saved) { this.saveState(); saved = true; }
      const pt = svgPt(e);

      // Update the correct mid-value
      if (which === 1) {
        arrow.elbowMidValue = axis === 'x' ? pt.x : pt.y;
      } else if (which === 2) {
        arrow.elbowMidValue2 = axis === 'x' ? pt.x : pt.y;
      } else if (which === 3) {
        arrow.elbowMidValue3 = axis === 'x' ? pt.x : pt.y;
      }

      // Rebuild path
      const nodeMap = {};
      const walk = (n) => { nodeMap[n.id] = n; n.children.forEach(walk); };
      if (this.root) walk(this.root);
      const from = nodeMap[arrow.fromId], to = nodeMap[arrow.toId];
      if (!from || !to) return;

      const p1 = getAnchorPos(from, arrow.fromAnchor, arrow.fromAnchorOffset);
      const p2 = getAnchorPos(to, arrow.toAnchor, arrow.toAnchorOffset);
      const d1 = getAnchorDir(arrow.fromAnchor);
      const d2 = getAnchorDir(arrow.toAnchor);
      const d1h = d1.dx !== 0;
      const d2h = d2.dx !== 0;
      const sameAxis = d1h === d2h;
      const gap = 25;
      const e1 = { x: p1.x + d1.dx * gap, y: p1.y + d1.dy * gap };
      const e2 = { x: p2.x + d2.dx * gap, y: p2.y + d2.dy * gap };
      const pts = [{ x: p1.x, y: p1.y }, { x: e1.x, y: e1.y }];

      let h1x, h1y, h2x, h2y, h3x, h3y;
      const ESNAP = ELBOW_SNAP;
      if (sameAxis && d1h) {
        // Both horizontal: 4 elbows, 3 handles
        const midY = arrow.elbowMidValue != null ? arrow.elbowMidValue : Math.max(e1.y, e2.y) + 30;
        let lx = arrow.elbowMidValue2 != null ? arrow.elbowMidValue2 : e1.x;
        let rx = arrow.elbowMidValue3 != null ? arrow.elbowMidValue3 : e2.x;
        if (Math.abs(lx - e1.x) < ESNAP) lx = e1.x;
        if (Math.abs(rx - e2.x) < ESNAP) rx = e2.x;
        pts.push({ x: lx, y: e1.y });
        pts.push({ x: lx, y: midY });
        pts.push({ x: rx, y: midY });
        pts.push({ x: rx, y: e2.y });
        h1x = (lx + rx) / 2; h1y = midY;
        h2x = lx; h2y = (e1.y + midY) / 2;
        h3x = rx; h3y = (midY + e2.y) / 2;
      } else if (sameAxis) {
        // Both vertical: 2 elbows, 1 handle
        const mv1 = arrow.elbowMidValue != null ? arrow.elbowMidValue : Math.max(e1.y, e2.y) + 20;
        pts.push({ x: e1.x, y: mv1 });
        pts.push({ x: e2.x, y: mv1 });
        h1x = (e1.x + e2.x) / 2; h1y = mv1;
      } else {
        let mv1 = arrow.elbowMidValue != null ? arrow.elbowMidValue : (d1h ? (e1.x + e2.x) / 2 : (e1.y + e2.y) / 2);
        let mv2 = arrow.elbowMidValue2 != null ? arrow.elbowMidValue2 : (d1h ? e2.y : e2.x);
        if (d1h) {
          if (Math.abs(mv1 - e1.x) < ESNAP) mv1 = e1.x;
          if (Math.abs(mv2 - e2.y) < ESNAP) mv2 = e2.y;
          pts.push({ x: mv1, y: e1.y });
          pts.push({ x: mv1, y: mv2 });
          pts.push({ x: e2.x, y: mv2 });
          h1x = mv1; h1y = (e1.y + mv2) / 2;
          h2x = (mv1 + e2.x) / 2; h2y = mv2;
        } else {
          if (Math.abs(mv1 - e1.y) < ESNAP) mv1 = e1.y;
          if (Math.abs(mv2 - e2.x) < ESNAP) mv2 = e2.x;
          pts.push({ x: e1.x, y: mv1 });
          pts.push({ x: mv2, y: mv1 });
          pts.push({ x: mv2, y: e2.y });
          h1x = (e1.x + mv2) / 2; h1y = mv1;
          h2x = mv2; h2y = (mv1 + e2.y) / 2;
        }
      }

      pts.push({ x: e2.x, y: e2.y });

      const ux = -d2.dx, uy = -d2.dy;
      const hasEnd = arrow.headEnd !== false;
      const hasStart = !!arrow.headStart;
      if (hasEnd) {
        pts.push({ x: p2.x - ux * 7 * 0.8, y: p2.y - uy * 7 * 0.8 });
      }
      if (hasStart) {
        pts[0] = { x: p1.x + d1.dx * 7 * 0.8, y: p1.y + d1.dy * 7 * 0.8 };
      }

      // Remove collinear middle points
      for (let i = pts.length - 3; i >= 0; i--) {
        const a = pts[i], b = pts[i + 1], c = pts[i + 2];
        const sameXa = Math.abs(a.x - b.x) < 1 && Math.abs(b.x - c.x) < 1;
        const sameYa = Math.abs(a.y - b.y) < 1 && Math.abs(b.y - c.y) < 1;
        if (sameXa || sameYa) pts.splice(i + 1, 1);
      }

      const newD = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
      if (pathEl) pathEl.setAttribute('d', newD);
      if (hitEl) hitEl.setAttribute('d', newD);

      // Update end arrowhead
      const headEnd = arrowGroup ? arrowGroup.querySelector('.arrow-head-end') : null;
      if (headEnd) {
        const px = -uy, py = ux, sz = 7;
        headEnd.setAttribute('points',
          `${p2.x},${p2.y} ${p2.x-ux*sz+px*sz*0.45},${p2.y-uy*sz+py*sz*0.45} ${p2.x-ux*sz-px*sz*0.45},${p2.y-uy*sz-py*sz*0.45}`);
      }
      // Update start arrowhead
      const headStartEl = arrowGroup ? arrowGroup.querySelector('.arrow-head-start') : null;
      if (headStartEl) {
        const sux = -d1.dx, suy = -d1.dy;
        const spx = -suy, spy = sux, sz = 7;
        headStartEl.setAttribute('points',
          `${p1.x},${p1.y} ${p1.x-sux*sz+spx*sz*0.45},${p1.y-suy*sz+spy*sz*0.45} ${p1.x-sux*sz-spx*sz*0.45},${p1.y-suy*sz-spy*sz*0.45}`);
      }

      // Move elbow handles
      if (handle1) {
        handle1.setAttribute('x', h1x - 4);
        handle1.setAttribute('y', h1y - 4);
      }
      if (handle2 && h2x != null) {
        handle2.setAttribute('x', h2x - 4);
        handle2.setAttribute('y', h2y - 4);
      }
      if (handle3 && h3x != null) {
        handle3.setAttribute('x', h3x - 4);
        handle3.setAttribute('y', h3y - 4);
      }

      // Expand canvas (viewBox + scaled size together, no rescale) and auto-scroll
      const dragX = which === 1 ? h1x : which === 2 ? h2x : h3x;
      const dragY = which === 1 ? h1y : which === 2 ? h2y : h3y;
      this._growCanvas(pts.map(p => p.x), pts.map(p => p.y));

      const wr = this.wrapper;
      const margin = 30;
      const viewRight = wr.scrollLeft + wr.clientWidth;
      const viewBottom = wr.scrollTop + wr.clientHeight;
      if (dragX > viewRight - margin) wr.scrollLeft = dragX - wr.clientWidth + margin;
      if (dragY > viewBottom - margin) wr.scrollTop = dragY - wr.clientHeight + margin;
      if (dragX < wr.scrollLeft + margin) wr.scrollLeft = dragX - margin;
      if (dragY < wr.scrollTop + margin) wr.scrollTop = dragY - margin;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      this.render();
      this.selectArrow(arrowIdx);
      setTimeout(() => { this._draggingArrow = false; }, 50);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _startAnchorDrag(arrowIdx, endpoint, nodeMap, mouseEvent) {
    const arrow = this.arrows[arrowIdx];
    if (!arrow) return;
    const slideMode = mouseEvent && (mouseEvent.metaKey || mouseEvent.ctrlKey);
    this._draggingArrow = true;
    this._dragStateSaved = false;

    const svgPt = (e) => this.svgPoint(e);

    if (slideMode) {
      // --- Slide anchor along its current edge ---
      const nodeId = endpoint === 'from' ? arrow.fromId : arrow.toId;
      const anchor = endpoint === 'from' ? arrow.fromAnchor : arrow.toAnchor;
      const node = nodeMap[nodeId];
      if (!node) return;

      // Visual feedback: highlight the edge being slid along
      const edgeLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      edgeLine.setAttribute('stroke', '#7c3aed');
      edgeLine.setAttribute('stroke-width', '2');
      edgeLine.setAttribute('stroke-dasharray', '3 2');
      const isHoriz = anchor === 'top' || anchor === 'bottom';
      if (isHoriz) {
        const ey = anchor === 'top' ? node.y : node.y + node.h;
        edgeLine.setAttribute('x1', node.x - node.w / 2);
        edgeLine.setAttribute('y1', ey);
        edgeLine.setAttribute('x2', node.x + node.w / 2);
        edgeLine.setAttribute('y2', ey);
      } else {
        const ex = anchor === 'left' ? node.x - node.w / 2 : node.x + node.w / 2;
        edgeLine.setAttribute('x1', ex);
        edgeLine.setAttribute('y1', node.y);
        edgeLine.setAttribute('x2', ex);
        edgeLine.setAttribute('y2', node.y + node.h);
      }
      this.svg.appendChild(edgeLine);

      // Sliding dot
      const currentOffset = (endpoint === 'from' ? arrow.fromAnchorOffset : arrow.toAnchorOffset) || 0;
      const curPos = getAnchorPos(node, anchor, currentOffset);
      const slideDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      slideDot.setAttribute('cx', curPos.x);
      slideDot.setAttribute('cy', curPos.y);
      slideDot.setAttribute('r', 5);
      slideDot.setAttribute('fill', '#7c3aed');
      slideDot.setAttribute('stroke', '#fff');
      slideDot.setAttribute('stroke-width', '1.5');
      this.svg.appendChild(slideDot);

      // Find the arrow group for live path updates
      const arrowGroup = this.svg.querySelector(`.arrow-group[data-idx="${arrowIdx}"]`);
      const pathEl = arrowGroup ? arrowGroup.querySelector('.arrow-path') : null;
      const hitEl = arrowGroup ? arrowGroup.querySelector('path[stroke="transparent"]') : null;
      const handleCircle = this.svg.querySelectorAll('.arrow-drag-handle');
      // The endpoint handle being dragged (from=first, to=second of the pair)
      const epHandle = endpoint === 'from' ? handleCircle[0] : handleCircle[1];

      const onMove = (e) => {
        if (!this._dragStateSaved) { this.saveState(); this._dragStateSaved = true; }
        const pt = svgPt(e);
        let offset;
        if (isHoriz) {
          offset = Math.max(-0.5, Math.min(0.5, (pt.x - node.x) / node.w));
        } else {
          offset = Math.max(-0.5, Math.min(0.5, (pt.y - (node.y + node.h / 2)) / node.h));
        }
        if (Math.abs(offset) < 0.05) offset = 0;

        if (endpoint === 'from') arrow.fromAnchorOffset = offset || undefined;
        else arrow.toAnchorOffset = offset || undefined;

        const newPos = getAnchorPos(node, anchor, offset);
        slideDot.setAttribute('cx', newPos.x);
        slideDot.setAttribute('cy', newPos.y);

        // Move the endpoint drag handle too
        if (epHandle) {
          epHandle.setAttribute('cx', newPos.x);
          epHandle.setAttribute('cy', newPos.y);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        edgeLine.remove();
        slideDot.remove();
        setTimeout(() => { this._draggingArrow = false; }, 50);
        this.render();
        this.selectArrow(arrowIdx);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return;
    }

    // --- Normal mode: re-attach anchor to a different node/edge ---
    let previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('stroke', '#7c3aed');
    previewLine.setAttribute('stroke-width', '1.5');
    previewLine.setAttribute('stroke-dasharray', '4 3');
    const startPos = endpoint === 'from'
      ? getAnchorPos(nodeMap[arrow.fromId], arrow.fromAnchor, arrow.fromAnchorOffset)
      : getAnchorPos(nodeMap[arrow.toId], arrow.toAnchor, arrow.toAnchorOffset);
    previewLine.setAttribute('x1', startPos.x);
    previewLine.setAttribute('y1', startPos.y);
    previewLine.setAttribute('x2', startPos.x);
    previewLine.setAttribute('y2', startPos.y);
    this.svg.appendChild(previewLine);

    let highlightDots = [];
    const showAnchors = (node) => {
      clearHighlights();
      for (const a of ['top', 'bottom', 'left', 'right']) {
        const p = getAnchorPos(node, a);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        dot.setAttribute('r', 5);
        dot.setAttribute('class', 'anchor-dot active');
        dot.style.opacity = '0.6';
        this.svg.appendChild(dot);
        highlightDots.push(dot);
      }
    };
    const clearHighlights = () => {
      highlightDots.forEach(d => d.remove());
      highlightDots = [];
    };

    const onMove = (e) => {
      const pt = svgPt(e);
      previewLine.setAttribute('x2', pt.x);
      previewLine.setAttribute('y2', pt.y);

      let closestNode = null, closestDist = Infinity;
      for (const id in nodeMap) {
        const n = nodeMap[id];
        const cx = n.x, cy = n.y + n.h / 2;
        const d = (pt.x - cx) ** 2 + (pt.y - cy) ** 2;
        if (d < closestDist && d < 3000) { closestDist = d; closestNode = n; }
      }
      if (closestNode) showAnchors(closestNode);
      else clearHighlights();
    };

    const onUp = (e) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      previewLine.remove();
      clearHighlights();

      const pt = svgPt(e);
      let bestNode = null, bestDist = Infinity;
      for (const id in nodeMap) {
        const n = nodeMap[id];
        for (const a of ['top', 'bottom', 'left', 'right']) {
          const p = getAnchorPos(n, a);
          const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
          if (d < bestDist) { bestDist = d; bestNode = { node: n, anchor: a }; }
        }
      }

      if (bestNode && bestDist < 2500) {
        const nodeId = bestNode.node.id;
        const currentNodeId = endpoint === 'from' ? arrow.fromId : arrow.toId;
        const currentAnchor = endpoint === 'from' ? arrow.fromAnchor : arrow.toAnchor;
        const otherEndId = endpoint === 'from' ? arrow.toId : arrow.fromId;
        const nodeChanged = nodeId !== currentNodeId;
        const anchorChanged = bestNode.anchor !== currentAnchor;

        if ((nodeChanged || anchorChanged) && (nodeId !== otherEndId || anchorChanged)) {
          if (!this._dragStateSaved) { this.saveState(); this._dragStateSaved = true; }
          if (endpoint === 'from') {
            arrow.fromId = nodeId;
            arrow.fromAnchor = bestNode.anchor;
            delete arrow.fromAnchorOffset;
          } else {
            arrow.toId = nodeId;
            arrow.toAnchor = bestNode.anchor;
            delete arrow.toAnchorOffset;
          }
          // Reset shape handles so path recomputes with correct defaults
          if (arrow.shape === 'elbow') {
            delete arrow.elbowMidValue;
            delete arrow.elbowMidValue2;
            delete arrow.elbowMidValue3;
          }
          delete arrow.curveArm;
          delete arrow.curveArm1;
          delete arrow.curveArm2;
          delete arrow.curveBendX;
          delete arrow.curveBendY;
          delete arrow.cp1Off;
          delete arrow.cp2Off;
        }
      }

      setTimeout(() => { this._draggingArrow = false; }, 50);
      this.render();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- Branch anchor dragging ---

  _renderBranchAnchorHandle(cx, cy, childNode, endpoint) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 6);
    circle.setAttribute('class', 'branch-drag-handle');
    circle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this._startBranchAnchorDrag(childNode, endpoint, e);
    });
    this.svg.appendChild(circle);
  }

  _startBranchAnchorDrag(childNode, endpoint, mouseEvent) {
    const svgPt = (e) => this.svgPoint(e);
    // The node whose edge we're changing
    const node = endpoint === 'parent' ? childNode.parent : childNode;
    const currentAnchor = endpoint === 'parent'
      ? (childNode.branchParentAnchor || 'bottom')
      : (childNode.branchChildAnchor || 'top');

    // Preview line from the fixed (other) endpoint to cursor
    const fixedEnd = endpoint === 'parent'
      ? getAnchorPos(childNode, childNode.branchChildAnchor || 'top')
      : getAnchorPos(childNode.parent, childNode.branchParentAnchor || 'bottom');

    const previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('stroke', '#7c3aed');
    previewLine.setAttribute('stroke-width', '1.5');
    previewLine.setAttribute('stroke-dasharray', '4 3');
    previewLine.setAttribute('x1', fixedEnd.x);
    previewLine.setAttribute('y1', fixedEnd.y);
    previewLine.setAttribute('x2', fixedEnd.x);
    previewLine.setAttribute('y2', fixedEnd.y);
    this.svg.appendChild(previewLine);

    // Show anchor dots on the target node
    let highlightDots = [];
    const showAnchors = () => {
      clearHighlights();
      for (const a of ['top', 'bottom', 'left', 'right']) {
        const p = getAnchorPos(node, a);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', p.x);
        dot.setAttribute('cy', p.y);
        dot.setAttribute('r', 5);
        dot.setAttribute('class', 'anchor-dot active');
        dot.style.opacity = '0.6';
        this.svg.appendChild(dot);
        highlightDots.push(dot);
      }
    };
    const clearHighlights = () => {
      highlightDots.forEach(d => d.remove());
      highlightDots = [];
    };

    showAnchors();

    const onMove = (e) => {
      const pt = svgPt(e);
      previewLine.setAttribute('x2', pt.x);
      previewLine.setAttribute('y2', pt.y);
    };

    const onUp = (e) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      previewLine.remove();
      clearHighlights();

      const pt = svgPt(e);
      // Find closest anchor on the target node
      let bestAnchor = currentAnchor, bestDist = Infinity;
      for (const a of ['top', 'bottom', 'left', 'right']) {
        const p = getAnchorPos(node, a);
        const d = (pt.x - p.x) ** 2 + (pt.y - p.y) ** 2;
        if (d < bestDist) { bestDist = d; bestAnchor = a; }
      }

      if (bestAnchor !== currentAnchor) {
        this.saveState();
        if (endpoint === 'parent') {
          childNode.branchParentAnchor = bestAnchor === 'bottom' ? null : bestAnchor;
        } else {
          childNode.branchChildAnchor = bestAnchor === 'top' ? null : bestAnchor;
        }
      }

      this.render();
      this.selectBranch(childNode.id);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // --- Tree operations ---

  addRootNode() {
    if (this.root) return;
    this.saveState();
    this.root = new TreeNode('S');
    this.select(this.root.id);
    this.render();
  }

  addChildToSelected() {
    const node = this.findNode(this.selectedId);
    if (!node) return;
    this.commitEdit();
    this.saveState();
    const child = new TreeNode('XP', node);
    node.children.push(child);
    this.select(child.id);
    this.render();
    this.startEditing(child.id);
  }

  addTriangleChild() {
    const node = this.findNode(this.selectedId);
    if (!node) return;
    this.commitEdit();
    this.saveState();
    const child = new TreeNode('word', node);
    child.triangle = true;
    node.children.push(child);
    this.select(child.id);
    this.render();
    this.startEditing(child.id);
  }

  deleteSelected() {
    const node = this.findNode(this.selectedId);
    if (!node) return;
    this.saveState();
    // Collect all IDs in the subtree being deleted
    const removedIds = new Set();
    const collectIds = (n) => { removedIds.add(n.id); n.children.forEach(collectIds); };
    collectIds(node);
    if (!node.parent) {
      this.root = null;
    } else {
      const idx = node.parent.children.indexOf(node);
      node.parent.children.splice(idx, 1);
    }
    // Remove arrows that reference any deleted node
    this.arrows = this.arrows.filter(a => !removedIds.has(a.fromId) && !removedIds.has(a.toId));
    this.selectedId = null;
    this.selectedArrowIdx = null;
    this.render();
  }

  copySubtree() {
    const node = this.findNode(this.selectedId);
    if (!node) return;
    this._clipboard = node.toJSON();
    const label = node.label.length > 20 ? node.label.slice(0, 20) + '...' : node.label;
    this.toast(`Copied subtree "${label}"`);
  }

  cutSubtree() {
    const node = this.findNode(this.selectedId);
    if (!node) return;
    this._clipboard = node.toJSON();
    const label = node.label.length > 20 ? node.label.slice(0, 20) + '...' : node.label;
    this.saveState();
    // Remove the subtree (same as deleteSelected)
    const removedIds = new Set();
    const collectIds = (n) => { removedIds.add(n.id); n.children.forEach(collectIds); };
    collectIds(node);
    if (!node.parent) {
      this.root = null;
    } else {
      const idx = node.parent.children.indexOf(node);
      node.parent.children.splice(idx, 1);
    }
    this.arrows = this.arrows.filter(a => !removedIds.has(a.fromId) && !removedIds.has(a.toId));
    this.selectedId = null;
    this.selectedArrowIdx = null;
    this.render();
    this.toast(`Cut subtree "${label}"`);
  }

  pasteSubtree() {
    if (!this._clipboard) { this.toast('Nothing to paste'); return; }
    this.commitEdit();
    this.saveState();
    // Paste as child of selected node, or as new root if nothing selected
    const parent = this.selectedId ? this.findNode(this.selectedId) : null;
    const pasted = TreeNode.fromJSON(this._clipboard, parent);
    // Assign fresh IDs to all pasted nodes to avoid duplicates
    const reassignIds = (n) => { n.id = genId(); n.children.forEach(reassignIds); };
    reassignIds(pasted);
    if (parent) {
      parent.children.push(pasted);
    } else if (!this.root) {
      this.root = pasted;
      pasted.parent = null;
    } else {
      // No node selected but tree exists — paste as child of root
      pasted.parent = this.root;
      this.root.children.push(pasted);
    }
    this.select(pasted.id);
    this.render();
    this.toast('Pasted subtree');
  }

  select(id) {
    this.selectedId = id;
    this.selectedIds.clear();
    if (id) this.selectedIds.add(id);
    this.selectedArrowIdx = null;
    this.selectedBranchId = null;
    this.selectedBranchIds.clear();
    this._nodeFormatTarget = null;
    document.getElementById('branch-format-bar').style.display = 'none';
    document.getElementById('node-fill-bar').style.display = id ? 'flex' : 'none';
    document.getElementById('node-border-bar').style.display = id ? 'flex' : 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    if (id && !this.editingNode) {
      this.showFormatBar();
      document.getElementById('color-swatches').style.display = 'none';
    } else if (!this.editingNode && this.editingArrowIdx == null) {
      this.hideFormatBar();
    }
    if (id) this._updateAlignButtons();
    this.hideContextMenu();
    this.updateToolbar();
    this.updateArrowFormatBar();
    this.svg.querySelectorAll('.node-group').forEach(g => {
      g.classList.toggle('selected', this.selectedIds.has(+g.dataset.id));
    });
    this.svg.querySelectorAll('.arrow-group').forEach(g => {
      g.classList.remove('selected');
    });
    this.svg.querySelectorAll('.branch-group').forEach(g => {
      g.classList.remove('selected');
    });
    this.svg.querySelectorAll('.arrow-drag-handle').forEach(el => el.remove());
    this.svg.querySelectorAll('.curve-guide').forEach(el => el.remove());
  }

  _reapplyMultiSelect() {
    const hasSelection = this.selectedIds.size > 0;
    if (hasSelection) {
      this.showFormatBar();
      document.getElementById('color-swatches').style.display = 'none';
    } else {
      this.hideFormatBar();
    }
    document.getElementById('node-fill-bar').style.display = hasSelection ? 'flex' : 'none';
    document.getElementById('node-border-bar').style.display = hasSelection ? 'flex' : 'none';
    document.getElementById('node-align-bar').style.display = 'none';
    this.svg.querySelectorAll('.node-group').forEach(g => {
      g.classList.toggle('selected', this.selectedIds.has(+g.dataset.id));
    });
  }

  _reapplyMultiBranchSelect() {
    const hasSelection = this.selectedBranchIds.size > 0;
    document.getElementById('branch-format-bar').style.display = hasSelection ? 'flex' : 'none';
    // Show triangle fill bar if any selected is a triangle
    let hasTriangle = false;
    this.selectedBranchIds.forEach(id => {
      const node = this.findNode(id);
      if (node && node.triangle) hasTriangle = true;
    });
    document.getElementById('node-fill-bar').style.display = hasTriangle ? 'flex' : 'none';
    this.svg.querySelectorAll('.branch-group').forEach(g => {
      g.classList.toggle('selected', this.selectedBranchIds.has(+g.dataset.childId));
    });
  }

  toggleSelect(id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    // Update selectedId to the last added, or null if empty
    if (this.selectedIds.size > 0) {
      this.selectedId = id;
    } else {
      this.selectedId = null;
    }
    this.selectedArrowIdx = null;
    this.selectedBranchId = null;
    this._nodeFormatTarget = null;
    document.getElementById('branch-format-bar').style.display = 'none';
    const hasSelection = this.selectedIds.size > 0;
    document.getElementById('node-fill-bar').style.display = hasSelection ? 'flex' : 'none';
    document.getElementById('node-border-bar').style.display = hasSelection ? 'flex' : 'none';
    document.getElementById('node-align-bar').style.display = hasSelection ? 'flex' : 'none';
    this.hideContextMenu();
    this.updateToolbar();
    this.updateArrowFormatBar();
    if (!this.editingNode && this.editingArrowIdx == null) this.hideFormatBar();
    this.svg.querySelectorAll('.node-group').forEach(g => {
      g.classList.toggle('selected', this.selectedIds.has(+g.dataset.id));
    });
    this.svg.querySelectorAll('.arrow-group').forEach(g => {
      g.classList.remove('selected');
    });
    this.svg.querySelectorAll('.branch-group').forEach(g => {
      g.classList.remove('selected');
    });
    this.svg.querySelectorAll('.arrow-drag-handle').forEach(el => el.remove());
    this.svg.querySelectorAll('.curve-guide').forEach(el => el.remove());
  }

  updateToolbar() {
    const hasRoot = !!this.root;
    const hasSelection = !!this.selectedId;
    document.getElementById('btn-add-root').disabled = hasRoot;
    document.getElementById('btn-add-child').disabled = !hasSelection;
    document.getElementById('btn-add-triangle').disabled = !hasSelection;
    document.getElementById('btn-delete').disabled = !hasSelection;
    document.getElementById('btn-undo').disabled = this.undoStack.length === 0;
    document.getElementById('btn-redo').disabled = this.redoStack.length === 0;
  }

  _renderDrag() {
    if (this._dragRafPending) return;
    this._dragRafPending = true;
    requestAnimationFrame(() => {
      this._dragRafPending = false;
      // Position-only frame: skip the bracket-notation rebuild.
      this.render({ skipBracketSync: true });
    });
  }

  // --- Zoom ---

  setZoom(level, e) {
    this._rawZoom = Math.max(0.2, Math.min(3, level));
    let newZoom = Math.round(this._rawZoom * 100) / 100;
    // Snap to 100% only if raw intent is within the snap zone
    // Once raw moves past the zone, snap releases immediately
    if (Math.abs(this._rawZoom - 1) < 0.03) {
      newZoom = 1;
    }
    if (newZoom === this.zoomLevel) return;

    // Zoom toward the cursor position (or center of wrapper)
    let anchorX, anchorY;
    if (e) {
      const wr = this.wrapper.getBoundingClientRect();
      anchorX = e.clientX - wr.left;
      anchorY = e.clientY - wr.top;
    } else {
      anchorX = this.wrapper.clientWidth / 2;
      anchorY = this.wrapper.clientHeight / 2;
    }

    // SVG coordinate under the anchor before zoom
    const svgX = (anchorX + this.wrapper.scrollLeft) / this.zoomLevel;
    const svgY = (anchorY + this.wrapper.scrollTop) / this.zoomLevel;

    this.zoomLevel = newZoom;
    if (this.root) this.render();

    // Adjust scroll so the same SVG point stays under the anchor
    this.wrapper.scrollLeft = svgX * newZoom - anchorX;
    this.wrapper.scrollTop = svgY * newZoom - anchorY;

    this._updateZoomDisplay();
  }

  zoomIn() { this.setZoom(this.zoomLevel + 0.1); }
  zoomOut() { this.setZoom(this.zoomLevel - 0.1); }
  zoomReset() { this.setZoom(1); }

  _updateZoomDisplay() {
    const el = document.getElementById('zoom-level');
    if (el) el.textContent = Math.round(this.zoomLevel * 100) + '%';
  }

  render(opts = {}) {
    // replaceChildren() clears the SVG via a direct DOM op (no HTML-parser
    // round-trip that innerHTML='' incurs).
    this.svg.replaceChildren();
    this.emptyState.style.display = this.root ? 'none' : 'block';

    if (!this.root) {
      this.nodeMap.clear();
      this.bracketInput.value = '';
      this._highlightBrackets();
      this.updateToolbar();
      return;
    }

    // Position-only frames (node drags) skip invisible/non-interactive elements:
    // anchor dots are opacity:0 unless hovered or in arrow mode, and branch /
    // triangle hit areas are transparent click targets — none are needed mid-drag.
    // The drag-end full render recreates them.
    const positionOnly = !!opts.skipBracketSync;

    layoutTree(this.root, this.alignBottom);

    const allNodes = [];
    this.nodeMap.clear();
    const nodeMap = this.nodeMap;
    function collect(n) { allNodes.push(n); nodeMap.set(n.id, n); n.children.forEach(collect); }
    collect(this.root);

    // Horizontal centering is based on the tree's NATURAL layout bounds, captured
    // BEFORE manual drag offsets are applied. This way dragging an individual node
    // moves only that node/subtree and never re-centers the rest of the tree.
    // Root drags still translate the whole tree, because applyOffsets() cascades
    // the root offset onto every node after these bounds are measured.
    let treeMinX = Infinity, treeMaxX = -Infinity;
    allNodes.forEach(n => {
      treeMinX = Math.min(treeMinX, n.x - n.w / 2);
      treeMaxX = Math.max(treeMaxX, n.x + n.w / 2);
    });
    const treeW = treeMaxX - treeMinX;

    applyOffsets(this.root);

    // Bracket notation is unaffected by pure position drags, so skip rebuilding
    // and re-highlighting the textarea on those frames.
    if (!opts.skipBracketSync && document.activeElement !== this.bracketInput) {
      this.bracketInput.value = this.root.toLabeledBrackets();
      this._highlightBrackets();
    }

    // Use unzoomed wrapper width so centering offset stays constant across zoom levels
    // (prevents elbow/arrow absolute coordinates from drifting)
    const wrapperW = this.wrapper.clientWidth;
    const centerShift = Math.max(40, (wrapperW - treeW) / 2) - treeMinX;
    allNodes.forEach(n => { n.x += centerShift; });

    const canvasPad = Math.max(60, getLevelGap());
    let maxX = 0, maxY = 0;
    allNodes.forEach(n => {
      maxX = Math.max(maxX, n.x + n.w / 2 + canvasPad);
      maxY = Math.max(maxY, n.y + n.h + canvasPad);
    });

    this.arrows.forEach(arrow => {
      const from = nodeMap.get(arrow.fromId);
      const to = nodeMap.get(arrow.toId);
      if (!from || !to) return;
      const fa = arrow.fromAnchor || 'bottom';
      const ta = arrow.toAnchor || 'bottom';
      const p1 = getAnchorPos(from, fa, arrow.fromAnchorOffset);
      const p2 = getAnchorPos(to, ta, arrow.toAnchorOffset);
      const d1 = getAnchorDir(fa);
      const d2 = getAnchorDir(ta);
      const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      const defaultArm = Math.max(30, Math.min(80, dist * 0.4));
      const { cp1x, cp1y, cp2x, cp2y } = this._curveControlPoints(arrow, p1, p2, d1, d2, defaultArm);
      maxX = Math.max(maxX, p1.x + 40, p2.x + 40, cp1x + 40, cp2x + 40);
      maxY = Math.max(maxY, p1.y + 40, p2.y + 40, cp1y + 40, cp2y + 40);

      if (arrow.elbowMidValue != null) {
        maxX = Math.max(maxX, arrow.elbowMidValue + 60);
        maxY = Math.max(maxY, arrow.elbowMidValue + 60);
      }
      if (arrow.elbowMidValue2 != null) {
        maxX = Math.max(maxX, arrow.elbowMidValue2 + 60);
        maxY = Math.max(maxY, arrow.elbowMidValue2 + 60);
      }
      if (arrow.elbowMidValue3 != null) {
        maxX = Math.max(maxX, arrow.elbowMidValue3 + 60);
        maxY = Math.max(maxY, arrow.elbowMidValue3 + 60);
      }
    });
    // Use viewBox for zoom: SVG coordinates stay unchanged, CSS size = scaled
    this.svg.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);
    const scaledW = maxX * this.zoomLevel;
    const scaledH = maxY * this.zoomLevel;
    this.svg.setAttribute('width', scaledW);
    this.svg.setAttribute('height', scaledH);
    this.svg.style.minWidth = scaledW + 'px';
    this.svg.style.minHeight = scaledH + 'px';

    // branch lines — draw combined fan paths for sharp vertices
    this._deferredTriangleGroups = [];
    allNodes.forEach(n => {
      if (n.children.length === 0) return;

      // Draw a combined fan path for non-triangle, same-color, same-parent-anchor branches
      const normalChildren = n.children.filter(c => !c.triangle);
      if (normalChildren.length >= 2) {
        // Group by color, parent anchor, AND style for combined paths
        const byKey = {};
        normalChildren.forEach(c => {
          const col = c.branchColor || '#333';
          const pAnchor = c.branchParentAnchor || 'bottom';
          const bStyle = c.branchStyle || 'solid';
          const key = col + '|' + pAnchor + '|' + bStyle;
          if (!byKey[key]) byKey[key] = { color: col, pAnchor, bStyle, kids: [] };
          byKey[key].kids.push(c);
        });
        Object.values(byKey).forEach(({ color, pAnchor, bStyle, kids }) => {
          if (kids.length < 2) return;
          const pp = getAnchorPos(n, pAnchor);
          // Sort children by their child-anchor x position
          const sorted = [...kids].sort((a, b) => {
            const pa = getAnchorPos(a, a.branchChildAnchor || 'top');
            const pb = getAnchorPos(b, b.branchChildAnchor || 'top');
            return pa.x - pb.x;
          });
          const cp0 = getAnchorPos(sorted[0], sorted[0].branchChildAnchor || 'top');
          const cp1 = getAnchorPos(sorted[1], sorted[1].branchChildAnchor || 'top');
          let d = `M ${cp0.x} ${cp0.y} L ${pp.x} ${pp.y} L ${cp1.x} ${cp1.y}`;
          for (let i = 2; i < sorted.length; i++) {
            const cpi = getAnchorPos(sorted[i], sorted[i].branchChildAnchor || 'top');
            d += ` M ${pp.x} ${pp.y} L ${cpi.x} ${cpi.y}`;
          }
          const fan = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          fan.setAttribute('d', d);
          fan.setAttribute('class', 'branch-fan');
          let fanStyle = '';
          if (color !== '#333') fanStyle += `stroke:${color};`;
          const da = branchDashArray(bStyle === 'solid' ? null : bStyle);
          if (da) fanStyle += `stroke-dasharray:${da};`;
          if (fanStyle) fan.setAttribute('style', fanStyle);
          fan.setAttribute('pointer-events', 'none');
          this.svg.appendChild(fan);
        });
      }

      // Per-child groups for click selection + individual rendering
      n.children.forEach(c => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `branch-group${this.selectedBranchIds.has(c.id) ? ' selected' : ''}`);
        g.dataset.childId = c.id;
        g.style.cursor = 'pointer';

        if (c.triangle) {
          const pp = getAnchorPos(n, c.branchParentAnchor || 'bottom');
          const triGap = c.borderColor ? 3 : 0;
          const naturalDy = c.y - pp.y;
          const maxTriH = getLevelGap() + 10; // reasonable max triangle height
          const triTop = naturalDy > maxTriH ? c.y - triGap - maxTriH : pp.y;

          // If triangle is capped, draw a stem line from parent to triangle top
          if (triTop > pp.y + 1) {
            const stem = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            stem.setAttribute('x1', pp.x); stem.setAttribute('y1', pp.y);
            stem.setAttribute('x2', c.x); stem.setAttribute('y2', triTop);
            stem.setAttribute('class', 'branch-line');
            if (c.branchColor) stem.style.stroke = c.branchColor;
            const stemDa = branchDashArray(c.branchStyle);
            if (stemDa) stem.style.strokeDasharray = stemDa;
            g.appendChild(stem);
          }

          const pts = `${triTop > pp.y + 1 ? c.x : pp.x},${triTop} ${c.x - c.w/2 + 4},${c.y - triGap} ${c.x + c.w/2 - 4},${c.y - triGap}`;
          if (!positionOnly) {
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hit.setAttribute('points', pts);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', String(TRIANGLE_HIT_WIDTH));
            hit.setAttribute('fill', 'transparent');
            hit.setAttribute('pointer-events', 'all');
            g.appendChild(hit);
          }
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          path.setAttribute('points', pts);
          path.setAttribute('class', 'triangle-line');
          if (c.triangleFillColor) { path.style.fill = c.triangleFillColor; path.dataset.fillColor = c.triangleFillColor; }
          else path.setAttribute('fill', 'none');
          if (c.branchColor) path.style.stroke = c.branchColor;
          const triDa = branchDashArray(c.branchStyle);
          if (triDa) path.style.strokeDasharray = triDa;
          g.appendChild(path);
        } else {
          const bp1 = getAnchorPos(n, c.branchParentAnchor || 'bottom');
          const bp2 = getAnchorPos(c, c.branchChildAnchor || 'top');
          // Hit area for clicking (skipped on position-only drag frames)
          if (!positionOnly) {
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            hit.setAttribute('x1', bp1.x); hit.setAttribute('y1', bp1.y);
            hit.setAttribute('x2', bp2.x); hit.setAttribute('y2', bp2.y);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', String(BRANCH_HIT_WIDTH));
            hit.setAttribute('pointer-events', 'stroke');
            g.appendChild(hit);
          }
          // Always render branch line in group (hidden when fan covers it, shown when selected)
          const pAnchor = c.branchParentAnchor || 'bottom';
          const siblings = normalChildren.filter(s =>
            (s.branchColor || '#333') === (c.branchColor || '#333') &&
            (s.branchParentAnchor || 'bottom') === pAnchor &&
            (s.branchStyle || 'solid') === (c.branchStyle || 'solid')
          );
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', bp1.x); line.setAttribute('y1', bp1.y);
          line.setAttribute('x2', bp2.x); line.setAttribute('y2', bp2.y);
          line.setAttribute('class', 'branch-line');
          if (c.branchColor) line.style.stroke = c.branchColor;
          const lineDa = branchDashArray(c.branchStyle);
          if (lineDa) line.style.strokeDasharray = lineDa;
          if (siblings.length >= 2) line.style.opacity = '0';
          g.appendChild(line);
        }

        g.addEventListener('click', (e) => {
          e.stopPropagation();
          if (e.metaKey || e.ctrlKey) {
            this.toggleSelectBranch(c.id);
          } else {
            this.selectBranch(c.id);
          }
        });

        if (c.triangle) {
          this._deferredTriangleGroups.push(g);
        } else {
          this.svg.appendChild(g);
        }
      });
    });

    // Triangle branches rendered before nodes so nodes stay on top
    if (this._deferredTriangleGroups) {
      this._deferredTriangleGroups.forEach(g => this.svg.appendChild(g));
      this._deferredTriangleGroups = null;
    }

    // nodes
    allNodes.forEach(n => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const isSource = this.arrowMode === 'pick-target' && n.id === this.arrowSource;
      g.setAttribute('class', `node-group${n.isLeaf ? ' leaf' : ''}${this.selectedIds.has(n.id) ? ' selected' : ''}${isSource ? ' arrow-source' : ''}`);
      g.dataset.id = n.id;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', n.x - n.w / 2);
      rect.setAttribute('y', n.y);
      rect.setAttribute('width', n.w);
      rect.setAttribute('height', n.h);
      rect.setAttribute('class', 'node-rect');
      if (n.borderColor) {
        rect.style.stroke = n.borderColor;
        rect.dataset.borderColor = n.borderColor;
      }
      if (n.fillColor) {
        rect.style.fill = n.fillColor;
        rect.dataset.fillColor = n.fillColor;
      }

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'node-label');
      createSvgRunSpans(text, n.runs, n.x, n.y + n.h / 2, n.h, n.align, n.w);

      g.appendChild(rect);
      g.appendChild(text);

      if (!positionOnly) {
        for (const a of ['top', 'bottom', 'left', 'right']) {
          const ap = getAnchorPos(n, a);
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', ap.x);
          dot.setAttribute('cy', ap.y);
          dot.setAttribute('r', 4);
          dot.setAttribute('class', 'anchor-dot');
          g.appendChild(dot);
        }
      }

      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // left button only
        if (this._spaceDown) return; // let pan handler take over
        e.stopPropagation();
        if (this.arrowMode) {
          this.handleArrowClick(n.id, e);
          return;
        }
        const startX = e.clientX, startY = e.clientY;
        // Capture the node's offsets at drag start; the live offset is always
        // base + (absolute cursor delta), so the node tracks the cursor exactly
        // with no movementX/Y accumulation drift.
        const baseOffsetX = n.offsetX, baseOffsetY = n.offsetY;
        let isDrag = false;
        let dragSaved = false;
        let constrainAxis = null; // null | 'x' | 'y'
        try { g.setPointerCapture(e.pointerId); } catch (_) {}

        const onMove = (ev) => {
          const dxCss = ev.clientX - startX, dyCss = ev.clientY - startY;
          if (!isDrag && (dxCss * dxCss + dyCss * dyCss) < 25) return; // 5px threshold
          if (!isDrag) {
            isDrag = true;
            this.select(n.id);
            this._draggingNodeId = n.id;
            // Lock axis on drag start if Shift is held
            if (ev.shiftKey) {
              constrainAxis = Math.abs(dxCss) >= Math.abs(dyCss) ? 'x' : 'y';
            }
          }
          if (!dragSaved) { this.saveState(); dragSaved = true; }
          // Shift pressed mid-drag: lock to dominant axis from origin
          if (ev.shiftKey && !constrainAxis) {
            constrainAxis = Math.abs(dxCss) >= Math.abs(dyCss) ? 'x' : 'y';
          } else if (!ev.shiftKey) {
            constrainAxis = null;
          }
          const dxSvg = (constrainAxis === 'y' ? 0 : dxCss) / this.zoomLevel;
          const dySvg = (constrainAxis === 'x' ? 0 : dyCss) / this.zoomLevel;
          n.offsetX = baseOffsetX + dxSvg;
          n.offsetY = baseOffsetY + dySvg;
          // Snap to horizontal/vertical branch alignment
          this._applyBranchSnap(n);
          this._renderDrag();
        };

        const onClick = (ev) => {
          // Prevent the synthetic click after drag
          if (isDrag) { ev.stopPropagation(); ev.preventDefault(); }
        };

        const onUp = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          try { g.releasePointerCapture(e.pointerId); } catch (_) {}
          this._draggingNodeId = null;
          if (isDrag) {
            // Block the click event that follows pointerup
            g.addEventListener('click', onClick, { once: true, capture: true });
            this.render();
            this._autoSave();
          } else {
            // It was a click, not a drag
            if (e.metaKey || e.ctrlKey) {
              this.selectedArrowIdx = null;
              this.updateArrowFormatBar();
              document.getElementById('btn-delete-arrow').style.display = 'none';
              this.toggleSelect(n.id);
            } else {
              this.selectArrow(null);
              this.select(n.id);
            }
          }
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });

      g.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.arrowMode) this.startEditing(n.id);
      });

      g.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.select(n.id);
        this.showContextMenu(e.clientX, e.clientY, n.id);
      });

      this.svg.appendChild(g);
    });


    this.renderArrows();

    // Show drag handles for selected branch anchor endpoints (on top of everything)
    if (this.selectedBranchIds.size === 1) {
      const childId = this.selectedBranchIds.values().next().value;
      const child = this.findNode(childId);
      if (child && child.parent) {
        const pp = getAnchorPos(child.parent, child.branchParentAnchor || 'bottom');
        this._renderBranchAnchorHandle(pp.x, pp.y, child, 'parent');
        if (!child.triangle) {
          const cp = getAnchorPos(child, child.branchChildAnchor || 'top');
          this._renderBranchAnchorHandle(cp.x, cp.y, child, 'child');
        }
      }
    }

    // Snap guides during node drag
    if (this._draggingNodeId) {
      this._drawSnapGuides(this._draggingNodeId);
    }

    this.updateToolbar();
    this.updateArrowFormatBar();
    this._autoSave();
  }

  _applyBranchSnap(node) {
    const SNAP = 8; // px threshold
    // Compute positions with current offsets
    layoutTree(this.root, this.alignBottom);
    applyOffsets(this.root);

    let snappedX = false, snappedY = false;

    // Collect all branch connections involving this node
    const pairs = [];
    if (node.parent) {
      const pp = getAnchorPos(node.parent, node.branchParentAnchor || 'bottom');
      const cp = getAnchorPos(node, node.branchChildAnchor || 'top');
      pairs.push({ dx: pp.x - cp.x, dy: pp.y - cp.y });
    }
    node.children.forEach(c => {
      const pp = getAnchorPos(node, c.branchParentAnchor || 'bottom');
      const cp = getAnchorPos(c, c.branchChildAnchor || 'top');
      pairs.push({ dx: cp.x - pp.x, dy: cp.y - pp.y });
    });

    // Apply the closest snap (first one within threshold) per axis
    for (const { dx, dy } of pairs) {
      if (!snappedX && Math.abs(dx) > 0 && Math.abs(dx) < SNAP) {
        node.offsetX += dx;
        snappedX = true;
      }
      if (!snappedY && Math.abs(dy) > 0 && Math.abs(dy) < SNAP) {
        node.offsetY += dy;
        snappedY = true;
      }
      if (snappedX && snappedY) break;
    }
  }

  _drawSnapGuides(nodeId) {
    const node = this.findNode(nodeId);
    if (!node) return;

    // Collect all branch connections involving this node
    const pairs = [];
    if (node.parent) {
      const pp = getAnchorPos(node.parent, node.branchParentAnchor || 'bottom');
      const cp = getAnchorPos(node, node.branchChildAnchor || 'top');
      pairs.push({ p1: pp, p2: cp });
    }
    node.children.forEach(c => {
      const pp = getAnchorPos(node, c.branchParentAnchor || 'bottom');
      const cp = getAnchorPos(c, c.branchChildAnchor || 'top');
      pairs.push({ p1: pp, p2: cp });
    });

    pairs.forEach(({ p1, p2 }) => {
      const dx = Math.abs(p1.x - p2.x);
      const dy = Math.abs(p1.y - p2.y);

      // Vertical alignment guide
      if (dx < 1) {
        const minY = Math.min(p1.y, p2.y) - 20;
        const maxY = Math.max(p1.y, p2.y) + 20;
        const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guide.setAttribute('x1', p1.x); guide.setAttribute('y1', minY);
        guide.setAttribute('x2', p1.x); guide.setAttribute('y2', maxY);
        guide.setAttribute('class', 'snap-guide');
        this.svg.appendChild(guide);
      }

      // Horizontal alignment guide
      if (dy < 1) {
        const minX = Math.min(p1.x, p2.x) - 20;
        const maxX = Math.max(p1.x, p2.x) + 20;
        const guide = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        guide.setAttribute('x1', minX); guide.setAttribute('y1', p1.y);
        guide.setAttribute('x2', maxX); guide.setAttribute('y2', p1.y);
        guide.setAttribute('class', 'snap-guide');
        this.svg.appendChild(guide);
      }
    });
  }

  showContextMenu(x, y, id) {
    const menu = document.getElementById('context-menu');
    menu.innerHTML = '';
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const node = this.findNode(id);
    const items = [
      { label: 'Edit Label', action: () => this.startEditing(id) },
      { label: 'Add Child', action: () => { this.selectedId = id; this.addChildToSelected(); } },
      { label: 'Add Triangle', action: () => { this.selectedId = id; this.addTriangleChild(); } },
      { label: 'Copy Subtree', action: () => { this.selectedId = id; this.copySubtree(); } },
      { label: 'Cut Subtree', action: () => { this.selectedId = id; this.cutSubtree(); } },
    ];
    if (this._clipboard) {
      items.push({ label: 'Paste Subtree', action: () => { this.selectedId = id; this.pasteSubtree(); } });
    }

    if (node && node.parent) {
      const siblings = node.parent.children;
      const idx = siblings.indexOf(node);
      if (idx > 0) {
        items.push({ label: 'Move Left', action: () => {
          this.saveState();
          siblings.splice(idx, 1);
          siblings.splice(idx - 1, 0, node);
          this.render();
        }});
      }
      if (idx < siblings.length - 1) {
        items.push({ label: 'Move Right', action: () => {
          this.saveState();
          siblings.splice(idx, 1);
          siblings.splice(idx + 1, 0, node);
          this.render();
        }});
      }
    }

    if (node && (node.offsetX || node.offsetY)) {
      items.push({ label: 'Reset Position', action: () => {
        this.saveState();
        node.offsetX = 0;
        node.offsetY = 0;
        this.render();
      }});
    }

    items.push({ label: 'Delete', action: () => { this.selectedId = id; this.deleteSelected(); } });

    items.forEach(item => {
      const btn = document.createElement('button');
      btn.textContent = item.label;
      btn.onclick = () => { this.hideContextMenu(); item.action(); };
      menu.appendChild(btn);
    });

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
  }

  hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
  }

  _initSidePanelResize() {
    const handle = document.getElementById('side-panel-resize');
    const panel = document.getElementById('side-panel');
    const toggle = document.getElementById('side-panel-toggle');
    let startX, startW;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = panel.offsetWidth;
      panel.classList.add('resizing');
      handle.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);

      const onMove = (ev) => {
        const newW = Math.max(150, Math.min(600, startW + ev.clientX - startX));
        panel.style.width = newW + 'px';
        panel.style.minWidth = newW + 'px';
        toggle.style.left = newW + 'px';
      };

      const onUp = () => {
        panel.classList.remove('resizing');
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  toggleSidePanel() {
    const panel = document.getElementById('side-panel');
    const btn = document.getElementById('side-panel-toggle');
    const arrow = btn.querySelector('.toggle-arrow');
    if (!panel.classList.contains('collapsed')) {
      this._sidePanelWidth = panel.offsetWidth;
    }
    panel.classList.toggle('collapsed');
    const collapsed = panel.classList.contains('collapsed');
    arrow.textContent = collapsed ? '▶' : '◀';
    if (!collapsed) {
      // Restore saved width when expanding
      const w = this._sidePanelWidth || 220;
      panel.style.width = w + 'px';
      panel.style.minWidth = w + 'px';
      btn.style.left = w + 'px';
    } else {
      btn.style.left = '0px';
    }
    // Re-render after transition so tree re-centers to new canvas width
    panel.addEventListener('transitionend', () => {
      if (this.root) this.render();
    }, { once: true });
  }

  toggleBracketHelp() {
    const el = document.getElementById('bracket-help');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  _highlightBrackets() {
    const text = this.bracketInput.value;
    const cursor = this.bracketInput.selectionStart ?? -1;
    const depthColors = 5; // number of depth color classes

    // Find all bracket positions and their depths
    const brackets = [];
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '[') {
        brackets.push({ pos: i, ch: '[', depth: depth });
        depth++;
      } else if (text[i] === ']') {
        depth--;
        brackets.push({ pos: i, ch: ']', depth: Math.max(0, depth) });
      }
    }

    // Build matching pairs
    const matchMap = {};
    const stack = [];
    for (const b of brackets) {
      if (b.ch === '[') {
        stack.push(b.pos);
      } else if (b.ch === ']') {
        if (stack.length > 0) {
          const openPos = stack.pop();
          matchMap[openPos] = b.pos;
          matchMap[b.pos] = openPos;
        } else {
          matchMap[b.pos] = -1; // unmatched
        }
      }
    }
    // Remaining unmatched opens
    for (const pos of stack) {
      matchMap[pos] = -1;
    }

    // Find which bracket the cursor is near
    let matchA = -1, matchB = -1;
    for (const b of brackets) {
      if (b.pos === cursor || b.pos === cursor - 1) {
        const partner = matchMap[b.pos];
        if (partner !== undefined && partner >= 0) {
          matchA = b.pos;
          matchB = partner;
        }
        break;
      }
    }

    // Build highlighted HTML
    const depthAt = {};
    const errSet = new Set();
    for (const b of brackets) {
      depthAt[b.pos] = b.depth;
      if (matchMap[b.pos] === -1) errSet.add(b.pos);
    }

    let html = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const escaped = ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
      if (ch === '[' || ch === ']') {
        const d = depthAt[i] !== undefined ? depthAt[i] : 0;
        let cls = 'br-d' + (d % depthColors);
        if (errSet.has(i)) cls = 'br-err';
        if (i === matchA || i === matchB) cls += ' br-match';
        html += `<span class="${cls}">${escaped}</span>`;
      } else {
        html += escaped;
      }
    }
    // Add trailing newline so backdrop height matches textarea
    html += '\n';

    this.bracketBackdrop.innerHTML = html;
    this.bracketBackdrop.scrollTop = this.bracketInput.scrollTop;
    this.bracketBackdrop.scrollLeft = this.bracketInput.scrollLeft;
  }

  parseBrackets() {
    let input = this.bracketInput.value.trim();
    if (!input) {
      // Use placeholder as default example
      input = this.bracketInput.placeholder;
      if (!input) return;
      this.bracketInput.value = input;
      this._highlightBrackets();
    }
    const tree = parseBracketNotation(input);
    if (tree) {
      this.saveState();
      this.root = tree;
      this.selectedId = null;
      this.render();
      this.toast('Tree parsed successfully');
    } else {
      this.toast('Invalid bracket notation');
    }
  }

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  }

  // --- Auto-save & Save/Load ---

  // Debounced: render() and many mutations call this, including on every drag
  // frame. Coalesce into a single trailing write so we never block on a
  // synchronous localStorage.setItem (full tree serialization) mid-drag.
  _autoSave() {
    if (this._autoSaveTimer) return;
    this._autoSaveTimer = setTimeout(() => {
      this._autoSaveTimer = null;
      this._autoSaveNow();
    }, 500);
  }

  _autoSaveNow() {
    if (this._autoSaveTimer) { clearTimeout(this._autoSaveTimer); this._autoSaveTimer = null; }
    try {
      const data = {
        tree: this.root ? this.root.toJSON() : null,
        arrows: this.arrows,
        nextId: getNextId(),
        alignBottom: this.alignBottom || false,
        fontFamily: getFontFamily(),
        fontSize: getFontSize(),
      };
      localStorage.setItem('merge-autosave', JSON.stringify(data));
    } catch (e) {}
  }

  _restoreAutoSave() {
    try {
      const raw = localStorage.getItem('merge-autosave');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.tree) {
        this.root = TreeNode.fromJSON(data.tree);
        this.arrows = data.arrows || [];
        if (data.nextId) setNextId(data.nextId);
        this._syncNextId();
        if (data.alignBottom) {
          this.alignBottom = true;
          this._updateAlignBottomBtn();
        }
        if (data.fontFamily) {
          setFontFamily(data.fontFamily);
          document.getElementById('font-family-select').value = data.fontFamily;
        }
        if (data.fontSize) {
          setFontSize(data.fontSize);
          document.getElementById('font-size-select').value = data.fontSize;
        }
        this._applyFontCSS();
      }
    } catch (e) {}
  }

  _getProjectData() {
    return {
      version: 1,
      tree: this.root ? this.root.toJSON() : null,
      arrows: this.arrows,
      nextId: getNextId(),
      alignBottom: this.alignBottom || false,
      fontFamily: getFontFamily(),
      fontSize: getFontSize(),
    };
  }

  _loadProjectData(data) {
    this.saveState();
    this.root = data.tree ? TreeNode.fromJSON(data.tree) : null;
    this.arrows = data.arrows || [];
    if (data.nextId) setNextId(data.nextId);
    this._syncNextId();
    this.alignBottom = data.alignBottom || false;
    this._updateAlignBottomBtn();
    if (data.fontFamily) {
      setFontFamily(data.fontFamily);
      document.getElementById('font-family-select').value = data.fontFamily;
    }
    if (data.fontSize) {
      setFontSize(data.fontSize);
      document.getElementById('font-size-select').value = data.fontSize;
    }
    this._applyFontCSS();
    this.selectedId = null;
    this.selectedArrowIdx = null;
    this.editingNode = null;
    this.render();
  }

  // --- Shareable links ---

  async shareLink() {
    if (!this.root) {
      this.toast('Nothing to share');
      return;
    }
    try {
      const data = this._getProjectData();
      const json = JSON.stringify(data);
      const compressed = await this._compress(json);
      const url = window.location.origin + window.location.pathname + '#tree=' + compressed;

      if (url.length > 32000) {
        this.toast('Tree too large to share via link — use Save instead');
        return;
      }

      await navigator.clipboard.writeText(url);
      // Update URL without reloading
      history.replaceState(null, '', '#tree=' + compressed);
      this.toast('Link copied to clipboard');
    } catch (e) {
      this.toast('Failed to generate link');
    }
  }

  async _restoreFromURL() {
    const hash = window.location.hash;
    if (!hash.startsWith('#tree=')) return false;
    try {
      const compressed = hash.slice(6);
      const json = await this._decompress(compressed);
      const data = JSON.parse(json);
      if (data.tree) {
        this.root = TreeNode.fromJSON(data.tree);
        this.arrows = data.arrows || [];
        if (data.nextId) setNextId(data.nextId);
        this._syncNextId();
        this.alignBottom = data.alignBottom || false;
        this._updateAlignBottomBtn();
        if (data.fontFamily) {
          setFontFamily(data.fontFamily);
          document.getElementById('font-family-select').value = data.fontFamily;
        }
        if (data.fontSize) {
          setFontSize(data.fontSize);
          document.getElementById('font-size-select').value = data.fontSize;
        }
        this._applyFontCSS();
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore from URL:', e);
    }
    return false;
  }

  async _compress(str) {
    const bytes = new TextEncoder().encode(str);
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // Base64url encoding (URL-safe, no padding)
    let b64 = btoa(String.fromCharCode(...merged));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async _decompress(b64url) {
    // Restore standard base64
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLen = chunks.reduce((a, c) => a + c.length, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(merged);
  }

  _syncNextId() {
    if (!this.root) return;
    let maxId = 0;
    const walk = (n) => { if (n.id > maxId) maxId = n.id; n.children.forEach(walk); };
    walk(this.root);
    if (getNextId() <= maxId) setNextId(maxId + 1);
  }

  saveJson() {
    const data = this._getProjectData();
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    saveAs(blob, 'derivation-tree.json');
    this.toast('Project saved');
  }

  loadJson() {
    document.getElementById('file-input').click();
  }

  _handleFileLoad(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.tree) throw new Error('Invalid file');
        this._loadProjectData(data);
        this.toast('Project loaded');
      } catch (err) {
        this.toast('Failed to load file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  exportPng() {
    if (!this.root) return;

    // Compute tight bounding box of all content
    const pad = 20;
    const allNodes = [];
    const nodeMap = {};
    function collect(n) { allNodes.push(n); nodeMap[n.id] = n; n.children.forEach(collect); }
    collect(this.root);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(n => {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.h);
    });

    // Include arrow paths in bounding box (both curve and elbow)
    this.svg.querySelectorAll('.arrow-path').forEach(pathEl => {
      try {
        const box = pathEl.getBBox();
        minX = Math.min(minX, box.x);
        maxX = Math.max(maxX, box.x + box.width);
        minY = Math.min(minY, box.y);
        maxY = Math.max(maxY, box.y + box.height);
      } catch(e) {}
    });

    const cropX = minX - pad, cropY = minY - pad;
    const cropW = maxX - minX + pad * 2, cropH = maxY - minY + pad * 2;

    const svgEl = this.svg.cloneNode(true);
    svgEl.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    svgEl.querySelectorAll('.arrow-source').forEach(el => el.classList.remove('arrow-source'));
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .label-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
    svgEl.querySelectorAll('path[stroke="transparent"], line[stroke="transparent"], polygon[stroke="transparent"]').forEach(el => el.remove());
    svgEl.querySelectorAll('.branch-line').forEach(el => { if (el.style.opacity === '0') el.remove(); });

    svgEl.setAttribute('viewBox', `${cropX} ${cropY} ${cropW} ${cropH}`);
    svgEl.setAttribute('width', cropW);
    svgEl.setAttribute('height', cropH);
    svgEl.style.minWidth = '';
    svgEl.style.minHeight = '';
    svgEl.style.width = cropW + 'px';
    svgEl.style.height = cropH + 'px';

    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      .node-rect { fill: none; stroke: none; }
      .node-label { font-family: ${getFontFamily()}; font-size: ${getFontSize()}px;
        fill: #333; text-anchor: middle; dominant-baseline: central;
        pointer-events: none; user-select: none; }
      .branch-line { stroke: #333; stroke-width: 1.2; stroke-linecap: round; }
      .branch-fan { stroke: #333; stroke-width: 1.2; fill: none; stroke-linejoin: miter; stroke-miterlimit: 10; stroke-linecap: round; }
      .triangle-line { stroke: #333; stroke-width: 1.2; fill: none; }
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.2; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.75)}px; fill: #333; text-anchor: middle; }
      .anchor-dot { display: none; }
    `;

    svgEl.insertBefore(styleEl, svgEl.firstChild);

    // Apply per-node border and fill colors
    svgEl.querySelectorAll('.node-rect[data-border-color]').forEach(rect => {
      rect.style.stroke = rect.dataset.borderColor;
      rect.style.strokeWidth = '1.5';
    });
    svgEl.querySelectorAll('.node-rect[data-fill-color]').forEach(rect => {
      rect.style.fill = rect.dataset.fillColor;
    });
    svgEl.querySelectorAll('.triangle-line[data-fill-color]').forEach(el => {
      el.style.fill = el.dataset.fillColor;
    });

    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const canvas = document.createElement('canvas');
    const scale = 16;
    canvas.width = cropW * scale;
    canvas.height = cropH * scale;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, cropW * scale, cropH * scale);
      URL.revokeObjectURL(url);
      canvas.toBlob(pngBlob => {
        saveAs(pngBlob, 'derivation-tree.png');
        this.toast('Exported to PNG');
      });
    };
    img.src = url;
  }

  exportSvg() {
    if (!this.root) return;

    const pad = 20;
    const allNodes = [];
    const nodeMap = {};
    function collect(n) { allNodes.push(n); nodeMap[n.id] = n; n.children.forEach(collect); }
    collect(this.root);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(n => {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.h);
    });

    // Include arrow paths in bounding box (both curve and elbow)
    this.svg.querySelectorAll('.arrow-path').forEach(pathEl => {
      try {
        const box = pathEl.getBBox();
        minX = Math.min(minX, box.x);
        maxX = Math.max(maxX, box.x + box.width);
        minY = Math.min(minY, box.y);
        maxY = Math.max(maxY, box.y + box.height);
      } catch(e) {}
    });

    const cropX = minX - pad, cropY = minY - pad;
    const cropW = maxX - minX + pad * 2, cropH = maxY - minY + pad * 2;

    const svgEl = this.svg.cloneNode(true);
    svgEl.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    svgEl.querySelectorAll('.arrow-source').forEach(el => el.classList.remove('arrow-source'));
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .label-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
    svgEl.querySelectorAll('path[stroke="transparent"], line[stroke="transparent"], polygon[stroke="transparent"]').forEach(el => el.remove());
    svgEl.querySelectorAll('.branch-line').forEach(el => { if (el.style.opacity === '0') el.remove(); });

    svgEl.setAttribute('viewBox', `${cropX} ${cropY} ${cropW} ${cropH}`);
    svgEl.setAttribute('width', cropW);
    svgEl.setAttribute('height', cropH);
    svgEl.style.minWidth = '';
    svgEl.style.minHeight = '';
    svgEl.style.width = '';
    svgEl.style.height = '';
    svgEl.removeAttribute('id');

    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      .node-rect { fill: none; stroke: none; }
      .node-label { font-family: ${getFontFamily()}; font-size: ${getFontSize()}px;
        fill: #333; text-anchor: middle; dominant-baseline: central; }
      .branch-line { stroke: #333; stroke-width: 1.2; stroke-linecap: round; }
      .branch-fan { stroke: #333; stroke-width: 1.2; fill: none; stroke-linejoin: miter; stroke-miterlimit: 10; stroke-linecap: round; }
      .triangle-line { stroke: #333; stroke-width: 1.2; fill: none; }
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.2; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.75)}px; fill: #333; text-anchor: middle; }
    `;

    // Reorder layers: rects (bottom) → fans → branches → labels → arrows (top)
    // 1. Collect original node groups before we start moving things
    const origNodeGroups = Array.from(svgEl.querySelectorAll('.node-group'));

    // 2. Create rect-only background groups (no .node-group class so they won't be re-matched)
    origNodeGroups.forEach(ng => {
      const rect = ng.querySelector('.node-rect');
      if (rect) {
        const rectWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rectWrapper.setAttribute('class', 'node-rect-bg');
        rectWrapper.appendChild(rect.cloneNode(true));
        svgEl.appendChild(rectWrapper);
      }
    });

    // 3. Move branch fans, branch groups
    svgEl.querySelectorAll('.branch-fan').forEach(el => svgEl.appendChild(el));
    svgEl.querySelectorAll('.branch-group').forEach(el => svgEl.appendChild(el));

    // 4. Move original node groups (without their rects) for labels
    origNodeGroups.forEach(ng => {
      const rect = ng.querySelector('.node-rect');
      if (rect) rect.remove();
      svgEl.appendChild(ng);
    });

    // 5. Move arrows on top
    svgEl.querySelectorAll('.arrow-group').forEach(el => svgEl.appendChild(el));

    svgEl.insertBefore(styleEl, svgEl.firstChild);

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', cropX);
    bg.setAttribute('y', cropY);
    bg.setAttribute('width', cropW);
    bg.setAttribute('height', cropH);
    bg.setAttribute('fill', '#fff');
    svgEl.insertBefore(bg, svgEl.firstChild);

    // Apply per-node border and fill colors
    svgEl.querySelectorAll('.node-rect[data-border-color]').forEach(rect => {
      rect.style.stroke = rect.dataset.borderColor;
      rect.style.strokeWidth = '1.5';
    });
    svgEl.querySelectorAll('.node-rect[data-fill-color]').forEach(rect => {
      rect.style.fill = rect.dataset.fillColor;
    });
    svgEl.querySelectorAll('.triangle-line[data-fill-color]').forEach(el => {
      el.style.fill = el.dataset.fillColor;
    });

    const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    saveAs(blob, 'derivation-tree.svg');
    this.toast('Exported to SVG');
  }

  exportPdf() {
    if (!this.root) return;

    const pad = 20;
    const allNodes = [];
    const nodeMap = {};
    function collect(n) { allNodes.push(n); nodeMap[n.id] = n; n.children.forEach(collect); }
    collect(this.root);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allNodes.forEach(n => {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.h);
    });

    this.svg.querySelectorAll('.arrow-path').forEach(pathEl => {
      try {
        const box = pathEl.getBBox();
        minX = Math.min(minX, box.x);
        maxX = Math.max(maxX, box.x + box.width);
        minY = Math.min(minY, box.y);
        maxY = Math.max(maxY, box.y + box.height);
      } catch(e) {}
    });

    const cropX = minX - pad, cropY = minY - pad;
    const cropW = maxX - minX + pad * 2, cropH = maxY - minY + pad * 2;

    // Build a clean standalone SVG (same as SVG export)
    const svgEl = this.svg.cloneNode(true);
    svgEl.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    svgEl.querySelectorAll('.arrow-source').forEach(el => el.classList.remove('arrow-source'));
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .label-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
    svgEl.querySelectorAll('path[stroke="transparent"], line[stroke="transparent"], polygon[stroke="transparent"]').forEach(el => el.remove());
    svgEl.querySelectorAll('.branch-line').forEach(el => { if (el.style.opacity === '0') el.remove(); });

    svgEl.setAttribute('viewBox', `${cropX} ${cropY} ${cropW} ${cropH}`);
    svgEl.removeAttribute('id');

    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      .node-rect { fill: none; stroke: none; }
      .node-label { font-family: ${getFontFamily()}; font-size: ${getFontSize()}px;
        fill: #333; text-anchor: middle; dominant-baseline: central; }
      .branch-line { stroke: #333; stroke-width: 1.2; stroke-linecap: round; }
      .branch-fan { stroke: #333; stroke-width: 1.2; fill: none; stroke-linejoin: miter; stroke-miterlimit: 10; stroke-linecap: round; }
      .triangle-line { stroke: #333; stroke-width: 1.2; fill: none; }
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.2; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.75)}px; fill: #333; text-anchor: middle; }
    `;

    // Reorder layers (same as SVG export)
    const origNodeGroups = Array.from(svgEl.querySelectorAll('.node-group'));
    origNodeGroups.forEach(ng => {
      const rect = ng.querySelector('.node-rect');
      if (rect) {
        const rectWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        rectWrapper.setAttribute('class', 'node-rect-bg');
        rectWrapper.appendChild(rect.cloneNode(true));
        svgEl.appendChild(rectWrapper);
      }
    });
    svgEl.querySelectorAll('.branch-fan').forEach(el => svgEl.appendChild(el));
    svgEl.querySelectorAll('.branch-group').forEach(el => svgEl.appendChild(el));
    origNodeGroups.forEach(ng => {
      const rect = ng.querySelector('.node-rect');
      if (rect) rect.remove();
      svgEl.appendChild(ng);
    });
    svgEl.querySelectorAll('.arrow-group').forEach(el => svgEl.appendChild(el));

    svgEl.insertBefore(styleEl, svgEl.firstChild);

    // Apply per-node border and fill colors
    svgEl.querySelectorAll('.node-rect[data-border-color]').forEach(rect => {
      rect.style.stroke = rect.dataset.borderColor;
      rect.style.strokeWidth = '1.5';
    });
    svgEl.querySelectorAll('.node-rect[data-fill-color]').forEach(rect => {
      rect.style.fill = rect.dataset.fillColor;
    });
    svgEl.querySelectorAll('.triangle-line[data-fill-color]').forEach(el => {
      el.style.fill = el.dataset.fillColor;
    });

    // Determine orientation and fit SVG to A4 printable area
    const landscape = cropW > cropH;
    // A4 printable area with 15mm margins, in mm
    const availWmm = landscape ? 267 : 180;
    const availHmm = landscape ? 180 : 267;
    // 1mm ≈ 3.7795px at 96dpi
    const mmToPx = 3.7795;
    const availWpx = availWmm * mmToPx;
    const availHpx = availHmm * mmToPx;
    // Scale to fit
    const fitRatio = Math.min(availWpx / cropW, availHpx / cropH);
    const svgWpx = Math.round(cropW * fitRatio);
    const svgHpx = Math.round(cropH * fitRatio);

    svgEl.setAttribute('width', svgWpx);
    svgEl.setAttribute('height', svgHpx);
    svgEl.style.width = svgWpx + 'px';
    svgEl.style.height = svgHpx + 'px';
    svgEl.style.minWidth = '';
    svgEl.style.minHeight = '';

    const svgStr = new XMLSerializer().serializeToString(svgEl);

    // Open a print window with the SVG centered on the page
    const printWin = window.open('', '_blank', 'width=800,height=600');
    if (!printWin) {
      this.toast('Please allow pop-ups to export PDF');
      return;
    }

    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>derivation-tree</title>
<style>
  @page {
    size: A4 ${landscape ? 'landscape' : 'portrait'};
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    padding: 15mm;
  }
  svg {
    display: block;
  }
  @media screen {
    body { background: #f5f5f5; padding: 20px; }
  }
</style>
</head>
<body>${svgStr}</body>
</html>`);
    printWin.document.close();

    // Wait for content to render, then trigger print
    printWin.onload = () => {
      printWin.focus();
      printWin.print();
    };
    // Fallback if onload already fired
    setTimeout(() => {
      printWin.focus();
      printWin.print();
    }, 500);
  }

}

const app = new App();
window.app = app;
if (/Mac|iPhone|iPad/.test(navigator.platform)) {
  document.querySelectorAll('.mod-key').forEach(k => k.textContent = '⌘');
}

export { App, app };
