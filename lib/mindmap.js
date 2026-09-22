// Core mind-map data logic. No Express/HTTP here — pure functions over a
// better-sqlite3 database handle, so this can be unit tested directly.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

// --- Maps -------------------------------------------------------------

function createMap(db, title) {
  const now = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO maps (title, created_at, updated_at) VALUES (?, ?, ?)'
  ).run(title, now, now);
  const mapId = info.lastInsertRowid;
  // The title becomes the center/root node.
  const rootInfo = db.prepare(
    `INSERT INTO nodes (map_id, parent_id, title, description, level, x, y)
     VALUES (?, NULL, ?, '', 0, 0, 0)`
  ).run(mapId, title);
  return { mapId, rootId: rootInfo.lastInsertRowid };
}

function listMaps(db) {
  return db.prepare('SELECT id, title, created_at, updated_at FROM maps ORDER BY updated_at DESC').all();
}

function getMap(db, mapId) {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId);
  if (!map) return null;
  const nodes = db.prepare('SELECT * FROM nodes WHERE map_id = ? ORDER BY id').all(mapId);
  const links = db.prepare('SELECT * FROM links WHERE map_id = ? ORDER BY id').all(mapId);
  return { map, nodes, links };
}

function deleteMap(db, mapId) {
  db.prepare('DELETE FROM maps WHERE id = ?').run(mapId); // cascades to nodes/links
}

function touchMap(db, mapId) {
  db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), mapId);
}

// --- Nodes --------------------------------------------------------------

function createNode(db, { mapId, parentId, title, description = '', x = 0, y = 0 }) {
  const parent = db.prepare('SELECT * FROM nodes WHERE id = ? AND map_id = ?').get(parentId, mapId);
  if (!parent) throw new Error('Parent node not found in this map');
  const level = parent.level + 1;
  const info = db.prepare(
    `INSERT INTO nodes (map_id, parent_id, title, description, level, x, y)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(mapId, parentId, title, description, level, x, y);
  touchMap(db, mapId);
  return info.lastInsertRowid;
}

function editNode(db, nodeId, { title, description }) {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
  if (!node) throw new Error('Node not found');
  const newTitle = title !== undefined ? title : node.title;
  const newDesc = description !== undefined ? description : node.description;
  db.prepare('UPDATE nodes SET title = ?, description = ?, updated_at = ? WHERE id = ?')
    .run(newTitle, newDesc, new Date().toISOString(), nodeId);
  touchMap(db, node.map_id);
}

function moveNode(db, nodeId, x, y) {
  const node = db.prepare('SELECT map_id FROM nodes WHERE id = ?').get(nodeId);
  if (!node) throw new Error('Node not found');
  db.prepare('UPDATE nodes SET x = ?, y = ? WHERE id = ?').run(x, y, nodeId);
  touchMap(db, node.map_id);
}

// Recompute level for a node's whole descendant subtree, based on its
// (already updated) own level. Used after reattachment.
function recalcDescendantLevels(db, nodeId) {
  const node = db.prepare('SELECT id, level FROM nodes WHERE id = ?').get(nodeId);
  if (!node) return;
  const children = db.prepare('SELECT id FROM nodes WHERE parent_id = ?').all(nodeId);
  const upd = db.prepare('UPDATE nodes SET level = ? WHERE id = ?');
  for (const child of children) {
    upd.run(node.level + 1, child.id);
    recalcDescendantLevels(db, child.id);
  }
}

// Delete a node. Its children are reattached to the deleted node's parent
// (NOT cascade-deleted, NOT orphaned). The center node (no parent) can
// only be deleted once it has no branches attached — with nothing above
// it to reattach children to, deleting a populated center would either
// destroy its branches or require picking a new center arbitrarily, so
// it's blocked instead: edit the center freely, but delete it only after
// its branches are gone (or deleted individually, which reattaches them
// upward as normal). Any cross-links touching the deleted node are
// removed.
function deleteNode(db, nodeId) {
  const node = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
  if (!node) throw new Error('Node not found');

  const children = db.prepare('SELECT id FROM nodes WHERE parent_id = ?').all(nodeId);

  if (node.parent_id === null && children.length > 0) {
    throw new Error('The center node can\'t be deleted while it still has branches attached. Delete or move its branches first, or edit the center instead.');
  }

  const newParentId = node.parent_id; // null only when node is an empty center
  const newParentLevel = newParentId
    ? db.prepare('SELECT level FROM nodes WHERE id = ?').get(newParentId).level
    : -1;

  const reattach = db.prepare('UPDATE nodes SET parent_id = ?, level = ? WHERE id = ?');
  for (const child of children) {
    reattach.run(newParentId, newParentLevel + 1, child.id);
    recalcDescendantLevels(db, child.id);
  }

  db.prepare('DELETE FROM links WHERE node_a_id = ? OR node_b_id = ?').run(nodeId, nodeId);
  db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
  touchMap(db, node.map_id);

  return { reattachedChildIds: children.map(c => c.id), newParentId };
}

// --- Links (freeform cross-links, independent of tree hierarchy) --------

function createLink(db, { mapId, nodeAId, nodeBId, style = 'solid', color = '#888888' }) {
  if (nodeAId === nodeBId) throw new Error('Cannot link a node to itself');
  const a = db.prepare('SELECT id FROM nodes WHERE id = ? AND map_id = ?').get(nodeAId, mapId);
  const b = db.prepare('SELECT id FROM nodes WHERE id = ? AND map_id = ?').get(nodeBId, mapId);
  if (!a || !b) throw new Error('Both nodes must exist in this map');
  const info = db.prepare(
    'INSERT INTO links (map_id, node_a_id, node_b_id, style, color) VALUES (?, ?, ?, ?, ?)'
  ).run(mapId, nodeAId, nodeBId, style, color);
  touchMap(db, mapId);
  return info.lastInsertRowid;
}

function updateLink(db, linkId, { style, color }) {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  if (!link) throw new Error('Link not found');
  const newStyle = style !== undefined ? style : link.style;
  const newColor = color !== undefined ? color : link.color;
  db.prepare('UPDATE links SET style = ?, color = ? WHERE id = ?').run(newStyle, newColor, linkId);
}

function deleteLink(db, linkId) {
  db.prepare('DELETE FROM links WHERE id = ?').run(linkId);
}

// Wholesale restore of a map's nodes+links to a prior snapshot, used for
// client-side undo. Deletes everything currently in the map and reinserts
// the snapshot's nodes (parents before children, so foreign keys hold) and
// links, preserving their original ids.
const restoreMapStateTxn = (db) => db.transaction((mapId, nodes, links) => {
  db.prepare('DELETE FROM nodes WHERE map_id = ?').run(mapId); // cascades links too

  const insertNode = db.prepare(`
    INSERT INTO nodes (id, map_id, parent_id, title, description, level, x, y, created_at, updated_at)
    VALUES (@id, @map_id, @parent_id, @title, @description, @level, @x, @y, @created_at, @updated_at)
  `);
  const ordered = [...nodes].sort((a, b) => a.level - b.level);
  for (const n of ordered) {
    insertNode.run({
      id: n.id,
      map_id: mapId,
      parent_id: n.parent_id,
      title: n.title,
      description: n.description || '',
      level: n.level,
      x: n.x,
      y: n.y,
      created_at: n.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const insertLink = db.prepare(`
    INSERT INTO links (id, map_id, node_a_id, node_b_id, style, color, created_at)
    VALUES (@id, @map_id, @node_a_id, @node_b_id, @style, @color, @created_at)
  `);
  for (const l of links) {
    insertLink.run({
      id: l.id,
      map_id: mapId,
      node_a_id: l.node_a_id,
      node_b_id: l.node_b_id,
      style: l.style,
      color: l.color,
      created_at: l.created_at || new Date().toISOString(),
    });
  }

  db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), mapId);
});

function restoreMapState(db, mapId, nodes, links) {
  restoreMapStateTxn(db)(mapId, nodes, links);
}

module.exports = {
  initDb,
  createMap,
  listMaps,
  getMap,
  deleteMap,
  createNode,
  editNode,
  moveNode,
  deleteNode,
  createLink,
  updateLink,
  deleteLink,
  restoreMapState,
};
