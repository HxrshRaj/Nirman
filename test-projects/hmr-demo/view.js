import './style.css';

const restored = module.hot && module.hot.data ? module.hot.data : null;
let count = restored ? restored.count : 0;
let rootEl = restored ? restored.rootEl : null;
let timer = null;

const LABEL = 'Edit view.js to see this label hot-update live';

function render() {
  if (!rootEl) return;
  rootEl.innerHTML =
    '<h1 class="title">Nirman HMR demo</h1>' +
    '<p>' + LABEL + '</p>' +
    '<p>Tick count (state preserved across hot updates): <b id="count">' + count + '</b></p>';
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    count += 1;
    const countEl = document.getElementById('count');
    if (countEl) countEl.textContent = String(count);
  }, 1000);
}

export function mount(el) {
  rootEl = el;
  render();
  startTimer();
}

// A hot re-execution (triggered by an edit to this file) never calls mount() again --
// only index.js's original module.exports.mount call did that. If we're resuming from
// a hot swap (rootEl was carried over via module.hot.data), re-render and restart the
// timer immediately so the update is visible without a page reload.
if (restored && rootEl) {
  render();
  startTimer();
}

if (module.hot) {
  module.hot.accept();
  module.hot.dispose((data) => {
    data.count = count;
    data.rootEl = rootEl;
    clearInterval(timer);
  });
}
