// Panels: a code block with a movable highlight bar, and a key/value state readout.
import { Group } from './mobject.ts';
import type { Mobject, AnimateBuilder } from './mobject.ts';
import { Rectangle } from './shapes.ts';
import { Text, Code } from './text.ts';
import { UP } from './vec.ts';
import type { Vec } from './vec.ts';
import { GREY, WHITE, YELLOW } from './color.ts';

export function title(text: string): Text {
  return new Text(text, { fontSize: 0.4, weight: 'bold', color: WHITE }).toEdge(UP, 0.45);
}

/** Code block + a highlight bar that starts on line 0 (hidden until shown). */
export class CodePanel extends Group {
  code: Code;
  bar: Rectangle;

  constructor(lines: readonly string[], { fontSize = 0.26, at = [0, 0] }: { fontSize?: number; at?: Vec } = {}) {
    super();
    this.code = new Code(lines, { fontSize });
    this.code.moveTo(at);
    this.bar = this.code.highlight(0, YELLOW);
    this.bar.setOpacity(0);
    this.add(this.bar, this.code); // bar first so it draws behind
  }
  /** Animation builder: move the bar to line i (and reveal it). */
  focus(i: number, color = YELLOW): AnimateBuilder<Rectangle> {
    return this.bar.animate.moveTo(this.code.lineCenter(i)).setStyle({ opacity: 1, fill: color });
  }
  unfocus(): AnimateBuilder<Rectangle> { return this.bar.animate.setOpacity(0); }
}

/** `label: value` pairs stacked vertically; values are Text you can Transform. */
export class StateReadout extends Group {
  values: Record<string, Text>;

  constructor(entries: ReadonlyArray<readonly [key: string, value: unknown]>, { fontSize = 0.3, at = [0, 0], gap = 0.5 }: { fontSize?: number; at?: Vec; gap?: number } = {}) {
    super();
    this.values = Object.create(null);
    entries.forEach(([k, v], i) => {
      const key = new Text(k, { fontSize, font: 'mono', color: GREY, anchor: 'end' });
      const val = new Text(String(v), { fontSize, font: 'mono', color: WHITE, anchor: 'start' });
      key.moveTo([at[0] - 0.15, at[1] - i * gap], [1, 0]);
      val.moveTo([at[0] + 0.15, at[1] - i * gap], [-1, 0]);
      this.values[k] = val;
      this.add(key, val);
    });
  }
}

export function panelBox(mob: Mobject, { color = '#333a44', pad = 0.3 }: { color?: string; pad?: number } = {}): Rectangle {
  return new Rectangle({ width: mob.width() + 2 * pad, height: mob.height() + 2 * pad, cornerRadius: 0.15, stroke: color, strokeWidth: 0.03, fill: color, fillOpacity: 0.25 }).moveTo(mob);
}
