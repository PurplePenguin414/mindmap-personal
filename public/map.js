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

function exportPdf() {
  if (data.nodes.length === 0) { window.print(); return; }
  const xs = data.nodes.map(n => n.x);
  const ys = data.nodes.map(n => n.y);
  const pad = 120;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const width = maxX - minX;
  const height = maxY - minY;

  const prevWidth = canvasEl.style.width, prevHeight = canvasEl.style.height;
  const shiftX = CANVAS_CENTER - minX;
  const shiftY = CANVAS_CENTER - minY;

  // Temporarily shift the whole layer so the content's bounding box starts
  // at (0,0), then shrink the canvas/svg to exactly that box for printing.
  nodeLayer.style.transform = `translate(${shiftX - CANVAS_CENTER}px, ${shiftY - CANVAS_CENTER}px)`;
  linkLayer.style.transform = `translate(${shiftX - CANVAS_CENTER}px, ${shiftY - CANVAS_CENTER}px)`;
  canvasEl.style.width = width + 'px';
  canvasEl.style.height = height + 'px';

  const cleanup = () => {
    nodeLayer.style.transform = '';
    linkLayer.style.transform = '';
    canvasEl.style.width = prevWidth || '8000px';
    canvasEl.style.height = prevHeight || '8000px';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 500);
  }, 50);
}

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
