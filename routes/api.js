const express = require('express');

module.exports = function (db, mm) {
  const router = express.Router();

  function handle(fn) {
    return (req, res) => {
      try {
        fn(req, res);
      } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Request failed' });
      }
    };
  }

  // --- Maps ---------------------------------------------------------

  router.get('/maps', handle((req, res) => {
    res.json(mm.listMaps(db));
  }));

  router.post('/maps', handle((req, res) => {
    const { title } = req.body || {};
    if (!title || !title.trim()) throw new Error('Title is required');
    const { mapId, rootId } = mm.createMap(db, title.trim());
    res.json({ mapId, rootId });
  }));

  router.get('/maps/:id', handle((req, res) => {
    const full = mm.getMap(db, Number(req.params.id));
    if (!full) return res.status(404).json({ error: 'Map not found' });
    res.json(full);
  }));

  router.delete('/maps/:id', handle((req, res) => {
    mm.deleteMap(db, Number(req.params.id));
    res.json({ ok: true });
  }));

  // Wholesale state restore — used by client-side undo.
  router.post('/maps/:id/restore', handle((req, res) => {
    const mapId = Number(req.params.id);
    const { nodes, links } = req.body || {};
    if (!Array.isArray(nodes) || !Array.isArray(links)) {
      throw new Error('nodes and links arrays are required');
    }
    mm.restoreMapState(db, mapId, nodes, links);
    res.json({ ok: true });
  }));

  // --- Nodes ----------------------------------------------------------

  router.post('/maps/:id/nodes', handle((req, res) => {
    const mapId = Number(req.params.id);
    const { parentId, title, description, x, y } = req.body || {};
    if (!parentId) throw new Error('parentId is required (every node except the root needs a parent)');
    if (!title || !title.trim()) throw new Error('Title is required');
    const nodeId = mm.createNode(db, {
      mapId,
      parentId: Number(parentId),
      title: title.trim(),
      description: description || '',
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
    });
    res.json({ nodeId });
  }));

  router.patch('/nodes/:id', handle((req, res) => {
    const { title, description } = req.body || {};
    mm.editNode(db, Number(req.params.id), { title, description });
    res.json({ ok: true });
  }));

  router.patch('/nodes/:id/position', handle((req, res) => {
    const { x, y } = req.body || {};
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('x and y must be numbers');
    mm.moveNode(db, Number(req.params.id), x, y);
    res.json({ ok: true });
  }));

  router.delete('/nodes/:id', handle((req, res) => {
    const result = mm.deleteNode(db, Number(req.params.id));
    res.json(result);
  }));

  // --- Links (freeform cross-links) ------------------------------------

  router.post('/maps/:id/links', handle((req, res) => {
    const mapId = Number(req.params.id);
    const { nodeAId, nodeBId, style, color } = req.body || {};
    if (!nodeAId || !nodeBId) throw new Error('nodeAId and nodeBId are required');
    const linkId = mm.createLink(db, {
      mapId,
      nodeAId: Number(nodeAId),
      nodeBId: Number(nodeBId),
      style: style || 'solid',
      color: color || '#888888',
    });
    res.json({ linkId });
  }));

  router.patch('/links/:id', handle((req, res) => {
    const { style, color } = req.body || {};
    mm.updateLink(db, Number(req.params.id), { style, color });
    res.json({ ok: true });
  }));

  router.delete('/links/:id', handle((req, res) => {
    mm.deleteLink(db, Number(req.params.id));
    res.json({ ok: true });
  }));

  return router;
};
