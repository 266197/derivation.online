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
    this.svg = document.getElementById('tree-canvas');
    this.wrapper = document.getElementById('canvas-wrapper');
    this.emptyState = document.getElementById('empty-state');
    this.bracketInput = document.getElementById('bracket-input');

    this.sidePanel = document.getElementById('side-panel');
    this.buildColorSwatches();
    this.buildBranchColorSwatches();
    this.buildNodeFillSwatches();
    this.buildNodeBorderSwatches();
    this.buildArrowColorSwatches();

    // Auto-toggle side panel when any format bar becomes visible
    const observer = new MutationObserver(() => this._updateSidePanel());
    this.sidePanel.querySelectorAll('.format-bar').forEach(bar => {
      observer.observe(bar, { attributes: true, attributeFilter: ['style'] });
    });

    const deselectHandler = (e) => {
      if (this._draggingArrow) return;
      if (e.target.closest('.node-group') || e.target.closest('.arrow-group') || e.target.closest('.arrow-drag-handle') || e.target.closest('.branch-drag-handle') || e.target.closest('.branch-group')) return;
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
      if (e.key === 'Enter') this.parseBrackets();
    });

    document.getElementById('file-input').addEventListener('change', (e) => {
      this._handleFileLoad(e);
    });

    this._initFontSelectors();
    this._restoreAutoSave();
    this.render();
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
    this.wrapper.style.setProperty('--tree-font', getFontFamily());
    this.wrapper.style.setProperty('--tree-font-size', getFontSize() + 'px');
  }

  // Convert mouse event to SVG coordinates (accounts for scroll)
  svgPoint(e) {
    const wr = this.wrapper.getBoundingClientRect();
    return {
      x: e.clientX - wr.left + this.wrapper.scrollLeft,
      y: e.clientY - wr.top + this.wrapper.scrollTop
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
    document.getElementById('btn-delete-arrow').style.display = 'none';
    this.hideFormatBar();
    this.updateArrowFormatBar();
    this.updateToolbar();
    this.svg.querySelectorAll('.node-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.arrow-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.branch-group.selected').forEach(g => g.classList.remove('selected'));
    this.svg.querySelectorAll('.arrow-drag-handle').forEach(el => el.remove());
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
      } else {
        this._nodeFormatTarget = null;
        document.getElementById('node-fill-bar').style.display = 'none';
        document.getElementById('node-border-bar').style.display = 'none';
      }
    } else {
      this._nodeFormatTarget = null;
    }
    document.getElementById('branch-format-bar').style.display = childId !== null ? 'flex' : 'none';
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
      } else {
        this._nodeFormatTarget = null;
        document.getElementById('node-fill-bar').style.display = 'none';
        document.getElementById('node-border-bar').style.display = 'none';
      }
    } else {
      this.selectedBranchId = null;
      this._nodeFormatTarget = null;
      document.getElementById('node-fill-bar').style.display = 'none';
      document.getElementById('node-border-bar').style.display = 'none';
    }
    const hasSelection = this.selectedBranchIds.size > 0;
    document.getElementById('branch-format-bar').style.display = hasSelection ? 'flex' : 'none';
    this.render();
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
    this.arrows = state.arrows || [];
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
      const cb = document.getElementById('align-bottom-cb');
      if (cb) cb.checked = this.alignBottom;
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
      this.render();
    }
  }

  cancelArrowMode() {
    this.arrowMode = null;
    this.arrowSource = null;
    document.getElementById('arrow-banner').style.display = 'none';
    document.getElementById('btn-arrow').classList.remove('active');
    this.render();
  }

  toggleExportMenu() {
    const dd = document.getElementById('export-dropdown');
    const visible = dd.style.display !== 'none';
    dd.style.display = visible ? 'none' : 'block';
    if (!visible) {
      const close = (e) => {
        if (!e.target.closest('.export-wrapper')) {
          dd.style.display = 'none';
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }
  }

  closeExportMenu() {
    document.getElementById('export-dropdown').style.display = 'none';
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

  handleArrowClick(nodeId) {
    if (this.arrowMode === 'pick-source') {
      this.arrowSource = nodeId;
      this.arrowMode = 'pick-target';
      document.getElementById('arrow-step').textContent = 'Step 2: Click the target node';
      this.render();
    } else if (this.arrowMode === 'pick-target') {
      if (nodeId === this.arrowSource) {
        this.toast('Source and target must be different');
        return;
      }
      this.saveState();
      this.arrows.push({ fromId: this.arrowSource, toId: nodeId, labelRuns: [], fromAnchor: 'bottom', toAnchor: 'bottom' });
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

    const svgRect = this.svg.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const div = document.createElement('div');
    div.className = 'inline-edit';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.innerHTML = runsToHTML(node.runs);

    div.style.left = (svgRect.left - wrapperRect.left + this.wrapper.scrollLeft + (node.x - node.w / 2 - 6)) + 'px';
    div.style.top = (svgRect.top - wrapperRect.top + this.wrapper.scrollTop + (node.y - 3)) + 'px';
    div.style.minWidth = Math.max((node.w + 24), 60) + 'px';
    div.style.minHeight = (node.h + 6) + 'px';
    div.style.fontSize = getFontSize() + 'px';

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
    this.render();
  }

  cancelEdit() {
    const div = document.querySelector('.inline-edit');
    if (div) div.remove();
    this.editingNode = null;
    this.editingArrowIdx = null;
    this.hideFormatBar();
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

    const svgRect = this.svg.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    const div = document.createElement('div');
    div.className = 'inline-edit';
    div.contentEditable = 'true';
    div.spellcheck = false;
    div.style.fontSize = '11px';
    div.style.textAlign = 'center';

    const runs = getArrowLabelRuns(arrow);
    div.innerHTML = runs.length > 0 ? runsToHTML(runs) : '';

    div.style.left = (svgRect.left - wrapperRect.left + this.wrapper.scrollLeft + (labelX - 40)) + 'px';
    div.style.top = (svgRect.top - wrapperRect.top + this.wrapper.scrollTop + (labelY - 8)) + 'px';
    div.style.minWidth = '80px';
    div.style.minHeight = '18px';

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
    this.render();
  }

  // --- Format commands ---

  execFmt(command) {
    const div = document.querySelector('.inline-edit');
    if (!div) {
      if (this.selectedId) {
        this.startEditing(this.selectedId);
        setTimeout(() => this.execFmt(command), 10);
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
  }

  hideFormatBar() {
    document.getElementById('format-bar').style.display = 'none';
  }

  toggleAlignBottom(on) {
    if (this.root) this.saveState();
    this.alignBottom = on;
    if (this.root) this.render();
  }

  _updateSidePanel() {
    const hasVisible = Array.from(this.sidePanel.querySelectorAll('.format-bar'))
      .some(bar => bar.style.display !== 'none');
    this.sidePanel.classList.toggle('open', hasVisible);
  }

  // --- Arrows rendering ---

  renderArrows() {
    if (!this.root) return;
    this._pendingElbowHandles = null;
    this._pendingCurveHandles = null;

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
      let pathD, ux, uy, tipX, tipY, labelX, labelY;

      if (shape === 'straight') {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        ux = dx / len; uy = dy / len;
        tipX = p2.x; tipY = p2.y;
        const endX = tipX - ux * arrowSize * 0.8;
        const endY = tipY - uy * arrowSize * 0.8;
        pathD = `M ${p1.x} ${p1.y} L ${endX} ${endY}`;
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
        tipX = p2.x; tipY = p2.y;
        const endX = tipX - ux * arrowSize * 0.8;
        const endY = tipY - uy * arrowSize * 0.8;
        pts.push({ x: endX, y: endY });

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
        // Asymmetric arms: each end has its own control point distance
        const arm1 = arrow.curveArm1 != null ? arrow.curveArm1 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
        const arm2 = arrow.curveArm2 != null ? arrow.curveArm2 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
        const cp1x = p1.x + d1.dx * arm1;
        const cp1y = p1.y + d1.dy * arm1;
        const cp2x = p2.x + d2.dx * arm2;
        const cp2y = p2.y + d2.dy * arm2;
        const tx = 3 * (p2.x - cp2x);
        const ty = 3 * (p2.y - cp2y);
        const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
        ux = tx / tLen; uy = ty / tLen;
        tipX = p2.x; tipY = p2.y;
        const endX = tipX - ux * arrowSize * 0.8;
        const endY = tipY - uy * arrowSize * 0.8;
        pathD = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

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

      const px = -uy, py = ux;
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      head.setAttribute('points',
        `${tipX},${tipY} ${tipX-ux*arrowSize+px*arrowSize*0.45},${tipY-uy*arrowSize+py*arrowSize*0.45} ${tipX-ux*arrowSize-px*arrowSize*0.45},${tipY-uy*arrowSize-py*arrowSize*0.45}`);
      head.setAttribute('class', 'arrow-head');
      head.setAttribute('style', `fill:${arrowColor};`);
      g.appendChild(head);

      const arrowRuns = getArrowLabelRuns(arrow);
      if (arrowRuns.length > 0) {
        const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lbl.setAttribute('x', labelX);
        lbl.setAttribute('y', labelY);
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
        e.stopPropagation();
        this.startEditingArrow(idx, labelX, labelY);
      });

      this.svg.appendChild(g);

      if (idx === this.selectedArrowIdx) {
        this._renderDragHandle(p1.x, p1.y, idx, 'from', nodeMap);
        this._renderDragHandle(tipX, tipY, idx, 'to', nodeMap);
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

    const arrowGroup = this.svg.querySelector(`.arrow-group[data-idx="${arrowIdx}"]`);
    const pathEl = arrowGroup ? arrowGroup.querySelector('.arrow-path') : null;
    const hitEl = arrowGroup ? arrowGroup.querySelector('path[stroke="transparent"]') : null;
    const handle1 = this.svg.querySelector('.arrow-drag-handle[data-curve-which="1"]');
    const handle2 = this.svg.querySelector('.arrow-drag-handle[data-curve-which="2"]');

    // The anchor point and direction for the handle being dragged
    const anchor = which === 1 ? p1 : p2;
    const dir = which === 1 ? d1 : d2;

    const onMove = (e) => {
      if (!saved) { this.saveState(); saved = true; }
      const pt = svgPt(e);

      // Project mouse position onto the anchor's direction to get arm length
      const offX = pt.x - anchor.x, offY = pt.y - anchor.y;
      let arm = offX * dir.dx + offY * dir.dy;
      if (Math.abs(arm) < 5) arm = arm < 0 ? -5 : 5;

      // Store independently
      if (which === 1) {
        arrow.curveArm1 = arm;
      } else {
        arrow.curveArm2 = arm;
      }

      // Recompute full curve with both arms
      const a1 = arrow.curveArm1 != null ? arrow.curveArm1 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
      const a2 = arrow.curveArm2 != null ? arrow.curveArm2 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
      const cp1x = p1.x + d1.dx * a1;
      const cp1y = p1.y + d1.dy * a1;
      const cp2x = p2.x + d2.dx * a2;
      const cp2y = p2.y + d2.dy * a2;
      const tx = 3 * (p2.x - cp2x);
      const ty = 3 * (p2.y - cp2y);
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      const ux = tx / tLen, uy = ty / tLen;
      const endX = p2.x - ux * 7 * 0.8;
      const endY = p2.y - uy * 7 * 0.8;
      const newD = `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;

      if (pathEl) pathEl.setAttribute('d', newD);
      if (hitEl) hitEl.setAttribute('d', newD);

      // Update arrowhead
      const head = arrowGroup ? arrowGroup.querySelector('.arrow-head') : null;
      if (head) {
        const px = -uy, py = ux, sz = 7;
        head.setAttribute('points',
          `${p2.x},${p2.y} ${p2.x-ux*sz+px*sz*0.45},${p2.y-uy*sz+py*sz*0.45} ${p2.x-ux*sz-px*sz*0.45},${p2.y-uy*sz-py*sz*0.45}`);
      }

      // Move both control point handles and guide lines
      if (handle1) { handle1.setAttribute('cx', cp1x); handle1.setAttribute('cy', cp1y); }
      if (handle2) { handle2.setAttribute('cx', cp2x); handle2.setAttribute('cy', cp2y); }
      const guide1 = this.svg.querySelector('.curve-guide[data-curve-which="1"]');
      const guide2 = this.svg.querySelector('.curve-guide[data-curve-which="2"]');
      if (guide1) { guide1.setAttribute('x2', cp1x); guide1.setAttribute('y2', cp1y); }
      if (guide2) { guide2.setAttribute('x2', cp2x); guide2.setAttribute('y2', cp2y); }

      // Expand canvas
      let needW = +this.svg.getAttribute('width');
      let needH = +this.svg.getAttribute('height');
      for (const v of [cp1x, cp2x, endX]) if (v + 60 > needW) needW = v + 60;
      for (const v of [cp1y, cp2y, endY]) if (v + 60 > needH) needH = v + 60;
      this.svg.setAttribute('width', needW);
      this.svg.setAttribute('height', needH);
      this.svg.style.minWidth = needW + 'px';
      this.svg.style.minHeight = needH + 'px';
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
      pts.push({ x: p2.x - ux * 7 * 0.8, y: p2.y - uy * 7 * 0.8 });

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

      // Update arrowhead
      const head = arrowGroup ? arrowGroup.querySelector('.arrow-head') : null;
      if (head) {
        const px = -uy, py = ux, sz = 7;
        head.setAttribute('points',
          `${p2.x},${p2.y} ${p2.x-ux*sz+px*sz*0.45},${p2.y-uy*sz+py*sz*0.45} ${p2.x-ux*sz-px*sz*0.45},${p2.y-uy*sz-py*sz*0.45}`);
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

      // Expand canvas and auto-scroll
      const dragX = which === 1 ? h1x : which === 2 ? h2x : h3x;
      const dragY = which === 1 ? h1y : which === 2 ? h2y : h3y;
      let needW = +this.svg.getAttribute('width');
      let needH = +this.svg.getAttribute('height');
      for (const p of pts) {
        if (p.x + 60 > needW) needW = p.x + 60;
        if (p.y + 60 > needH) needH = p.y + 60;
      }
      this.svg.setAttribute('width', needW);
      this.svg.setAttribute('height', needH);
      this.svg.style.minWidth = needW + 'px';
      this.svg.style.minHeight = needH + 'px';

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
          // Reset elbow handles when anchor changes so path recomputes with correct defaults
          if (anchorChanged && arrow.shape === 'elbow') {
            delete arrow.elbowMidValue;
            delete arrow.elbowMidValue2;
            delete arrow.elbowMidValue3;
          }
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

  _reapplyMultiSelect() {
    const hasSelection = this.selectedIds.size > 0;
    document.getElementById('node-fill-bar').style.display = hasSelection ? 'flex' : 'none';
    document.getElementById('node-border-bar').style.display = hasSelection ? 'flex' : 'none';
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
      this.render();
    });
  }

  render() {
    this.svg.innerHTML = '';
    this.emptyState.style.display = this.root ? 'none' : 'block';

    if (!this.root) {
      this.nodeMap.clear();
      this.bracketInput.value = '';
      this.updateToolbar();
      return;
    }

    layoutTree(this.root, this.alignBottom);
    applyOffsets(this.root);
    if (document.activeElement !== this.bracketInput) {
      this.bracketInput.value = this.root.toLabeledBrackets();
    }

    const allNodes = [];
    this.nodeMap.clear();
    const nodeMap = this.nodeMap;
    function collect(n) { allNodes.push(n); nodeMap.set(n.id, n); n.children.forEach(collect); }
    collect(this.root);

    // Center tree horizontally in the wrapper
    let treeMinX = Infinity, treeMaxX = -Infinity;
    allNodes.forEach(n => {
      treeMinX = Math.min(treeMinX, n.x - n.w / 2);
      treeMaxX = Math.max(treeMaxX, n.x + n.w / 2);
    });
    const treeW = treeMaxX - treeMinX;
    const wrapperW = this.wrapper.clientWidth;
    if (treeW + 80 < wrapperW) {
      const offsetX = (wrapperW - treeW) / 2 - treeMinX;
      allNodes.forEach(n => { n.x += offsetX; });
    }

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
      const arm1 = arrow.curveArm1 != null ? arrow.curveArm1 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
      const arm2 = arrow.curveArm2 != null ? arrow.curveArm2 : (arrow.curveArm != null ? arrow.curveArm : defaultArm);
      const cp1x = p1.x + d1.dx * arm1;
      const cp1y = p1.y + d1.dy * arm1;
      const cp2x = p2.x + d2.dx * arm2;
      const cp2y = p2.y + d2.dy * arm2;
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
    this.svg.setAttribute('width', maxX);
    this.svg.setAttribute('height', maxY);
    this.svg.style.minWidth = maxX + 'px';
    this.svg.style.minHeight = maxY + 'px';

    // branch lines — draw combined fan paths for sharp vertices
    this._deferredTriangleGroups = [];
    allNodes.forEach(n => {
      if (n.children.length === 0) return;

      // Draw a combined fan path for non-triangle, same-color, same-parent-anchor branches
      const normalChildren = n.children.filter(c => !c.triangle);
      if (normalChildren.length >= 2) {
        // Group by color AND parent anchor for combined paths
        const byKey = {};
        normalChildren.forEach(c => {
          const col = c.branchColor || '#333';
          const pAnchor = c.branchParentAnchor || 'bottom';
          const key = col + '|' + pAnchor;
          if (!byKey[key]) byKey[key] = { color: col, pAnchor, kids: [] };
          byKey[key].kids.push(c);
        });
        Object.values(byKey).forEach(({ color, pAnchor, kids }) => {
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
          if (color !== '#333') fan.setAttribute('style', `stroke:${color};`);
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
            g.appendChild(stem);
          }

          const pts = `${triTop > pp.y + 1 ? c.x : pp.x},${triTop} ${c.x - c.w/2 + 4},${c.y - triGap} ${c.x + c.w/2 - 4},${c.y - triGap}`;
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          hit.setAttribute('points', pts);
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', String(TRIANGLE_HIT_WIDTH));
          hit.setAttribute('fill', 'transparent');
          hit.setAttribute('pointer-events', 'all');
          g.appendChild(hit);
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          path.setAttribute('points', pts);
          path.setAttribute('class', 'triangle-line');
          if (c.triangleFillColor) { path.style.fill = c.triangleFillColor; path.dataset.fillColor = c.triangleFillColor; }
          else path.setAttribute('fill', 'none');
          if (c.branchColor) path.style.stroke = c.branchColor;
          g.appendChild(path);
        } else {
          const bp1 = getAnchorPos(n, c.branchParentAnchor || 'bottom');
          const bp2 = getAnchorPos(c, c.branchChildAnchor || 'top');
          // Hit area for clicking
          const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          hit.setAttribute('x1', bp1.x); hit.setAttribute('y1', bp1.y);
          hit.setAttribute('x2', bp2.x); hit.setAttribute('y2', bp2.y);
          hit.setAttribute('stroke', 'transparent');
          hit.setAttribute('stroke-width', String(BRANCH_HIT_WIDTH));
          hit.setAttribute('pointer-events', 'stroke');
          g.appendChild(hit);
          // Always render branch line in group (hidden when fan covers it, shown when selected)
          const pAnchor = c.branchParentAnchor || 'bottom';
          const siblings = normalChildren.filter(s =>
            (s.branchColor || '#333') === (c.branchColor || '#333') &&
            (s.branchParentAnchor || 'bottom') === pAnchor
          );
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', bp1.x); line.setAttribute('y1', bp1.y);
          line.setAttribute('x2', bp2.x); line.setAttribute('y2', bp2.y);
          line.setAttribute('class', 'branch-line');
          if (c.branchColor) line.style.stroke = c.branchColor;
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
      createSvgRunSpans(text, n.runs, n.x, n.y + n.h / 2, n.h);

      g.appendChild(rect);
      g.appendChild(text);

      for (const a of ['top', 'bottom', 'left', 'right']) {
        const ap = getAnchorPos(n, a);
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', ap.x);
        dot.setAttribute('cy', ap.y);
        dot.setAttribute('r', 4);
        dot.setAttribute('class', 'anchor-dot');
        g.appendChild(dot);
      }

      g.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // left button only
        e.stopPropagation();
        if (this.arrowMode) {
          this.handleArrowClick(n.id);
          return;
        }
        const startX = e.clientX, startY = e.clientY;
        let isDrag = false;
        let dragSaved = false;
        let constrainAxis = null; // null | 'x' | 'y'
        // Raw offsets track true cursor position; snap adjusts what's rendered
        let rawOffsetX = n.offsetX, rawOffsetY = n.offsetY;

        const onMove = (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (!isDrag && (dx * dx + dy * dy) < 25) return; // 5px threshold
          if (!isDrag) {
            isDrag = true;
            this.select(n.id);
            this._draggingNodeId = n.id;
            // Lock axis on drag start if Shift is held
            if (ev.shiftKey) {
              constrainAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
            }
          }
          if (!dragSaved) { this.saveState(); dragSaved = true; }
          // Shift pressed mid-drag: lock to dominant axis from origin
          if (ev.shiftKey && !constrainAxis) {
            constrainAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          } else if (!ev.shiftKey) {
            constrainAxis = null;
          }
          const mx = constrainAxis === 'y' ? 0 : ev.movementX;
          const my = constrainAxis === 'x' ? 0 : ev.movementY;
          rawOffsetX += mx;
          rawOffsetY += my;
          n.offsetX = rawOffsetX;
          n.offsetY = rawOffsetY;
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

  parseBrackets() {
    const input = this.bracketInput.value.trim();
    if (!input) return;
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

  _autoSave() {
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
          document.getElementById('align-bottom-cb').checked = true;
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
    document.getElementById('align-bottom-cb').checked = this.alignBottom;
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
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
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
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.5; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.92)}px; fill: #333; text-anchor: middle; }
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
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
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
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.5; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.92)}px; fill: #333; text-anchor: middle; }
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
    svgEl.querySelectorAll('.anchor-dot, .arrow-drag-handle, .branch-drag-handle, .curve-guide, .snap-guide').forEach(el => el.remove());
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
      .arrow-path { fill: none; stroke: #333; stroke-width: 1.5; stroke-dasharray: 5 3; }
      .arrow-head { fill: #333; stroke: none; }
      .arrow-label { font-family: ${getFontFamily()}; font-size: ${Math.round(getFontSize() * 0.92)}px; fill: #333; text-anchor: middle; }
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
