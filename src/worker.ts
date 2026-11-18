import { generateRoster } from './engine/generate';

self.onmessage = (e: MessageEvent) => {
  const { id, data, month, opts } = e.data;
  try {
    const result = generateRoster(data, month, opts);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
