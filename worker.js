import { validateSession } from './core.js';
self.onmessage = ({ data }) => {
  try {
    const started = performance.now(),
      answer = validateSession(data);
    self.postMessage({ ...answer, milliseconds: performance.now() - started });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
