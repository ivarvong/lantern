// Registry of example scenes, keyed by the names the player and renderer use.
import { CacheMRScene } from './mr-cache.ts';
import { StateMachineScene } from './state-machine.ts';
import { TokenBucketScene } from './token-bucket.ts';
import { sceneFromDoc } from '../src/index.ts';
import type { Doc, SceneClass } from '../src/index.ts';
import { ringBufferDoc } from './ring-buffer.doc.ts';
import { GlyphScene } from './glyph.ts';
import { PyexLimitsScene } from './pyex-limits.ts';
import { JustBashScene } from './just-bash.ts';
import { ExgitScene } from './exgit.ts';
import { LanternScene } from './lantern.ts';
import { plyViewerDoc } from './ply-viewer.doc.ts';

/** A registered scene: the player's label, the class, and the doc for doc scenes. */
export interface SceneEntry { label: string; Scene: SceneClass; doc?: Doc }

export const SCENES: Record<string, SceneEntry> = {
  'lantern': { label: 'Lantern, drawn by Lantern', Scene: LanternScene },
  'exgit': { label: 'exgit: git from the inside', Scene: ExgitScene },
  'ply-viewer': { label: 'ply /view: a public git repo', Scene: sceneFromDoc(plyViewerDoc), doc: plyViewerDoc },
  'just-bash': { label: 'just_bash: a bash with no processes', Scene: JustBashScene },
  'pyex-limits': { label: 'pyex #29: cooperative resource limits', Scene: PyexLimitsScene },
  'mr-cache': { label: 'MR: KV cache in front of D1', Scene: CacheMRScene },
  'state-machine': { label: 'State machine ↔ reducer', Scene: StateMachineScene },
  'token-bucket': { label: 'Token bucket rate limiter', Scene: TokenBucketScene },
  'glyph-text': { label: 'Real text: outlines, Write, morph', Scene: GlyphScene },
  'ring-buffer': { label: 'Ring buffer (JSON doc)', Scene: sceneFromDoc(ringBufferDoc), doc: ringBufferDoc },
};
