// Own-property scene lookup for the CLIs. A missing name exits 2 with the
// registry; it is never treated as a constructor.
import { SCENES, sceneByName } from '../scenes/index.ts';
import type { SceneEntry } from '../scenes/index.ts';

export function requireScene(name: string): SceneEntry {
  const entry = sceneByName(name);
  if (!entry) {
    console.error(`unknown scene\nscenes: ${Object.keys(SCENES).join(', ')}`);
    process.exit(2);
  }
  return entry;
}
