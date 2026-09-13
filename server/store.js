// Tiny JSON-file store with debounced, atomic writes.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(file, initial) {
  let data;
  try {
    data = { ...structuredClone(initial), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    data = structuredClone(initial);
  }
  let timer = null;
  return {
    get data() { return data; },
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFile(tmp, JSON.stringify(data), (err) => {
          if (!err) fs.rename(tmp, file, () => {});
        });
      }, 800);
    },
  };
}
