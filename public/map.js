const CANVAS_CENTER = 4000;
const LEVEL_COLORS = 8;

const params = new URLSearchParams(window.location.search);
const mapId = Number(params.get('id'));
if (!mapId) window.location.href = '/';

let data = { map: null, nodes: [], links: [] };
let nodesById = new Map();
let selectedNodeId = null;
let showAll = false;
let connectMode = false;
let connectSourceId = null;
let descOverride = new Set();
let undoStack = [];
const UNDO_LIMIT = 50;

const canvasEl = document.getElementById('canvas');
const nodeLayer = document.getElementById('nodeLayer');
const linkLayer = document.getElementById('linkLayer');
const canvasContainer = document.getElementById('canvasContainer');
const hintEl = document.getElementById('hint');

function api(path, opts) {
  return fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  }).then(async (res) => {
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('unauth'); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    return res.status === 204 ? null : res.json();
  });
}

function snapshotForUndo() {
  undoStack.push({
    nodes: JSON.parse(JSON.stringify(data.nodes)),
    links: JSON.parse(JSON.stringify(data.links)),
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  document.getElementById('btnUndo').disabled = undoStack.length === 0;
}

async function undo() {
  const snap = undoStack.pop();
  if (!snap) return;
  document.getElementById('btnUndo').disabled = undoStack.length === 0;
  await api(`/maps/${mapId}/restore`, { method: 'POST', body: JSON.stringify(snap) });
  await loadMap();
}

async function loadMap() {
  data = await api(`/maps/${mapId}`);
  nodesById = new Map(data.nodes.map(n => [n.id, n]));
  document.getElementById('mapTitle').textContent = data.map.title;
  document.title = `${data.map.title} — Mind Map`;
  render();
}

// --- Layout helpers -------------------------------------------------

function screenX(x) { return CANVAS_CENTER + x; }
function screenY(y) { return CANVAS_CENTER + y; }

function childrenOf(nodeId) {
  return data.nodes.filter(n => n.parent_id === nodeId);
}

function nextChildPosition(parent) {
  const siblings = childrenOf(parent.id);
  const radius = 160 + parent.level * 10;
  const angleStep = (2 * Math.PI) / Math.max(6, siblings.length + 1);
  const angle = siblings.length * angleStep - Math.PI / 2;
  return {
    x: parent.x + radius * Math.cos(angle),
    y: parent.y + radius * Math.sin(angle),
  };
}

// --- Rendering --------------------------------------------------------

function render() {
  renderNodes();
  renderLinks();
}

function isDescVisible(node) {
  return showAll || descOverride.has(node.id);
}

function renderNodes() {
  nodeLayer.innerHTML = '';
  for (const node of data.nodes) {
    nodeLayer.appendChild(buildNodeEl(node));
  }
}

function buildNodeEl(node) {
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.id = node.id;
  el.style.setProperty('--node-color', `var(--level-${node.level % LEVEL_COLORS})`);
  el.style.left = screenX(node.x) + 'px';
  el.style.top = screenY(node.y) + 'px';
  if (node.id === selectedNodeId) el.classList.add('selected');
  if (node.id === connectSourceId) el.classList.add('connect-source');
  if (isDescVisible(node)) el.classList.add('desc-visible');

  const badge = document.createElement('div');
  badge.className = 'n-level-badge';
  badge.textContent = node.parent_id === null ? 'Center' : `Level ${node.level}`;
  el.appendChild(badge);

  const title = document.createElement('div');
  title.className = 'n-title';
  title.textContent = node.title;
  el.appendChild(title);

  if (node.description) {
    const desc = document.createElement('div');
    desc.className = 'n-desc';
    desc.textContent = node.description;
    el.appendChild(desc);
  }

  if (node.id === selectedNodeId) {
    el.appendChild(buildNodeToolbar(node));
  }

  attachNodeInteractions(el, node);
  return el;
}

function buildNodeToolbar(node) {
  const tb = document.createElement('div');
  tb.className = 'node-toolbar';
  tb.style.top = '-42px';
  tb.style.left = '50%';

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Branch';
  addBtn.onclick = (e) => { e.stopPropagation(); openAddModal(node); };

  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.onclick = (e) => { e.stopPropagation(); openEditModal(node); };

  const linkBtn = document.createElement('button');
  linkBtn.textContent = '🔗';
  linkBtn.title = 'Start a connection from this node';
  linkBtn.onclick = (e) => { e.stopPropagation(); enterConnectModeFrom(node); };

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.className = 'danger';
  const isCenter = node.parent_id === null;
  const hasBranches = childrenOf(node.id).length > 0;
  if (isCenter && hasBranches) {
    delBtn.disabled = true;
    delBtn.title = 'The center node can\'t be deleted while it still has branches. Delete its branches first, or edit the center instead.';
  } else {
    delBtn.onclick = (e) => { e.stopPropagation(); deleteNodeFlow(node); };
  }

  tb.append(addBtn, editBtn, linkBtn, delBtn);
  return tb;
}

function renderLinks() {
  const svgns = 'http://www.w3.org/2000/svg';
  linkLayer.innerHTML = '';

  // Tree edges (parent-child), thin, colored by child's level.
  for (const node of data.nodes) {
    if (node.parent_id === null) continue;
    const parent = nodesById.get(node.parent_id);
    if (!parent) continue;
    const line = document.createElementNS(svgns, 'line');
    line.setAttribute('x1', screenX(parent.x));
    line.setAttribute('y1', screenY(parent.y));
    line.setAttribute('x2', screenX(node.x));
    line.setAttribute('y2', screenY(node.y));
    line.setAttribute('stroke', `var(--level-${node.level % LEVEL_COLORS})`);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('opacity', '0.6');
    linkLayer.appendChild(line);
  }

  // Freeform cross-links, per-link style/color, clickable to edit/delete.
  for (const link of data.links) {
    const a = nodesById.get(link.node_a_id);
    const b = nodesById.get(link.node_b_id);
    if (!a || !b) continue;

    const visible = document.createElementNS(svgns, 'line');
    visible.setAttribute('x1', screenX(a.x));
    visible.setAttribute('y1', screenY(a.y));
    visible.setAttribute('x2', screenX(b.x));
    visible.setAttribute('y2', screenY(b.y));
    visible.setAttribute('stroke', link.color || '#888888');
    visible.setAttribute('stroke-width', '2.5');
    if (link.style === 'dashed') visible.setAttribute('stroke-dasharray', '8,6');
    if (link.style === 'dotted') visible.setAttribute('stroke-dasharray', '2,5');
    linkLayer.appendChild(visible);

    const hit = document.createElementNS(svgns, 'line');
    hit.setAttribute('x1', screenX(a.x));
    hit.setAttribute('y1', screenY(a.y));
    hit.setAttribute('x2', screenX(b.x));
    hit.setAttribute('y2', screenY(b.y));
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', '16');
    hit.classList.add('hit');
    hit.style.pointerEvents = 'stroke';
    hit.addEventListener('click', () => openLinkModal(link));
    linkLayer.appendChild(hit);
  }
}

// --- Node interactions: select, drag, double-click desc toggle --------

function attachNodeInteractions(el, node) {
  let dragging = false;
  let moved = false;
  let startClientX, startClientY, startNodeX, startNodeY;

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (connectMode) return; // clicks handled by click handler in connect mode
    dragging = true;
    moved = false;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startNodeX = node.x;
    startNodeY = node.y;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!moved) {
        moved = true;
        snapshotForUndo();
      }
      node.x = startNodeX + dx;
      node.y = startNodeY + dy;
      el.style.left = screenX(node.x) + 'px';
      el.style.top = screenY(node.y) + 'px';
      renderLinks();
    }
  });

  window.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      try {
        await api(`/nodes/${node.id}/position`, {
          method: 'PATCH',
          body: JSON.stringify({ x: node.x, y: node.y }),
        });
      } catch (err) {
        showError('Could not save the new position: ' + err.message);
      }
    }
  });

  el.addEventListener('click', (e) => {
    if (moved) return; // suppress click that ends a drag
    if (connectMode) {
      handleConnectClick(node);
      return;
    }
    selectedNodeId = selectedNodeId === node.id ? null : node.id;
    render();
  });

  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (!node.description) return;
    if (descOverride.has(node.id)) descOverride.delete(node.id);
    else descOverride.add(node.id);
    render();
  });
}

canvasEl.addEventListener('click', (e) => {
  if (e.target === canvasEl || e.target === nodeLayer) {
    selectedNodeId = null;
    render();
  }
});

// --- Connect mode -------------------------------------------------------

function enterConnectModeFrom(node) {
  connectMode = true;
  connectSourceId = node.id;
  document.getElementById('btnConnect').classList.add('active');
  updateHint();
  render();
}

function toggleConnectMode() {
  connectMode = !connectMode;
  connectSourceId = null;
  document.getElementById('btnConnect').classList.toggle('active', connectMode);
  updateHint();
  render();
}

function handleConnectClick(node) {
  if (!connectSourceId) {
    connectSourceId = node.id;
    updateHint();
    render();
    return;
  }
  if (connectSourceId === node.id) {
    connectSourceId = null;
    render();
    return;
  }
  openLinkModal(null, connectSourceId, node.id);
}

function updateHint() {
  if (connectMode && !connectSourceId) hintEl.textContent = 'Connect mode: click the first node.';
  else if (connectMode && connectSourceId) hintEl.textContent = 'Now click the second node to connect it to.';
  else hintEl.textContent = '';
}

// --- Modals: add / edit node -------------------------------------------

const modalOverlay = document.getElementById('modalOverlay');
const modalHeading = document.getElementById('modalHeading');
const modalTitleInput = document.getElementById('modalTitle');
const modalDescInput = document.getElementById('modalDesc');
let modalMode = null; // 'add' | 'edit'
let modalTargetNode = null;

function openAddModal(parentNode) {
  modalMode = 'add';
  modalTargetNode = parentNode;
  modalHeading.textContent = `New branch from "${parentNode.title}"`;
  modalTitleInput.value = '';
  modalDescInput.value = '';
  modalOverlay.classList.remove('hidden');
  modalTitleInput.focus();
}

function openEditModal(node) {
  modalMode = 'edit';
  modalTargetNode = node;
  modalHeading.textContent = node.parent_id === null ? 'Edit center node' : 'Edit node';
  modalTitleInput.value = node.title;
  modalDescInput.value = node.description || '';
  modalOverlay.classList.remove('hidden');
  modalTitleInput.focus();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  modalMode = null;
  modalTargetNode = null;
}

document.getElementById('modalCancel').onclick = closeModal;

document.getElementById('modalSave').onclick = async () => {
  const title = modalTitleInput.value.trim();
  const description = modalDescInput.value;
  if (!title) { showError('Title is required.'); return; }

  try {
    if (modalMode === 'add') {
      snapshotForUndo();
      const pos = nextChildPosition(modalTargetNode);
      await api(`/maps/${mapId}/nodes`, {
        method: 'POST',
        body: JSON.stringify({ parentId: modalTargetNode.id, title, description, x: pos.x, y: pos.y }),
      });
    } else if (modalMode === 'edit') {
      snapshotForUndo();
      await api(`/nodes/${modalTargetNode.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description }),
      });
    }
    closeModal();
    await loadMap();
  } catch (err) {
    showError('Could not save: ' + err.message);
  }
};

async function deleteNodeFlow(node) {
  const childCount = childrenOf(node.id).length;
  const msg = childCount > 0
    ? `Delete "${node.title}"? Its ${childCount} child branch(es) will reattach to its parent.`
    : `Delete "${node.title}"?`;
  const ok = await showConfirm(msg);
  if (!ok) return;
  try {
    snapshotForUndo();
    await api(`/nodes/${node.id}`, { method: 'DELETE' });
    selectedNodeId = null;
    await loadMap();
  } catch (err) {
    showError('Could not delete: ' + err.message);
  }
}

// --- Modal: link style ---------------------------------------------------

const linkModalOverlay = document.getElementById('linkModalOverlay');
const linkStyleSelect = document.getElementById('linkStyleSelect');
const linkColorInput = document.getElementById('linkColorInput');
let linkModalMode = null; // 'create' | 'edit'
let linkModalTarget = null; // existing link, or {aId, bId} for create

function openLinkModal(existingLink, aId, bId) {
  if (existingLink) {
    linkModalMode = 'edit';
    linkModalTarget = existingLink;
    linkStyleSelect.value = existingLink.style;
    linkColorInput.value = existingLink.color;
    document.getElementById('linkDeleteBtn').style.display = '';
  } else {
    linkModalMode = 'create';
    linkModalTarget = { aId, bId };
    linkStyleSelect.value = 'solid';
    linkColorInput.value = '#888888';
    document.getElementById('linkDeleteBtn').style.display = 'none';
  }
  linkModalOverlay.classList.remove('hidden');
}

function closeLinkModal() {
  linkModalOverlay.classList.add('hidden');
  linkModalMode = null;
  linkModalTarget = null;
}

document.getElementById('linkModalCancel').onclick = () => {
  if (linkModalMode === 'create') { connectSourceId = null; updateHint(); render(); }
  closeLinkModal();
};

document.getElementById('linkModalSave').onclick = async () => {
  const style = linkStyleSelect.value;
  const color = linkColorInput.value;
  try {
    if (linkModalMode === 'create') {
      snapshotForUndo();
      await api(`/maps/${mapId}/links`, {
        method: 'POST',
        body: JSON.stringify({ nodeAId: linkModalTarget.aId, nodeBId: linkModalTarget.bId, style, color }),
      });
      connectSourceId = null;
      updateHint();
    } else {
      snapshotForUndo();
      await api(`/links/${linkModalTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ style, color }),
      });
    }
    closeLinkModal();
    await loadMap();
  } catch (err) {
    showError('Could not save connection: ' + err.message);
  }
};

document.getElementById('linkDeleteBtn').onclick = async () => {
  if (linkModalMode !== 'edit') return;
  const ok = await showConfirm('Delete this connection?');
  if (!ok) return;
  try {
    snapshotForUndo();
    await api(`/links/${linkModalTarget.id}`, { method: 'DELETE' });
    closeLinkModal();
    await loadMap();
  } catch (err) {
    showError('Could not delete connection: ' + err.message);
  }
};

// --- Toolbar buttons ------------------------------------------------

document.getElementById('btnUndo').onclick = undo;
document.getElementById('btnUndo').disabled = true;

document.getElementById('btnShowAll').onclick = () => {
  showAll = !showAll;
  document.getElementById('btnShowAll').classList.toggle('active', showAll);
  render();
};

document.getElementById('btnConnect').onclick = toggleConnectMode;

document.getElementById('btnExport').onclick = () => {
  exportPdf();
};

// --- PDF export -------------------------------------------------------
//
// Printing the live canvas directly doesn't work: it's an 8000x8000 scrolling
// surface with the map sitting around its center, so the printed pages were
// just empty corners of it. Instead we build a separate print-only document,
// sized to exactly the map's bounding box, in a hidden iframe and print that.
// The live page is never touched, and the print always uses the light palette
// (dark-theme text would otherwise print white-on-white).

// Chrome/Edge cap PDF page dimensions around 200in (~19200 CSS px); very
// large maps are scaled down to fit under this instead of being cut off.
const MAX_PRINT_PX = 18000;

function buildPrintHtml() {
  const els = [...nodeLayer.querySelectorAll('.node')];
  if (els.length === 0) return null;

  // Bounding box from the rendered nodes (real sizes, not just centers).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const w = el.offsetWidth, h = el.offsetHeight;
    const cx = parseFloat(el.style.left), cy = parseFloat(el.style.top);
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
  }
  const pad = 48;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  const scale = Math.min(1, MAX_PRINT_PX / Math.max(width, height));
  const pageW = Math.ceil(width * scale);
  const pageH = Math.ceil(height * scale);

  // Clone the rendered links and nodes, minus anything interactive.
  const svg = linkLayer.cloneNode(true);
  svg.removeAttribute('id');
  svg.querySelectorAll('.hit').forEach((n) => n.remove());
  const nodesHtml = els.map((el) => {
    const c = el.cloneNode(true);
    c.classList.remove('selected', 'connect-source');
    c.querySelectorAll('.node-toolbar').forEach((n) => n.remove());
    return c.outerHTML;
  }).join('');

  // Reuse the page's own stylesheet URLs so the print document never drifts
  // from the app's real styles (or their cache-busting versions).
  const cssLinks = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => `<link rel="stylesheet" href="${l.getAttribute('href')}">`)
    .join('\n');

  const title = (data.map && data.map.title ? data.map.title : 'Mind Map')
    .replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

  return `<!doctype html>
<html data-theme="light"><head><meta charset="UTF-8"><title>${title}</title>
${cssLinks}
<style>
  @page { size: ${pageW}px ${pageH}px; margin: 0; }
  html, body { margin: 0; padding: 0; width: ${pageW}px; height: ${pageH}px; overflow: hidden; background: #fff; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #pc { position: absolute; left: 0; top: 0; width: ${pageW}px; height: ${pageH}px; overflow: hidden; background: #fff; }
  #inner { position: absolute; left: ${-minX * scale}px; top: ${-minY * scale}px; width: 8000px; height: 8000px;
           transform: scale(${scale}); transform-origin: 0 0; }
  #inner > svg { position: absolute; left: 0; top: 0; width: 8000px; height: 8000px; overflow: visible; }
  .node { box-shadow: none; cursor: default; }
  .node .n-desc { max-height: none; overflow: visible; }
</style></head>
<body><div id="pc"><div id="inner">${svg.outerHTML}${nodesHtml}</div></div></body></html>`;
}

function exportPdf() {
  const html = buildPrintHtml();
  if (!html) { showError('Nothing to export yet.'); return; }

  const old = document.getElementById('printFrame');
  if (old) old.remove();

  const frame = document.createElement('iframe');
  frame.id = 'printFrame';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  frame.onload = () => {
    const w = frame.contentWindow;
    w.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 1000));
    w.focus();
    w.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

// Ctrl/Cmd+P would otherwise print the raw canvas (blank) — use the same export.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    exportPdf();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
  if (e.key === 'Escape') {
    if (connectMode) toggleConnectMode();
    closeModal();
    closeLinkModal();
  }
});

// --- Init ---------------------------------------------------------------

loadMap().then(() => {
  // Center the viewport on the root node the first time the map opens.
  canvasContainer.scrollLeft = CANVAS_CENTER - canvasContainer.clientWidth / 2;
  canvasContainer.scrollTop = CANVAS_CENTER - canvasContainer.clientHeight / 2;
});
