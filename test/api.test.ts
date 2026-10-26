// The public API is the set of names src/index.ts exports. This pins it, so a
// name cannot leave or appear without a deliberate change here (and a
// changelog entry). Internals stay internal by construction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.ts';

const EXPECTED = [
  // model
  'Mobject', 'Group', 'VMobject',
  'Arc', 'ArcBetweenPoints', 'Arrow', 'Circle', 'CurvedArrow', 'Dot', 'Labeled', 'Line', 'Polygon', 'Rectangle', 'Square',
  'Text', 'DecimalNumber', 'Code', 'Card', 'route', 'obstacles', 'title', 'CodePanel', 'StateReadout',
  'Flowchart', 'flowchart', 'FLOWCHART_THEME', 'parseMermaid', 'layoutGraph',
  // motion
  'Animation', 'Transform', 'FadeIn', 'FadeOut', 'Create', 'Write', 'Indicate', 'Flash', 'MoveAlongPath', 'AnimationGroup', 'LaggedStart',
  'linear', 'smooth', 'rushInto', 'rushFrom', 'thereAndBack', 'easeInQuad', 'easeOutQuad', 'easeOutBack', 'wiggle',
  'Scene', 'DocScene', 'sceneFromDoc',
  // vocabulary
  'ORIGIN', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'UL', 'UR', 'DL', 'DR', 'add', 'sub', 'mul', 'dot', 'norm', 'normalize', 'lerp', 'rotate', 'angleOf',
  'WHITE', 'BLACK', 'GREY', 'GREY_D', 'BLUE', 'BLUE_D', 'TEAL', 'GREEN', 'YELLOW', 'GOLD', 'RED', 'MAROON', 'PURPLE', 'ORANGE',
  'loadFonts',
  // output
  'toSvgString', 'renderElements', 'StringSink', 'SnapshotSink', 'DomSink', 'renderText',
  // time
  'NullSink', 'SeekSink', 'indexScene', 'stepTime', 'renderAt', 'TraceSink', 'traceScene',
  // diagnostics
  'perf', 'MotionSink', 'analyzeMotion', 'summarizeMotion', 'PHONE_CANVAS_FILL', 'PHONE_BAND_GAP', 'PHONE_CONNECTOR_MAX',
].sort();

test('the public API is exactly the documented set of names', () => {
  assert.deepEqual(Object.keys(api).sort(), EXPECTED);
});

test('the coordinate vocabulary is manim\'s: y up, angles counterclockwise', () => {
  assert.deepEqual(api.UP, [0, 1]); assert.deepEqual(api.DOWN, [0, -1]); assert.deepEqual(api.UR, [1, 1]);
  const p = api.rotate([1, 0], Math.PI / 2);
  assert.ok(Math.abs(p[0]) < 1e-12 && Math.abs(p[1] - 1) < 1e-12, 'a quarter turn takes +x to +y');
});
