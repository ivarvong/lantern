// Wire layout of test/fixtures/viewer/small.pack (ply @ 3f07a75, 930 bytes).
// Kinds are the pack's object types, not the types applyDelta resolves them to.
// The ref-delta at 383 bases on the commit at 12. It stays a ref-delta.

export type PackWire = 'commit' | 'tree' | 'blob' | 'tag' | 'ofs_delta' | 'ref_delta';

export interface PackWireObject {
  offset: number;
  length: number;
  kind: PackWire;
  /** Present when kind is ref_delta: the 40-hex base, copied from the pack header. */
  baseOid?: string;
}

export const PACK_BYTES = 930;
export const PACK_HEADER = 12;
export const PACK_TRAILER = 20;

/** oid of the commit stored whole at offset 12. The ref-delta names this base. */
export const PACK_COMMIT_OID = '4ce20682b4778f9086b59216533e2ccff8dbb191';

export const PACK_OBJECTS: readonly PackWireObject[] = [
  { offset: 12, length: 371, kind: 'commit' },
  { offset: 383, length: 183, kind: 'ref_delta', baseOid: PACK_COMMIT_OID },
  { offset: 566, length: 108, kind: 'tree' },
  { offset: 674, length: 15, kind: 'blob' },
  { offset: 689, length: 27, kind: 'blob' },
  { offset: 716, length: 43, kind: 'tree' },
  { offset: 759, length: 16, kind: 'blob' },
  { offset: 775, length: 108, kind: 'tree' },
  { offset: 883, length: 27, kind: 'blob' },
];

export function wireName(kind: PackWire): string {
  if (kind === 'ref_delta') return 'ref-delta';
  if (kind === 'ofs_delta') return 'ofs-delta';
  return kind;
}
