const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mm = require('../lib/mindmap');

const TEST_DB = path.join(__dirname, 'test.db');
for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const db = mm.initDb(TEST_DB);
let pass = 0, fail = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`PASS: ${label}`);
    pass++;
  } catch (e) {
    console.log(`FAIL: ${label} -> ${e.message}`);
    fail++;
  }
}

// --- Scenario 1: basic tree + levels ---
const { mapId, rootId } = mm.createMap(db, 'Estate Plan');

check('root node created at level 0', () => {
  const root = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootId);
  assert.strictEqual(root.level, 0);
  assert.strictEqual(root.parent_id, null);
  assert.strictEqual(root.title, 'Estate Plan');
});

const nodeA = mm.createNode(db, { mapId, parentId: rootId, title: 'Branch A', x: 10, y: 10 });
const nodeB = mm.createNode(db, { mapId, parentId: rootId, title: 'Branch B', x: -10, y: 10 });
const nodeA1 = mm.createNode(db, { mapId, parentId: nodeA, title: 'A1' });
const nodeA2 = mm.createNode(db, { mapId, parentId: nodeA, title: 'A2' });
const nodeA1a = mm.createNode(db, { mapId, parentId: nodeA1, title: 'A1a' }); // level 3
const nodeA1b = mm.createNode(db, { mapId, parentId: nodeA1, title: 'A1b' }); // level 3

check('unlimited branches: root has 2 children', () => {
  const kids = db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(rootId);
  assert.strictEqual(kids.length, 2);
});

check('levels assigned by distance from root', () => {
  const get = id => db.prepare('SELECT level FROM nodes WHERE id = ?').get(id).level;
  assert.strictEqual(get(nodeA), 1);
  assert.strictEqual(get(nodeB), 1);
  assert.strictEqual(get(nodeA1), 2);
  assert.strictEqual(get(nodeA2), 2);
  assert.strictEqual(get(nodeA1a), 3);
  assert.strictEqual(get(nodeA1b), 3);
});

// --- Scenario 2: cross-links independent of hierarchy/level ---
const linkId = mm.createLink(db, { mapId, nodeAId: nodeA1a, nodeBId: nodeB, style: 'dashed', color: '#ff0000' });

check('cross-link connects nodes at different levels (3 <-> 1)', () => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  assert.strictEqual(link.node_a_id, nodeA1a);
  assert.strictEqual(link.node_b_id, nodeB);
  assert.strictEqual(link.style, 'dashed');
});

check('link style can be updated per-link', () => {
  mm.updateLink(db, linkId, { style: 'dotted', color: '#00ff00' });
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  assert.strictEqual(link.style, 'dotted');
  assert.strictEqual(link.color, '#00ff00');
});

// --- Scenario 3: delete a mid-tree node -> children reattach to its parent ---
// Delete nodeA (level 1). Its children A1, A2 (level 2) should reattach to
// root (level 1 now), and A1's children A1a, A1b should cascade to level 2.
const beforeCount = db.prepare('SELECT COUNT(*) c FROM nodes WHERE map_id = ?').get(mapId).c;
const result = mm.deleteNode(db, nodeA);

check('deleting mid-tree node removes only that node', () => {
  const afterCount = db.prepare('SELECT COUNT(*) c FROM nodes WHERE map_id = ?').get(mapId).c;
  assert.strictEqual(afterCount, beforeCount - 1);
  const gone = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA);
  assert.strictEqual(gone, undefined);
});

check('children reattach to deleted node\'s parent, not orphaned/cascaded', () => {
  const a1 = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA1);
  const a2 = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA2);
  assert.strictEqual(a1.parent_id, rootId);
  assert.strictEqual(a2.parent_id, rootId);
});

check('reattached children get recalculated level (2 -> 1)', () => {
  const a1 = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA1);
  assert.strictEqual(a1.level, 1);
});

check('grandchildren of deleted node cascade-recalculate too (3 -> 2)', () => {
  const a1a = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA1a);
  const a1b = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeA1b);
  assert.strictEqual(a1a.level, 2);
  assert.strictEqual(a1b.level, 2);
});

check('links touching the deleted node are removed, unrelated links survive', () => {
  // linkId connected nodeA1a <-> nodeB, neither is nodeA, so it should survive.
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkId);
  assert.notStrictEqual(link, undefined);
});

check('deleteNode reports which children were reattached and to whom', () => {
  assert.deepStrictEqual(result.reattachedChildIds.sort(), [nodeA1, nodeA2].sort());
  assert.strictEqual(result.newParentId, rootId);
});

// --- Scenario 4: delete a node whose child HAD a cross-link -> link dies ---
const nodeC = mm.createNode(db, { mapId, parentId: rootId, title: 'Branch C' });
const linkToC = mm.createLink(db, { mapId, nodeAId: nodeC, nodeBId: nodeB, style: 'solid' });
mm.deleteNode(db, nodeC);

check('deleting a linked node removes its links', () => {
  const link = db.prepare('SELECT * FROM links WHERE id = ?').get(linkToC);
  assert.strictEqual(link, undefined);
});

// --- Scenario 5: the center node can only be deleted once it's empty ---
// Fresh map for a clean center-delete test.
const { mapId: mapId2, rootId: rootId2 } = mm.createMap(db, 'Root Delete Test');
const rNodeX = mm.createNode(db, { mapId: mapId2, parentId: rootId2, title: 'X' });
const rNodeY = mm.createNode(db, { mapId: mapId2, parentId: rootId2, title: 'Y' });
const rNodeX1 = mm.createNode(db, { mapId: mapId2, parentId: rNodeX, title: 'X1' });

check('deleting a populated center node throws and changes nothing', () => {
  assert.throws(() => mm.deleteNode(db, rootId2), /branches attached/);
  const root = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootId2);
  assert.notStrictEqual(root, undefined);
  const x = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rNodeX);
  assert.strictEqual(x.parent_id, rootId2); // untouched
});

check('editing a populated center node is still allowed', () => {
  mm.editNode(db, rootId2, { title: 'Renamed Center', description: 'still editable' });
  const root = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootId2);
  assert.strictEqual(root.title, 'Renamed Center');
});

check('deleting the center succeeds once its branches are gone', () => {
  // Deleting X reattaches X1 to the root (normal non-center delete) -
  // the root still has a branch (X1) at this point, so it's still blocked.
  mm.deleteNode(db, rNodeX);
  const x1 = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rNodeX1);
  assert.strictEqual(x1.parent_id, rootId2);
  assert.strictEqual(x1.level, 1);
  assert.throws(() => mm.deleteNode(db, rootId2), /branches attached/);

  mm.deleteNode(db, rNodeY);
  mm.deleteNode(db, rNodeX1);
  // Root now has zero children -> deleting it should succeed.
  mm.deleteNode(db, rootId2);
  const root = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootId2);
  assert.strictEqual(root, undefined);
});

check('a brand-new empty center (no branches) can be deleted immediately', () => {
  const { mapId: mapId3, rootId: rootId3 } = mm.createMap(db, 'Empty Center Test');
  mm.deleteNode(db, rootId3);
  const root = db.prepare('SELECT * FROM nodes WHERE id = ?').get(rootId3);
  assert.strictEqual(root, undefined);
  mm.deleteMap(db, mapId3); // cleanup
});

// --- Scenario 6: editing title/description, unlimited content, no caps ---
check('editNode updates title and description independently', () => {
  mm.editNode(db, nodeB, { description: 'A long description with no length cap. '.repeat(50) });
  const b = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeB);
  assert.strictEqual(b.title, 'Branch B'); // untouched
  assert.ok(b.description.length > 100);
  mm.editNode(db, nodeB, { title: 'Branch B Renamed' });
  const b2 = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeB);
  assert.strictEqual(b2.title, 'Branch B Renamed');
  assert.ok(b2.description.length > 100); // description preserved
});

// --- Scenario 7: moveNode (freeform drag position, no auto-layout) ---
check('moveNode sets arbitrary x/y with no snapping/layout applied', () => {
  mm.moveNode(db, nodeB, 12345.5, -987.25);
  const b = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeB);
  assert.strictEqual(b.x, 12345.5);
  assert.strictEqual(b.y, -987.25);
});

// --- Scenario 8: getMap / listMaps / deleteMap ---
check('getMap returns map + all nodes + all links', () => {
  const full = mm.getMap(db, mapId);
  assert.ok(full.map);
  assert.ok(full.nodes.length > 0);
});

check('listMaps returns all created maps', () => {
  const maps = mm.listMaps(db);
  assert.ok(maps.some(m => m.id === mapId));
  assert.ok(maps.some(m => m.id === mapId2));
});

check('deleteMap cascades to its nodes and links', () => {
  mm.deleteMap(db, mapId2);
  const nodes = db.prepare('SELECT * FROM nodes WHERE map_id = ?').all(mapId2);
  assert.strictEqual(nodes.length, 0);
});

// --- Scenario 9: restoreMapState (undo mechanism) ---
check('restoreMapState rolls back a delete (undo)', () => {
  const full = mm.getMap(db, mapId);
  const snapshot = { nodes: full.nodes, links: full.links };
  const nodeCountBefore = snapshot.nodes.length;
  const someNodeId = snapshot.nodes.find(n => n.parent_id !== null).id;

  mm.deleteNode(db, someNodeId);
  const afterDelete = mm.getMap(db, mapId);
  assert.strictEqual(afterDelete.nodes.length, nodeCountBefore - 1);

  mm.restoreMapState(db, mapId, snapshot.nodes, snapshot.links);
  const afterRestore = mm.getMap(db, mapId);
  assert.strictEqual(afterRestore.nodes.length, nodeCountBefore);
  assert.ok(afterRestore.nodes.some(n => n.id === someNodeId));
  // Levels/parents should match the original snapshot exactly.
  for (const n of snapshot.nodes) {
    const restored = afterRestore.nodes.find(x => x.id === n.id);
    assert.strictEqual(restored.level, n.level);
    assert.strictEqual(restored.parent_id, n.parent_id);
  }
});

check('restoreMapState rolls back an edit', () => {
  const full = mm.getMap(db, mapId);
  const snapshot = { nodes: full.nodes, links: full.links };
  const target = snapshot.nodes[0];
  mm.editNode(db, target.id, { title: 'Changed Title' });
  mm.restoreMapState(db, mapId, snapshot.nodes, snapshot.links);
  const restored = db.prepare('SELECT * FROM nodes WHERE id = ?').get(target.id);
  assert.strictEqual(restored.title, target.title);
});

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
if (fail > 0) process.exit(1);
