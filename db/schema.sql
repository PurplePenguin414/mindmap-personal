-- Mind Map schema
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_map ON nodes(map_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);

-- Cross-links: freeform connections between ANY two nodes, independent of tree structure.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  node_a_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  node_b_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  style TEXT NOT NULL DEFAULT 'solid',   -- solid | dashed | dotted (line pattern)
  color TEXT NOT NULL DEFAULT '#888888',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_links_map ON links(map_id);
CREATE INDEX IF NOT EXISTS idx_links_a ON links(node_a_id);
CREATE INDEX IF NOT EXISTS idx_links_b ON links(node_b_id);
