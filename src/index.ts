// Public API. Everything a scene, a player or a tool needs, and nothing else:
// internals (color parsing, animation plumbing, caches) stay module-private
// so they can change without breaking scenes.

// Model
export { Mobject, Group } from './mobject.ts';
export type { Style, StyleRecord, Box, Updater, PathFunc, AnimateBuilder } from './mobject.ts';
export { VMobject } from './vmobject.ts';
export { Arc, ArcBetweenPoints, Arrow, Circle, CurvedArrow, Dot, Labeled, Line, Polygon, Rectangle, Square } from './shapes.ts';
export type { RectangleOpts, SquareOpts, CircleOpts, DotOpts, ArrowOpts, ArcOpts, CurvedArrowOpts } from './shapes.ts';
export { Text, DecimalNumber, Code } from './text.ts';
export { Card, route, obstacles } from './layout.ts';
export type { CardOpts, CardPlan, RouteOpts } from './layout.ts';
export type { TextOpts, DecimalNumberOpts, CodeOpts } from './text.ts';
export { title, CodePanel, StateReadout } from './panels.ts';
export { Flowchart, flowchart, FLOWCHART_THEME } from './flowchart.ts';
export type { FlowchartOpts, FlowchartTheme, FlowStyle } from './flowchart.ts';
export { parseMermaid } from './mermaid.ts';
export type { FlowGraph, FlowNode, FlowEdge, FlowSubgraph } from './mermaid.ts';
export { layoutGraph } from './graphlayout.ts';
export type { LGraph, LNode, LEdge, LCluster, Layout, LayoutOptions } from './graphlayout.ts';

// Motion
export { Animation, Transform, FadeIn, FadeOut, Create, Write, Indicate, Flash, MoveAlongPath, AnimationGroup, LaggedStart } from './animation.ts';
export type { AnimOpts, PlayOpts, Playable, TransformOpts, FadeOpts, IndicateOpts, MoveAlongPathOpts } from './animation.ts';
export { linear, smooth, rushInto, rushFrom, thereAndBack, easeInQuad, easeOutQuad, easeOutBack, wiggle } from './rate.ts';
export type { RateFunc } from './rate.ts';
export { Scene } from './scene.ts';
export type { Sink, Step, StepMeta, SceneOptions, SceneState, SceneClass, FrameSize } from './scene.ts';
export { DocScene, sceneFromDoc } from './doc.ts';
export type { Doc, DocStep, DocOp, DocNodeSpec, DocEdgeSpec, At, DocSceneOptions } from './doc.ts';

// Vocabulary
export { ORIGIN, UP, DOWN, LEFT, RIGHT, UL, UR, DL, DR, add, sub, mul, dot, norm, normalize, lerp, rotate, angleOf } from './vec.ts';
export type { Vec } from './vec.ts';
export { WHITE, BLACK, GREY, GREY_D, BLUE, BLUE_D, TEAL, GREEN, YELLOW, GOLD, RED, MAROON, PURPLE, ORANGE } from './color.ts';
export { loadFonts } from './fonts.ts';
export type { FontName } from './fonts.ts';

// Output: SVG strings, the live DOM, text for agents
export { toSvgString, renderElements, StringSink, SnapshotSink, DomSink } from './svg.ts';
export type { ElementRecord, SvgOptions } from './svg.ts';
export { renderText } from './ascii.ts';

// Time: seek, index, trace
export { NullSink, SeekSink, indexScene, stepTime, renderAt } from './timeline.ts';
export type { SceneIndex } from './timeline.ts';
export { TraceSink, traceScene } from './trace.ts';
export type { Trace, StepRecord } from './trace.ts';

// Diagnostics
export { perf } from './perf.ts';
export { MotionSink, analyzeMotion, summarizeMotion, PHONE_TYPE_CODE, PHONE_TYPE_LABEL, PHONE_TYPE_MAX, PHONE_PAD, PHONE_BAND_GAP, PHONE_CONNECTOR_MAX } from './verify.ts';
export type { MotionEvent, MotionOptions, MotionSummary } from './verify.ts';
