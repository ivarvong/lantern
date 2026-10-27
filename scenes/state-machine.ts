// Example 1: a WebSocket session state machine inside a Durable Object.
// Diagram on the left, reducer code on the right; a token rides each
// transition while the matching `case` lights up and the readout updates.
import {
  Scene, Group, Labeled, Circle, Text, Dot, Arrow, CurvedArrow, FadeIn, Create, Write, Transform, Indicate,
  MoveAlongPath, LaggedStart, BLUE, TEAL, GREEN, GOLD, RED, GREY, WHITE, YELLOW, UP, DOWN, sub,
  normalize, mul, add,
  title, CodePanel, StateReadout,
} from '../src/index.ts';
import type { Vec } from '../src/index.ts';

const R = 0.55;

/** A state: a named circle with its name inside. */
type StateNode = Labeled<Circle, Text> & { name: string };

function state(name: string, color: string, pos: Vec): StateNode {
  const c = new Circle({ radius: R, stroke: color, strokeWidth: 0.05, fill: color, fillOpacity: 0.12 });
  // Shrink long names to fit the circle (mono glyphs ≈ 0.6em wide)
  const fontSize = Math.min(0.26, (2 * R * 0.8) / (name.length * 0.6));
  const t = new Text(name, { fontSize, font: 'mono', color: WHITE });
  return Object.assign(new Labeled(c, t).moveTo(pos), { name });
}

/** Arrow between circle boundaries. */
function edge(a: StateNode, b: StateNode, { curve = 0, color = GREY }: { curve?: number; color?: string } = {}): Arrow | CurvedArrow {
  const ca = a.center(), cb = b.center();
  const d = normalize(sub(cb, ca));
  const s = add(ca, mul(d, R + 0.08)), e = sub(cb, mul(d, R + 0.08));
  return curve ? new CurvedArrow(s, e, { angle: curve, stroke: color }) : new Arrow(s, e, { stroke: color });
}

export class StateMachineScene extends Scene {
  override async construct() {
    const sm: { state: string; event: string | null; error?: string } = { state: 'idle', event: null };
    this.state = sm;
    await this.step('intro');
    const t = title('Durable Object session: state machine ↔ reducer');
    await this.play(new Write(t), { runTime: 1 });

    // --- states -----------------------------------------------------------
    const idle = state('idle', GREY, [-6.2, 1.6]);
    const connecting = state('connecting', BLUE, [-3.4, 1.6]);
    const open = state('open', GREEN, [-3.4, -1.4]);
    const closed = state('closed', RED, [-6.2, -1.4]);

    const eConnect = edge(idle, connecting);
    const eOpen = edge(connecting, open);
    const eClose = edge(open, closed);
    const eErr = edge(connecting, closed, { curve: 0.9, color: RED });
    const labels = [
      new Text('CONNECT', { fontSize: 0.2, font: 'mono', color: GREY }).nextTo(eConnect, UP, 0.08),
      new Text('OPENED', { fontSize: 0.2, font: 'mono', color: GREY }).nextTo(eOpen, [1, 0], 0.1),
      new Text('CLOSE', { fontSize: 0.2, font: 'mono', color: GREY }).nextTo(eClose, UP, 0.08),
      new Text('ERROR', { fontSize: 0.2, font: 'mono', color: RED }).moveTo([-7.35, 0.15]),
    ];

    await this.play(new LaggedStart([idle, connecting, open, closed].map((s) => new FadeIn(s, { scale: 0.7 })), { lagRatio: 0.3 }), { runTime: 1.2 });
    await this.play(new LaggedStart([eConnect, eOpen, eClose, eErr].map((e) => new Create(e)), { lagRatio: 0.3 }), new FadeIn(new Group(...labels)), { runTime: 1.4 });

    // --- code + readout -----------------------------------------------------
    const code = new CodePanel([
      'function reduce(state, event) {',
      '  switch (`${state}:${event.type}`) {',
      "    case 'idle:CONNECT':       return 'connecting';",
      "    case 'connecting:OPENED':  return 'open';",
      "    case 'connecting:ERROR':   return 'closed';",
      "    case 'open:CLOSE':         return 'closed';",
      '    default: throw new InvalidTransition(state, event);',
      '  }',
      '}',
    ], { fontSize: 0.24, at: [3.3, 1.6] });
    const readout = new StateReadout([['state', 'idle'], ['event', '—']], { fontSize: 0.3, at: [3.3, -1.6] });
    await this.play(new FadeIn(code, { shift: [0.3, 0] }), new FadeIn(readout, { shift: [0.3, 0] }), { runTime: 0.8 });

    // --- drive transitions ----------------------------------------------------
    const token = new Dot({ radius: 0.13, color: YELLOW }).moveTo(idle);
    await this.play(new FadeIn(token, { scale: 0.3 }), new Indicate(idle.shape, { color: YELLOW, scaleFactor: 1.1 }), { runTime: 0.6 });

    const transition = async (from: StateNode, to: StateNode, arrow: Arrow | CurvedArrow, caseLine: number, ev: string, next: string, { ms = 1 }: { ms?: number } = {}) => {
      await this.step(ev.toLowerCase(), { from: from.name, to: to.name, event: ev, line: caseLine });
      const evText = new Text(ev, { fontSize: 0.3, font: 'mono', color: YELLOW, anchor: 'start' }).moveTo(readout.values.event!, [-1, 0]);
      sm.event = ev;
      await this.play(new Transform(readout.values.event!, evText), code.focus(caseLine), { runTime: 0.5 });
      const path = arrow instanceof CurvedArrow ? arrow.arc : arrow.line;
      const nextText = new Text(next, { fontSize: 0.3, font: 'mono', color: WHITE, anchor: 'start' }).moveTo(readout.values.state!, [-1, 0]);
      await this.play(new MoveAlongPath(token, path), new Indicate(arrow, { color: YELLOW, scaleFactor: 1 }), { runTime: 0.9 * ms });
      sm.state = next;
      await this.play(token.animate.moveTo(to), new Indicate(to.shape, { color: YELLOW, scaleFactor: 1.1 }), new Transform(readout.values.state!, nextText), { runTime: 0.5 });
    };

    await transition(idle, connecting, eConnect, 2, 'CONNECT', 'connecting');
    await this.wait(0.3);
    await transition(connecting, open, eOpen, 3, 'OPENED', 'open');
    await this.wait(0.3);
    await transition(open, closed, eClose, 5, 'CLOSE', 'closed');
    await this.wait(0.4);

    // Illegal transition from closed: the default case
    await this.step('invalid', { from: 'closed', event: 'OPENED', line: 6 });
    const bad = new Text('OPENED', { fontSize: 0.3, font: 'mono', color: RED, anchor: 'start' }).moveTo(readout.values.event!, [-1, 0]);
    sm.event = 'OPENED'; sm.error = 'InvalidTransition';
    await this.play(new Transform(readout.values.event!, bad), code.focus(6, RED), { runTime: 0.5 });
    await this.play(new Indicate(closed.shape, { color: RED, scaleFactor: 1.15 }), new Indicate(token, { color: RED }), { runTime: 0.8 });
    const note = new Text('closed is terminal: every event throws', { fontSize: 0.28, color: RED }).moveTo([-4.8, -3.2]);
    await this.play(new FadeIn(note, { shift: [0, -0.2] }));
    await this.wait(1.5);
  }
}
