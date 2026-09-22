# Mind Map — mind.megangibbs.net

A self-hosted, password-protected mind-mapping app, set up for
**mind.megangibbs.net on MLG-VPS02**.

Type a title to create a map — it becomes the center node. Branch off any
node, with no limit on depth or branch count. Drag nodes anywhere; nothing
auto-arranges, ever. Connect any two nodes to each other with a custom line
style, independent of the tree structure. Levels (distance from the center)
are color-coded so they're distinguishable at a glance. Descriptions stay
hidden until you click a node, or you can reveal all of them at once.
Undo, autosave, dark mode, and PDF export are built in.

## How to use it

- **Create a map**: from the maps list, type a title and click Create. That
  title becomes the center node.
- **Add a branch**: click a node, then "+ Branch" in the toolbar that
  appears above it. Give it a title and (optionally) a description.
- **Edit a node**: click it, then "Edit."
- **Move a node**: just drag it. Nothing snaps or rearranges other nodes.
- **Reveal a description**: double-click a node to show/hide its own
  description, or use "Show all descriptions" in the top bar to reveal
  every one at once.
- **Connect two nodes**: click 🔗 on a node's toolbar (or "Connect" in the
  top bar), then click the second node. Pick a line style and color for
  that connection — each connection can look different. Click an existing
  connection line to edit its style or delete it.
- **Delete a node**: click it, then "Delete." Its own children reattach to
  its parent — they are never deleted along with it and never left
  orphaned. (If you delete the center node itself, each of its direct
  children becomes its own new center — see note below.)
- **Undo**: the Undo button (or Ctrl+Z) steps back through your last 50
  changes — adding, editing, deleting, moving, and connections all count.
- **Export**: "Export PDF" opens your browser's print dialog with the map
  laid out to fit the page — choose "Save as PDF" there.
- **Autosave**: every change saves to the server immediately. There's no
  save button to forget to click.
- **Dark mode**: the 🌓 button in the top-right, remembered per browser.

## Deploying to mind.megangibbs.net on MLG-VPS02

Same pattern as your other megangibbs.net apps (Apache reverse proxy,
Cloudflare DNS, Let's Encrypt via certbot). MLG-VPS02 runs Docker Compose
v2 (`docker compose`, no hyphen — no ContainerConfig bug to work around).

1. On MLG-VPS02, clone the repo:
   ```bash
   cd /opt
   git clone https://github.com/PurplePenguin414/mindmap-personal.git mindmap
   cd mindmap
   ```
   (`mindmap` at the end keeps the folder name `/opt/mindmap`, even
   though the repo is called `mindmap-personal`. If the repo is private,
   cloning over HTTPS will prompt for credentials — use a personal access
   token as the password, or set up an SSH deploy key and clone via
   `git@github.com:PurplePenguin414/mindmap-personal.git` instead.)

   **Already have `/opt/mindmap` set up from the old `mindmap` repo?**
   Don't re-clone — point the existing clone at the new repo instead, so
   you keep your running container, `.env`, and `db` folder untouched:
   ```bash
   cd /opt/mindmap
   git remote set-url origin https://github.com/PurplePenguin414/mindmap-personal.git
   git fetch origin
   git reset --hard origin/main
   ```
   `.env` and `db/` aren't tracked by git, so `reset --hard` won't touch
   them — only the tracked files (code, README, `docker-compose.yml`,
   etc.) get overwritten with what's in the new repo.
2. Copy the template env file:
   ```bash
   cd /opt/mindmap
   cp .env.example .env
   ```
3. Generate a password hash:
   ```bash
   docker compose run --rm mindmap node scripts/set-password.js "your password"
   ```
   That prints a line like `APP_PASSWORD_HASH=$2b$12$...` — copy it.
   (If Node isn't installed on the host and you'd rather not run it via
   Docker first, generate it on your own machine instead — same command,
   needs Node ≥22 — and just copy the output line over.)
4. Fill in your real values — one line at a time, so there's no multi-line
   paste for a hidden character (a stray carriage return from a Windows
   clipboard paste is a common culprit) to get stuck on:
   ```bash
   echo "PORT=3000" > .env
   echo "SESSION_SECRET=paste-a-long-random-string-here" >> .env
   echo "APP_PASSWORD_HASH=paste-the-hash-from-step-3-here" >> .env
   ```
   `openssl rand -hex 32` gives you a good `SESSION_SECRET`. Check it went
   in right with `cat .env` — you should see all three lines intact.
5. Add the DNS record in Cloudflare:
   - Log into the Cloudflare dashboard and select the `megangibbs.net` zone.
   - Go to the **DNS** tab (DNS → Records).
   - Click **Add record**.
   - Type: `A`
   - Name: `mind`
   - IPv4 address: `129.121.121.162`
   - Proxy status: click the orange cloud icon so it turns grey ("DNS
     only") — it needs to stay grey until certbot issues the cert in
     step 7, otherwise Cloudflare's proxy gets in the way of the
     domain-ownership check.
   - Click **Save**.
6. Build and start it:
   ```bash
   docker compose build && docker compose up -d
   ```
   It's bound to `127.0.0.1:3040` (already reserved for Mind Map in your
   port list, alongside 3010/3011/3020/3030/9090/9091 for your other
   apps) — confirm nothing else grabbed it before starting.
7. Add the Apache vhost. Heredocs (`<< 'EOF'`) hang in your terminal, so
   build the file line by line instead:
   ```bash
   VHOST=/etc/apache2/sites-available/mind.megangibbs.net.conf
   echo "<VirtualHost *:80>" > $VHOST
   echo "    ServerName mind.megangibbs.net" >> $VHOST
   echo "    ProxyPreserveHost On" >> $VHOST
   echo "    ProxyPass / http://127.0.0.1:3040/" >> $VHOST
   echo "    ProxyPassReverse / http://127.0.0.1:3040/" >> $VHOST
   echo "</VirtualHost>" >> $VHOST
   ```
   Check it landed right before moving on: `cat $VHOST` should show all
   six lines.

   Then enable it and get the cert:
   ```bash
   a2ensite mind.megangibbs.net.conf
   a2enmod proxy proxy_http
   systemctl reload apache2
   certbot --apache -d mind.megangibbs.net
   ```
   Certbot rewrites the vhost to add the HTTPS block and redirect — say
   yes when it asks about redirecting HTTP to HTTPS. If your other vhosts
   are set up slightly differently (a different module, a shared config
   pattern), match that instead of this template.

   Once the cert's issued, go back to Cloudflare DNS → Records, find the
   `mind` A record you added in step 5, and click the grey cloud icon so
   it turns orange ("Proxied"). Save. Traffic now goes through
   Cloudflare like your other apps.

8. Add the database to backups. Open the same borgmatic config file
   you've added your other apps' `db` folders to (commonly
   `/etc/borgmatic/config.yaml` or a file under `/etc/borgmatic.d/`) and
   add `/opt/mindmap/db` to its `source_directories` list, alongside the
   others. Then check it's picked up:
   ```bash
   borgmatic config validate
   borgmatic --dry-run --verbosity 1
   ```
   That's the whole SQLite database — the only thing in this container
   that isn't reproducible from the image, so it's worth confirming the
   dry run actually lists it before moving on.

### Changing the password later

```bash
cd /opt/mindmap
docker compose run --rm mindmap node scripts/set-password.js "new password"
```
Paste the new `APP_PASSWORD_HASH` into `.env`, then `docker compose up -d`
(or `docker restart mindmap`) to pick it up.

### Updating the app later

Once code changes are pushed to the GitHub repo, pull and rebuild on the
server instead of re-copying files over:

```bash
cd /opt/mindmap
git pull
docker compose build && docker compose up -d
```

`.env` and the `db` folder aren't tracked by git, so a pull never touches
your password hash or your saved maps.

## About deleting the center node

The center node can be edited freely at any time. It can only be *deleted*
once it has no branches attached to it — with nothing above it to reattach
branches to, deleting a populated center would mean either destroying its
whole map or picking one of its children to become the new center
arbitrarily, so it's blocked instead. The Delete button on the center is
disabled (with an explanation on hover) whenever it still has branches;
delete or reattach those branches first, and Delete becomes available.
