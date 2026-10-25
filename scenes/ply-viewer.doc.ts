// ply /view: the public read-only repo viewer.
//
// Source: ivarvong/ply pull/2, commit 3f07a75c667ab8afad9e91d396836eb21abb1b8f
// (branch cursor/public-repo-viewer-f77d). Behaviour below is that diff:
// worker/viewer/{url,fetchguard,route,session,packmap,html,escape,limits,traceview}.ts
// and test/viewer.test.ts. The 438 / 443 / 505 ms bars and the 29 ms / 1,555 ms
// split are one slow Workers trace of that shape (ls-refs, tree:0 → 400,
// blob:none), not a number the page hardcodes.
import type { Doc, DocOp, DocStep } from '../src/index.ts';

type Vec = [number, number];

const noteAt: Vec = [0, -3.62];
const note = (text: string, color = 'grey'): DocOp => ({ note: text, at: noteAt, color });

function chip(id: string, label: string, at: Vec, color: string, fontSize = 0.24, height = 0.64): DocOp {
  return { add: { id, kind: 'box', label, at, color, fontSize, height } };
}
function line(id: string, label: string, at: Vec, color = 'grey', fontSize = 0.24): DocOp {
  return { add: { id, kind: 'value', label, at, color, fontSize } };
}
function drop(...ids: string[]): DocOp[] {
  return ids.map((id) => ({ remove: id }));
}

const hosts = ['gh', 'gl', 'cb', 'bb', 'sr', 'evil', 'dot', 'port', 'userinfo', 'ip', 'xhost', 'extraOff'] as const;
const creds = ['auth', 'token', 'cookie', 'gauth', 'ua'] as const;
const calls = ['discover', 'lsrefs', 'prefixes'] as const;
const fetchIds = ['f0', 's400', 'f1', 's200', 'retry'] as const;
const packIds = ['hdr', 'objs', 'trail', 'ask'] as const;
// verify-pack -v on test/fixtures/viewer/small.pack (930 B, trailer a470ee96…).
// offset, on-wire length, resolved or wire type. Object 1 is a ref-delta of object 0.
const PACK: ReadonlyArray<readonly [string, number, number, string, string]> = [
  ['p0', 0, 12, '', 'white'],
  ['p1', 12, 371, 'commit', 'blue'],
  ['p2', 383, 183, 'ref', 'red'],
  ['p3', 566, 108, 'tree', 'green'],
  ['p4', 674, 15, '', 'grey'],
  ['p5', 689, 27, '', 'grey'],
  ['p6', 716, 43, '', 'green'],
  ['p7', 759, 16, '', 'grey'],
  ['p8', 775, 108, 'tree', 'green'],
  ['p9', 883, 27, '', 'grey'],
  ['p10', 910, 20, '', 'white'],
];
const packScale = 12.8 / 930;
const packX0 = -6.4;
const packBar = PACK.map(([id, off, len, label, color]) => {
  const width = +(len * packScale).toFixed(3);
  const x = +(packX0 + (off + len / 2) * packScale).toFixed(3);
  return { add: { id, kind: 'box' as const, label, at: [x, 2.2] as Vec, color, width, height: 0.58, fontSize: label ? 0.2 : 0.01 } };
});
const mapIds = [...PACK.map(([id]) => id), 'legend', 'o0', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o9', 'dbase'] as const;
const renderIds = ['raw', 'esc', 'arrow2', 'msg', 'csp1', 'csp2', 'csp3', 'csp4'] as const;
const traceIds = ['sum', 'b0', 'b1', 'b2', 'n0', 'n1', 'n2', 'cpu'] as const;
const limitIds = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'rate', 'closed'] as const;
const endIds = ['e0', 'e1', 'e2', 'e3', 'e4'] as const;

// Serial waterfall for the measured read. 438 + 443 + 505 = 1386 ms across 13 units.
const bar = (ms: number, startMs: number): { at: Vec; width: number } => {
  const x0 = -6.4;
  const scale = 13 / 1386;
  const width = +(ms * scale).toFixed(3);
  const x = +(x0 + startMs * scale + width / 2).toFixed(3);
  return { at: [x, 0], width };
};
const bLs = bar(438, 0);
const bTree = bar(443, 438);
const bBlob = bar(505, 438 + 443);

const steps: DocStep[] = [
  {
    name: 'url',
    meta: {
      caption: 'The box takes octocat/Hello-World, a URL, or git@host:path. owner/repo means GitHub. No token, and the allowlist still decides.',
      route: '/view/:host/:repo',
    },
    ops: [
      [
        ...drop('hint'),
        line('paste', 'octocat/Hello-World', [0, -0.55], 'gold', 0.28),
        line('forms', 'URL · github.com/owner/repo · git@host:path', [0, -1.4], 'grey', 0.22),
        { indicate: 'url', color: 'teal' },
        { set: { host: 'github.com' } },
        note('owner/repo means GitHub · no token'),
      ],
    ],
  },
  {
    name: 'allowlist',
    meta: {
      caption: 'Only an exact hostname is fetched. Extra hosts are off. Userinfo, a port, a trailing dot, a lookalike, or another host stops before any request.',
      host: 'github.com',
      match: 'exact',
    },
    ops: [
      [
        ...drop('paste', 'forms'),
        { move: { id: 'url', at: [0, 2.62] } },
        chip('gh', 'github.com', [-5, 1.4], 'green', 0.2, 0.52),
        chip('gl', 'gitlab.com', [-2.5, 1.4], 'teal', 0.2, 0.52),
        chip('cb', 'codeberg.org', [0, 1.4], 'teal', 0.2, 0.52),
        chip('bb', 'bitbucket.org', [2.5, 1.4], 'teal', 0.2, 0.52),
        chip('sr', 'git.sr.ht', [5, 1.4], 'teal', 0.2, 0.52),
        chip('evil', 'github.com.evil.com', [-3.5, 0.4], 'red', 0.2, 0.52),
        chip('dot', 'github.com.', [-0.3, 0.4], 'red', 0.2, 0.52),
        chip('port', 'port 8443', [2.3, 0.4], 'red', 0.2, 0.52),
        chip('userinfo', 'user:…@', [-3.3, -0.55], 'red', 0.2, 0.52),
        chip('ip', '127.0.0.1', [0, -0.55], 'red', 0.2, 0.52),
        chip('xhost', 'cross-host', [3.2, -0.55], 'red', 0.2, 0.52),
        line('extraOff', 'VIEWER_EXTRA_HOSTS off', [0, -1.55], 'gold', 0.24),
        { set: { allowed: 'yes', extra: 'off' } },
        note('rejected before any fetch · a cross-host redirect is not followed'),
      ],
      { indicate: 'gh', color: 'green' },
      { indicate: 'evil', color: 'red' },
    ],
  },
  {
    name: 'strip',
    meta: {
      caption: 'Those four are dropped. User-Agent becomes ply-viewer/0.1.0. A secret in a rejected URL is not echoed.',
      credential: 'absent',
    },
    ops: [
      [
        ...drop(...hosts),
        chip('auth', 'Authorization', [-2.35, 1.05], 'red', 0.22),
        chip('token', 'Git-Token', [2.35, 1.05], 'red', 0.22),
        chip('cookie', 'Cookie', [-2.35, 0.1], 'red', 0.22),
        chip('gauth', 'Git-Authorization', [2.35, 0.1], 'red', 0.22),
        line('ua', 'User-Agent: ply-viewer/0.1.0', [0, -1.15], 'grey', 0.24),
        { set: { credential: 'absent' } },
        note('never read · never sent upstream'),
      ],
    ],
  },
  {
    name: 'ls-refs',
    meta: {
      caption: 'Discover, then HEAD and refs/heads. Quirks stay on this request, so a filter refusal stays visible. /v1 would hide it after the first time.',
      command: 'ls-refs',
    },
    ops: [
      [
        ...drop(...creds),
        chip('discover', 'discover', [0, 1.15], 'blue', 0.28, 0.7),
        chip('lsrefs', 'ls-refs', [0, 0.05], 'blue', 0.28, 0.7),
        line('prefixes', 'HEAD · refs/heads/', [0, -1.15], 'grey', 0.26),
        note('discover, then the names'),
      ],
    ],
  },
  {
    name: 'fetch',
    meta: {
      caption: 'The commit asks for tree:0. If the server only allows blob:none, this request retries once. Both calls stay in the trace.',
      requested: 'tree:0',
      http: 400,
      retry: 'blob:none',
    },
    ops: [
      [
        ...drop(...calls),
        chip('f0', 'filter tree:0', [-2.3, 0.85], 'gold', 0.26),
        chip('s400', 'HTTP 400', [2.3, 0.85], 'red', 0.26),
        line('retry', 'retry once', [0, -0.15], 'gold', 0.26),
        chip('f1', 'filter blob:none', [-2.3, -1.15], 'teal', 0.26),
        chip('s200', 'HTTP 200', [2.3, -1.15], 'green', 0.26),
        { set: { filter: 'blob:none', http: '400 then 200' } },
        note('tree:0 refused → blob:none · both stay visible'),
      ],
    ],
  },
  {
    name: 'pack',
    meta: {
      caption: 'Twelve bytes, the objects, twenty bytes of SHA-1. The client asks for ofs-delta and does not ask for a thin pack.',
    },
    ops: [
      [
        ...drop('url', ...fetchIds),
        chip('hdr', 'PACK · 12 B', [-3.6, 0.45], 'grey', 0.26),
        chip('objs', 'objects', [0, 0.45], 'teal', 0.26),
        chip('trail', 'SHA-1 · 20 B', [3.6, 0.45], 'grey', 0.26),
        line('ask', 'ofs-delta yes · thin pack no', [0, -0.9], 'grey', 0.26),
        note('header, objects, trailer checksum'),
      ],
    ],
  },
  {
    name: 'map',
    meta: {
      caption: 'Each segment has a tooltip, and a click jumps to that row. The ref-delta at 383 is the commit at 12, depth 1.',
      bytes: 930,
      objects: 9,
      refDelta: 1,
    },
    ops: [
      [
        ...drop(...packIds),
        ...packBar,
        line('legend', 'header · commit · tree · blob · tag · ofs delta · ref delta · trailer', [0, 1.52], 'grey', 0.16),
        line('o0', '@12  commit  371 B', [-3.5, 0.95], 'blue', 0.2),
        line('o1', '@383  ref-delta  183 B', [-3.5, 0.52], 'red', 0.2),
        line('o2', '@566  tree  108 B', [-3.5, 0.09], 'green', 0.2),
        line('o3', '@674  blob  15 B', [-3.5, -0.34], 'grey', 0.2),
        line('o4', '@689  blob  27 B', [-3.5, -0.77], 'grey', 0.2),
        line('o5', '@716  tree  43 B', [2.9, 0.95], 'green', 0.2),
        line('o6', '@759  blob  16 B', [2.9, 0.52], 'grey', 0.2),
        line('o7', '@775  tree  108 B', [2.9, 0.09], 'green', 0.2),
        line('o8', '@883  blob  27 B', [2.9, -0.34], 'grey', 0.2),
        line('o9', '@910  trailer  20 B', [2.9, -0.77], 'white', 0.2),
        line('dbase', 'ref-delta @383 → commit @12 · depth 1', [0, -1.6], 'red', 0.22),
        { set: { objects: 9 } },
        note('930 B · trailer a470ee96 · widths follow the bytes'),
      ],
    ],
  },
  {
    name: 'render',
    meta: {
      caption: 'Names stay text. script-src is one sha256. That script only highlights a line or a pack row, and copies a permalink.',
    },
    ops: [
      [
        ...drop(...mapIds),
        chip('raw', '<script>.txt', [-3.1, 1.15], 'gold', 0.26),
        line('arrow2', '→', [0, 1.15], 'grey', 0.36),
        chip('esc', '&lt;script&gt;.txt', [3.15, 1.15], 'green', 0.24),
        line('msg', '&lt;script&gt;alert(1)&lt;/script&gt;', [0, 0.05], 'grey', 0.24),
        line('csp1', "default-src 'none'; style-src 'self'", [0, -0.7], 'teal', 0.2),
        line('csp2', "script-src 'sha256-3FejXQGeGPnTxIrm9basdz7OIIAsmgSP0IF+nvjOJ3I='", [0, -1.2], 'teal', 0.16),
        line('csp3', "img-src 'none'; connect-src 'none'; base-uri 'none'", [0, -1.7], 'teal', 0.18),
        line('csp4', "form-action 'self'; frame-ancestors 'none'", [0, -2.2], 'teal', 0.18),
        note('escaped · one hashed script · raw=1 is not a page'),
      ],
    ],
  },
  {
    name: 'trace',
    meta: {
      caption: 'The trace starts open, under a pill of calls, time, and retries. Bars are to scale. This read was serial.',
      cpuMs: 29,
      clientMs: 1555,
    },
    ops: [
      [
        ...drop(...renderIds),
        chip('sum', '3 upstream calls · 1.4 s · 1 retry', [0, 2.72], 'grey', 0.2, 0.48),
        line('n0', 'ls-refs', [bLs.at[0], 1.95], 'blue', 0.24),
        { add: { id: 'b0', kind: 'box', label: '438 ms', at: [bLs.at[0], 1.35], color: 'blue', fontSize: 0.22, height: 0.48, width: bLs.width } },
        line('n1', 'fetch tree:0', [bTree.at[0], 0.95], 'red', 0.24),
        { add: { id: 'b1', kind: 'box', label: '443 ms · 400', at: [bTree.at[0], 0.35], color: 'red', fontSize: 0.22, height: 0.48, width: bTree.width } },
        line('n2', 'fetch blob:none', [bBlob.at[0], -0.05], 'gold', 0.24),
        { add: { id: 'b2', kind: 'box', label: '505 ms', at: [bBlob.at[0], -0.65], color: 'gold', fontSize: 0.22, height: 0.48, width: bBlob.width } },
        line('cpu', 'CPU 29 ms · client 1,555 ms', [0, -1.85], 'grey', 0.26),
        { set: { cpuMs: 29, clientMs: 1555 } },
        note('serial round trips · the page draws them to scale'),
      ],
    ],
  },
  {
    name: 'limits',
    meta: {
      caption: 'Past a cap, the page stops and keeps the trace. ViewerRateLimit counts the client by a hash, not by storing the address. If it is missing, the answer is 503 before any fetch.',
      upstream: '4MiB',
      calls: 16,
    },
    ops: [
      [
        ...drop(...traceIds),
        chip('c0', '4 MiB upstream', [-4.7, 1.35], 'teal', 0.2, 0.58),
        chip('c1', '2 MiB pack', [-1.55, 1.35], 'teal', 0.2, 0.58),
        chip('c2', '400 objects', [1.55, 1.35], 'teal', 0.2, 0.58),
        chip('c3', '256 KiB file', [4.7, 1.35], 'teal', 0.2, 0.58),
        chip('c4', 'depth 32', [-4.7, 0.35], 'gold', 0.2, 0.58),
        chip('c5', '16 calls', [-1.55, 0.35], 'gold', 0.2, 0.58),
        chip('c6', '12 s / call', [1.55, 0.35], 'gold', 0.2, 0.58),
        chip('c7', '20 s / page', [4.7, 0.35], 'gold', 0.2, 0.58),
        chip('c8', 'ViewerRateLimit', [0, -0.65], 'blue', 0.22, 0.58),
        line('rate', '60/min page · 20/min pack · hash, not the address', [0, -1.45], 'grey', 0.22),
        chip('closed', '503 if missing', [0, -2.25], 'red', 0.22, 0.55),
        note('a cache hit spends no subrequest · errors keep the trace'),
      ],
    ],
  },
  {
    name: 'end',
    meta: {
      caption: 'The page is a tree with a branch switcher, a pack map, and a trace you can fold. Colors follow the system. /v1 is unchanged.',
    },
    ops: [
      [
        ...drop(...limitIds),
        chip('e0', 'exact host', [-4.8, 0.35], 'green', 0.22),
        chip('e1', 'no credential', [-2.4, 0.35], 'red', 0.22),
        chip('e2', 'tree', [0, 0.35], 'teal', 0.22),
        chip('e3', 'pack map', [2.4, 0.35], 'gold', 0.22),
        chip('e4', 'trace', [4.8, 0.35], 'blue', 0.22),
        { set: { v1: 'unchanged' } },
        note('/v1 unchanged · folds · system theme'),
      ],
    ],
  },
];

export const plyViewerDoc: Doc = {
  title: 'ply /view: a public repo, and the git it calls',
  nodes: {
    url: { kind: 'box', label: '/view/github.com/octocat/Hello-World', at: [0, 0.55], color: 'teal', fontSize: 0.3, height: 0.85 },
    hint: { kind: 'text', label: 'public page · no PLY_TOKEN', at: [0, -0.7], color: 'grey', fontSize: 0.28 },
  },
  state: { host: '—', allowed: '—', extra: '—', credential: '—', filter: '—', http: '—', objects: 0, cpuMs: 0, clientMs: 0, v1: '—' },
  noteAt,
  outro: 0.4,
  steps,
};
