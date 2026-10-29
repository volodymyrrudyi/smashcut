type Listener = () => void;

let current = 0;
const listeners = new Set<Listener>();

export const frameStore = {
  get: () => current,
  set(frame: number) {
    if (frame === current) return;
    current = frame;
    listeners.forEach((l) => l());
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
