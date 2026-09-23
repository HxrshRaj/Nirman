const SAMPLE_TASKS = [
  { id: 1, title: 'Write the resolver', done: true },
  { id: 2, title: 'Write the bundler', done: true },
  { id: 3, title: 'Wire up HMR', done: true },
  { id: 4, title: 'Ship the demo app', done: false },
];

/** A real async operation: simulates a network round-trip with a delay. */
export function fetchTasks() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(SAMPLE_TASKS.map((t) => ({ ...t }))), 600);
  });
}

export function toggleTaskOnServer(id, done) {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ id, done }), 200);
  });
}
