async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

function fmtDate(s) {
  // Timestamps come from either JS (full ISO, already has T and Z) or
  // SQLite's own datetime('now') default ("YYYY-MM-DD HH:MM:SS", naive
  // UTC, no T/Z) — normalize both to a parseable ISO string.
  let iso = s;
  if (!iso.includes('T')) iso = iso.replace(' ', 'T');
  if (!iso.endsWith('Z')) iso += 'Z';
  const d = new Date(iso);
  return d.toLocaleString();
}

async function loadMaps() {
  const res = await fetch('/api/maps');
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const maps = await res.json();
  const list = document.getElementById('mapsList');
  list.innerHTML = '';
  if (maps.length === 0) {
    list.innerHTML = '<div class="empty">No maps yet — create one above.</div>';
    return;
  }
  for (const m of maps) {
    const a = document.createElement('a');
    a.className = 'map-card';
    a.href = `/map.html?id=${m.id}`;
    a.innerHTML = `
      <div>
        <div class="map-title"></div>
        <div class="map-meta"></div>
      </div>
      <button class="danger" data-id="${m.id}" title="Delete map">Delete</button>
    `;
    a.querySelector('.map-title').textContent = m.title;
    a.querySelector('.map-meta').textContent = `Updated ${fmtDate(m.updated_at)}`;
    a.querySelector('button').addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const ok = await showConfirm(`Delete "${m.title}"? This cannot be undone.`);
      if (!ok) return;
      await fetch(`/api/maps/${m.id}`, { method: 'DELETE' });
      loadMaps();
    });
    list.appendChild(a);
  }
}

document.getElementById('newForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titleInput = document.getElementById('newTitle');
  const title = titleInput.value.trim();
  if (!title) return;
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  window.location.href = `/map.html?id=${data.mapId}`;
});

loadMaps();
