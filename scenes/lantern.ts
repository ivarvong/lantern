// Lantern explains Lantern: its architecture as a mermaid flowchart, parsed,
// laid out and drawn by Lantern itself, then walked with tokens that travel
// along the diagram's own edges.
//
// Fidelity: every hop a token makes is recorded in this.state.hops, and
// test/fidelity.test.ts requires each hop to be an edge of the parsed chart,
// so the animation cannot show a connection the diagram does not have.
import {
  Scene, Group, Text, Code, Dot, FadeIn, FadeOut, Transform, Indicate, MoveAlongPath, LaggedStart, Write,
  flowchart, UP, DOWN, GOLD, GREEN, RED, BLUE, TEAL, GREY, WHITE, YELLOW,
} from '../src/index.ts';
import type { Playable, VMobject } from '../src/index.ts';

export const ARCHITECTURE = `flowchart TB
  classDef src fill:#1b2733,stroke:#58c4dd,color:#ffffff
  classDef core fill:#16261f,stroke:#5cd0b3,color:#ffffff
  classDef out fill:#2a2216,stroke:#f0ac5f,color:#ffffff
  classDef check fill:#2a1a1a,stroke:#fc6255,color:#ffffff

  subgraph source["what you explain"]
    P["the program<br/>allow(), git objects, a PR"]:::src
    D["doc.json<br/>nodes · edges · ops"]:::src
  end
  subgraph lantern["lantern: zero deps, pure ES"]
    S["Scene<br/>steps · captions · state"]:::core
    A["Animations<br/>pure in alpha"]:::core
    M["Mobjects<br/>points · style · glyphs"]:::core
    F["frame loop<br/>fixed dt · exact seek"]:::core
  end
  subgraph sinks["sinks"]
    DOM["DomSink<br/>live SVG"]:::out
    STR["StringSink<br/>SVG strings"]:::out
    TXT["renderText<br/>monospace"]:::out
    TR["TraceSink<br/>steps · state"]:::out
  end
  subgraph runs["where it runs"]
    PL["player<br/>?scene=&step="]:::out
    WK["Worker<br/>/frame.svg /trace.json"]:::out
    AG["agents<br/>transcript · trace"]:::out
  end
  subgraph checks["verifiers"]
    V1["fidelity<br/>program · git · manim"]:::check
    V2["properties<br/>random scenes"]:::check
    V3["motion · playback"]:::check
  end
  P -- "runs it, or models it" --> S
  D -- "sceneFromDoc" --> S
  S --> A --> M
  S --> M
  M --> F
  F --> DOM & STR & TXT & TR
  DOM --> PL
  STR --> WK
  TXT & TR --> AG
  TR --> V1
  P -. "oracle" .-> V1
  F --> V2 & V3`;

export class LanternScene extends Scene {
  override async construct() {
    const st: { phase: string; hops: Array<[from: string, to: string]>; camera?: string } = { phase: 'source', hops: [] };
    this.state = st;

    // ---- 1. the source -----------------------------------------------------------
    await this.step('source', { caption: 'This diagram starts as text: a Mermaid flowchart, the same syntax you would paste into a README. Lantern parses it itself, with a parser checked against Mermaid\'s own on two thousand generated charts.' });
    const lines = ARCHITECTURE.split('\n').filter((l) => !/classDef/.test(l) && l.trim());
    const excerpt = new Code([...lines.slice(0, 7), '  …', ...lines.slice(-9, -2)], { fontSize: 0.2, color: '#c8c8c8' }).moveTo([0, 0.2]);
    for (const l of excerpt.lines) if (/-->|-\.|&/.test(l.text)) l.setFill('#f0ac5f');
    await this.play(new FadeIn(excerpt, { shift: [0, -0.2] }), { runTime: 0.8 });
    await this.wait(0.5);

    // ---- 2. layout -------------------------------------------------------------------
    await this.step('layout', { caption: 'Then it lays the graph out the way Mermaid does: nodes in ranks so every arrow points downstream, each rank ordered to cut crossings, positions solved exactly by least squares, subgraphs kept together. Every box and arrow is an ordinary Lantern shape, so the diagram builds itself in.' });
    await this.play(new FadeOut(excerpt, { shift: [0, 0.3] }), { runTime: 0.5 });
    const chart = flowchart(ARCHITECTURE, { width: 15.2, height: 8.3, fontSize: 0.24, layout: { rankSep: 0.6, clusterPad: 0.16, nodeSep: 0.35 } });
    for (const stage of chart.reveal()) await this.play(new LaggedStart(stage, { lagRatio: 0.12 }), { runTime: 0.9 });
    st.phase = 'built';
    await this.wait(0.4);

    // Tokens travel along the chart's own edges; each hop is recorded and tested
    const hop = (from: string, to: string, token: Dot, color: string): Playable[] => {
      const edge = chart.edge(from, to);
      if (!edge) throw new Error(`no edge ${from} -> ${to} in the chart`);
      st.hops.push([from, to]);
      const path = edge.children[0] as VMobject; // an edge is [path, arrowheads..., label?]
      return [new MoveAlongPath(token, path), path.animate.setStroke(color, 0.045)];
    };
    const token = (at: string, color = GOLD) => new Dot({ radius: 0.09, color }).moveTo(chart.node(at).shape.center());
    const light = (id: string, color: string) => new Indicate(chart.node(id).shape, { color, scaleFactor: 1.06 });
    // A camera move: the chart is one mobject, so glide it until these nodes fill the frame.
    // A neighbor whose label would land half on screen is pulled in too. Leaving it
    // there cuts the word on the frame edge.
    const focus = (ids: string[], { w = 15.2, h = 8.3, maxZoom = 2.2 }: { w?: number; h?: number; maxZoom?: number } = {}) => {
      const members = new Set(ids);
      const hx = this.frame.w / 2, hy = this.frame.h / 2;
      for (let guard = 0; guard < 6; guard++) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const id of members) {
          const b = chart.node(id).box()!;
          x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
        }
        const k = Math.min(maxZoom, w / (x1 - x0 + 0.8), h / (y1 - y0 + 0.8));
        const s: [number, number] = [-(x0 + x1) / 2, -(y0 + y1) / 2];
        let grew = false;
        for (const id of chart.nodeIds) {
          if (members.has(id)) continue;
          const b = chart.node(id).box();
          if (!b) continue;
          const X0 = k * (b[0] + s[0]), Y0 = k * (b[1] + s[1]), X1 = k * (b[2] + s[0]), Y1 = k * (b[3] + s[1]);
          const past = Math.max(-hx - X0, -hy - Y0, X1 - hx, Y1 - hy, 0);
          if (past <= 0.12) continue;
          const visW = Math.min(X1, hx) - Math.max(X0, -hx);
          const visH = Math.min(Y1, hy) - Math.max(Y0, -hy);
          if (visW < 0.2 || visH < 0.08) continue;
          members.add(id);
          grew = true;
        }
        if (grew) continue;
        st.camera = ids.join(',');
        return chart.animate.shift(s).scale(k, { aboutPoint: [0, 0] });
      }
      throw new Error('focus() could not keep labels inside the frame');
    };
    const ALL = chart.nodeIds;

    // ---- 3. a scene runs ----------------------------------------------------------------
    await this.step('engine', { caption: 'Follow one frame. The program you are explaining drives a Scene. The scene plays animations, which are pure functions of time over shapes made of points. A fixed time step makes every frame reproducible, which is why you can jump to any step and get exactly that frame.' });
    await this.play(focus(['P', 'D', 'S', 'A', 'M', 'F']), { runTime: 1.4 });
    let t = token('P');
    await this.play(new FadeIn(t, { scale: 0.4 }), light('P', GOLD), { runTime: 0.5 });
    for (const [a, b] of [['P', 'S'], ['S', 'A'], ['A', 'M'], ['M', 'F']] as const) {
      await this.play(...hop(a, b, t, GOLD), { runTime: 0.7 });
      await this.play(light(b, GOLD), { runTime: 0.35 });
    }
    st.phase = 'frame';

    // ---- 4. sinks ---------------------------------------------------------------------------
    await this.step('sinks', { caption: 'Each frame goes to a sink, and the sink decides what a frame means: a live SVG in the page, an SVG string on a server, a grid of text an agent can read, or a trace of every step and its state.' });
    await this.play(new FadeOut(t), { runTime: 0.3 });
    await this.play(focus(['M', 'F', 'DOM', 'STR', 'TXT', 'TR']), { runTime: 1.2 });
    const fan = (['DOM', 'STR', 'TXT', 'TR'] as const).map((id): [typeof id, Dot] => [id, token('F', id === 'TR' ? TEAL : GOLD)]);
    await this.play(...fan.map(([, k]) => new FadeIn(k, { scale: 0.4 })), { runTime: 0.3 });
    await this.play(...fan.flatMap(([id, k]) => hop('F', id, k, id === 'TR' ? TEAL : GOLD)), { runTime: 0.9 });
    st.phase = 'sinks';

    // ---- 5. surfaces --------------------------------------------------------------------------
    await this.step('surfaces', { caption: 'From there it runs anywhere JavaScript does: this player, a Cloudflare Worker that answers with a frame or a trace, or an agent reading the transcript. The library has no dependencies and no host globals, which a test checks by running it in a bare JavaScript context.' });
    const k = Object.fromEntries(fan) as Record<(typeof fan)[number][0], Dot>;
    await this.play(...fan.map(([, x]) => new FadeOut(x)), { runTime: 0.25 });
    await this.play(focus(['DOM', 'STR', 'TXT', 'TR', 'PL', 'WK', 'AG']), { runTime: 1.2 });
    for (const [id] of fan) { k[id] = token(id, id === 'TR' ? TEAL : GOLD); }
    await this.play(...Object.values(k).map((x) => new FadeIn(x, { scale: 0.4 })), { runTime: 0.3 });
    await this.play(...hop('DOM', 'PL', k.DOM, GOLD), ...hop('STR', 'WK', k.STR, GOLD), ...hop('TXT', 'AG', k.TXT, GOLD), { runTime: 0.9 });
    await this.play(light('PL', GOLD), light('WK', GOLD), light('AG', GOLD), { runTime: 0.5 });
    st.phase = 'surfaces';

    // ---- 6. the oracle -------------------------------------------------------------------------
    await this.step('oracle', { caption: 'The last path is the one that matters. The trace is checked against the program itself: run the real code, or the real git, or Mermaid\'s own parser, and require the same state the animation shows. That dotted line is the point. A lantern shows what is there; it does not paint a picture.' });
    await this.play(...Object.values(k).map((x) => new FadeOut(x)), { runTime: 0.3 });
    await this.play(focus(ALL), { runTime: 1.4 });
    k.TR = token('TR', TEAL);
    const oracle = token('P', RED);
    await this.play(new FadeIn(k.TR, { scale: 0.4 }), { runTime: 0.3 });
    await this.play(new FadeIn(oracle, { scale: 0.4 }), { runTime: 0.3 });
    await this.play(...hop('TR', 'V1', k.TR, TEAL), ...hop('P', 'V1', oracle, RED), { runTime: 1.4 });
    await this.play(light('V1', RED), new FadeOut(k.TR), new FadeOut(oracle), { runTime: 0.6 });
    st.phase = 'oracle';
    await this.wait(0.6);

    await this.step('end', { caption: 'Text in, a diagram out, and every part of it something you can animate, step through, and check.' });
    await this.play(...['V2', 'V3'].map((id) => light(id, RED)), { runTime: 0.6 });
    await this.wait(1.5);
  }
}
