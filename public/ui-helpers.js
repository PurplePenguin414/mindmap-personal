// Shared inline replacements for window.confirm()/alert() — no native
// browser popups anywhere in this app.

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-confirm-overlay';
    overlay.innerHTML = `
      <div class="ui-confirm-box">
        <p></p>
        <div class="ui-confirm-actions">
          <button class="ui-cancel">Cancel</button>
          <button class="ui-ok danger">Confirm</button>
        </div>
      </div>
    `;
    overlay.querySelector('p').textContent = message;
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('.ui-cancel').onclick = () => cleanup(false);
    overlay.querySelector('.ui-ok').onclick = () => cleanup(true);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

function getToastContainer() {
  let el = document.getElementById('uiToastContainer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'uiToastContainer';
    el.className = 'ui-toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showError(message, opts) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = 'ui-toast' + (opts && opts.info ? ' info' : '');
  toast.innerHTML = `<span></span><button>✕</button>`;
  toast.querySelector('span').textContent = message;
  const remove = () => toast.remove();
  toast.querySelector('button').onclick = remove;
  container.appendChild(toast);
  setTimeout(remove, 6000);
}
