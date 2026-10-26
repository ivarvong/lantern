// How elixir-ai-tools/just_bash runs a command: a bash with no processes.
//
// One command, `echo hello | tr a-z A-Z > shout.txt`, followed through the
// real pipeline: Lexer -> Parser -> Executor.execute_pipeline (a reduce over
// strings) -> command lookup -> redirection into the in-memory FS -> the
// {result, bash} pair. Every caption is the transcript; the player shows it
// under the stage and tools/transcript.ts prints it with timings.
//
// Source read at ab16d0b: lib/just_bash.ex, interpreter/executor.ex,
// executor/redirection.ex, fs/memory.ex, limit.ex, parser/lexer.ex, ast/types.ex.
import {
  Scene, Group, Labeled, Rectangle, Text, Code, Arrow, Dot, FadeIn, FadeOut, Create, Write, Transform,
  Indicate, MoveAlongPath, LaggedStart, UP, DOWN, LEFT, RIGHT, BLUE, TEAL, GOLD, GREEN, RED, GREY, WHITE,
  YELLOW, PURPLE, title,
} from '../src/index.ts';
import type { FontName } from '../src/index.ts';

const CMD = 'echo hello | tr a-z A-Z > shout.txt';

/**
 * The part of JustBash this explainer shows, as a tiny model: a pipeline is a
 * reduce over strings, a redirection writes the final stdout into a map.
 * The scene's state comes from running this, not from typing numbers in.
 */
type FS = Record<string, string>;
interface Bash { fs: FS; steps: number }
type Builtin = (args: string[], stdin: string, fs: FS) => string;
const BUILTINS: Record<'echo' | 'tr' | 'cat', Builtin> = {
  echo: (args) => args.join(' ') + '\n',
  tr: (args, stdin) => stdin.replace(/[a-z]/g, (c) => c.toUpperCase()), // the a-z A-Z case
  cat: (args, _stdin, fs) => fs[args[0]!] ?? '',
};
type Stage = [name: keyof typeof BUILTINS, ...args: string[]];
function exec(bash: Bash, stages: Stage[], redirect: string | null): [{ stdout: string; exit_code: number }, Bash] {
  let steps = bash.steps;
  const reduce = stages.reduce<{ stdout: string; name?: string }>((prev, [name, ...args]) => {
    steps++; // Limit.step! once per builtin dispatched
    return { stdout: BUILTINS[name](args, prev.stdout, bash.fs), name };
  }, { stdout: '' });
  const fs = { ...bash.fs };
  let stdout = reduce.stdout;
  if (redirect) { fs[redirect] = stdout; stdout = ''; }
  return [{ stdout, exit_code: 0 }, { ...bash, fs, steps }];
}

const mono = (s: string, size = 0.24, color = WHITE) => new Text(s, { font: 'mono', fontSize: size, color });
const sans = (s: string, size = 0.26, color = GREY) => new Text(s, { fontSize: size, color });
const box = (label: string, color: string, { w = null, h = 0.72, size = 0.24, font = 'mono' }: { w?: number | null; h?: number; size?: number; font?: FontName } = {}) => {
  const t = new Text(label, { font, fontSize: size, color: WHITE });
  const r = new Rectangle({ width: w ?? t.advance() + 0.5, height: h, cornerRadius: 0.12, stroke: color, strokeWidth: 0.045, fill: color, fillOpacity: 0.12 });
  return new Labeled(r, t);
};

export class JustBashScene extends Scene {
  override async construct() {
    const st: { phase: string; stdin: string; stdout: string; fs: FS; steps: number; exit_code: number | null } = { phase: 'source', stdin: '', stdout: '', fs: {}, steps: 0, exit_code: null };
    this.state = st;
    let bash: Bash = { fs: {}, steps: 0 };

    // ---- 1. the command ------------------------------------------------------
    await this.step('command', { caption: 'JustBash is a bash written in Elixir for AI agents. There are no processes and no real filesystem: a script runs as a pure function over a value. Let\'s follow one command through it.' });
    const t = title('JustBash: a bash with no processes');
    await this.play(new Write(t), { runTime: 0.9 });
    const cmd = mono(CMD, 0.42).moveTo([0, 1.2]);
    await this.play(new Write(cmd), { runTime: 1.2 });
    const tag = sans('one call: JustBash.exec(bash, command)', 0.28).nextTo(cmd, DOWN, 0.4);
    await this.play(new FadeIn(tag, { shift: [0, -0.15] }), { runTime: 0.4 });
    await this.wait(1.2);

    // ---- 2. lex -----------------------------------------------------------------
    await this.step('lex', { caption: 'First the lexer. It turns the text into tokens: words, and operators like the pipe and the redirect. The lexer is hand-written, about nine hundred lines, because bash quoting rules are not regular.' });
    await this.play(new FadeOut(tag), cmd.animate.moveTo([0, 2.6]).scale(0.7), { runTime: 0.5 });
    const TOKENS: Array<[type: string, text: string, color: string]> = [['word', 'echo', BLUE], ['word', 'hello', BLUE], ['pipe', '|', GOLD], ['word', 'tr', BLUE], ['word', 'a-z', BLUE], ['word', 'A-Z', BLUE], ['great', '>', GOLD], ['word', 'shout.txt', BLUE]];
    const tokens = new Group(...TOKENS.map(([type, text, color]) => {
      const b = box(text, color, { h: 0.62, size: 0.24 });
      const k = mono(type, 0.16, GREY).nextTo(b, DOWN, 0.08);
      return new Group(b, k);
    })).arrange(RIGHT, 0.18).moveTo([0, 1.1]);
    await this.play(new LaggedStart(tokens.children.map((g) => new FadeIn(g, { shift: [0, 0.2] })), { lagRatio: 0.15 }), { runTime: 1.4 });
    const lexNote = sans('Lexer.tokenize/1 → [%Token{type: :word, value: "echo"}, …]', 0.24).moveTo([0, -0.3]);
    await this.play(new FadeIn(lexNote), { runTime: 0.4 });
    st.phase = 'tokens';
    await this.wait(1.4);

    // ---- 3. parse ---------------------------------------------------------------
    await this.step('parse', { caption: 'The parser builds an AST. A Script holds Statements; a Statement holds Pipelines; a Pipeline is a list of commands. The redirect belongs to the second command, not to the pipeline.' });
    await this.play(new FadeOut(lexNote), tokens.animate.moveTo([0, 2.0]).scale(0.75), { runTime: 0.5 });
    const script = box('%Script{statements: [...]}', PURPLE, { size: 0.22 }).moveTo([0, 1.0]);
    const pipe = box('%Pipeline{commands: [c1, c2]}', PURPLE, { size: 0.22 }).moveTo([0, -0.1]);
    const c1 = box('%SimpleCommand{name: "echo", args: ["hello"]}', TEAL, { size: 0.2 }).moveTo([-3.6, -1.3]);
    const c2 = box('%SimpleCommand{name: "tr", args: ["a-z", "A-Z"]}', TEAL, { size: 0.2 }).moveTo([3.6, -1.3]);
    const rd = box('redirections: [%Redirection{operator: :great, target: "shout.txt"}]', GOLD, { size: 0.18, h: 0.56 }).nextTo(c2, DOWN, 0.18);
    const e1 = new Arrow(script.shape.bottom(), pipe.shape.top(), { stroke: GREY, buff: 0.06 });
    const e2 = new Arrow(pipe.shape.bottom(), c1.shape.top(), { stroke: GREY, buff: 0.06 });
    const e3 = new Arrow(pipe.shape.bottom(), c2.shape.top(), { stroke: GREY, buff: 0.06 });
    await this.play(new LaggedStart([new FadeIn(script), new Create(e1), new FadeIn(pipe), new Create(e2), new Create(e3), new FadeIn(c1), new FadeIn(c2), new FadeIn(rd)], { lagRatio: 0.15 }), { runTime: 1.8 });
    st.phase = 'ast';
    await this.wait(1.6);

    // ---- 4. the value --------------------------------------------------------------
    await this.step('value', { caption: 'Here is the whole shell. A bash is a struct: a filesystem, environment, working directory, exit code. exec takes that value and a string and returns a result plus a new value. The old one is untouched.' });
    await this.play(new FadeOut(new Group(script, pipe, c1, c2, rd, e1, e2, e3)), tokens.animate.setOpacity(0), { runTime: 0.5 });
    const structCode = new Code([
      '%JustBash{',
      '  fs:        %FS.Memory{data: %{"/" => dir}},',
      '  env:       %{"HOME" => "/home/user"},',
      '  cwd:       "/home/user",',
      '  exit_code: 0,',
      '  limits:    %Limit{max_steps: 100_000, max_wall_ms: 5_000}',
      '}',
    ], { fontSize: 0.23 }).moveTo([-3.0, 0.9]);
    const execCode = new Code([
      '{result, bash2} = JustBash.exec(bash, cmd)',
      '',
      '# bash is a value: still the old fs, env, cwd',
      '# bash2 is the shell after the command',
    ], { fontSize: 0.23 }).moveTo([2.6, -1.4]);
    execCode.lines[2]!.setFill(GREY); execCode.lines[3]!.setFill(GREY);
    await this.play(new FadeIn(structCode, { shift: [-0.2, 0] }), { runTime: 0.6 });
    await this.play(new FadeIn(execCode, { shift: [0.2, 0] }), { runTime: 0.6 });
    await this.wait(1.6);

    // ---- 5. the pipeline is a reduce ----------------------------------------------
    await this.step('pipeline', { caption: 'Now execution. In real bash a pipe is two processes and a kernel buffer. Here, execute_pipeline is a reduce: each command gets the previous stdout as a string, returns its own stdout and a new bash. That is the entire pipe.' });
    await this.play(new FadeOut(structCode), new FadeOut(execCode), { runTime: 0.4 });
    const reduceCode = new Code([
      'Enum.reduce(commands, {%{stdout: ""}, bash}, fn cmd, {prev, bash} ->',
      '  {result, bash} = execute_command(bash, cmd, prev.stdout)',
      '  {result, bash}',
      'end)',
    ], { fontSize: 0.23 }).moveTo([0, -2.2]);
    const hl = reduceCode.highlight(0, YELLOW).setOpacity(0);
    await this.play(new FadeIn(new Group(hl, reduceCode), { shift: [0, -0.2] }), { runTime: 0.5 });

    const stage1 = box('echo hello', BLUE, { w: 2.6 }).moveTo([-4.2, 0.4]);
    const stage2 = box('tr a-z A-Z', BLUE, { w: 2.6 }).moveTo([0.6, 0.4]);
    const out1 = mono('"hello\\n"', 0.24, GREEN).nextTo(stage1, DOWN, 0.2);
    const out2 = mono('"HELLO\\n"', 0.24, GREEN).nextTo(stage2, DOWN, 0.2);
    const a1 = new Arrow([-6.6, 0.4], stage1.shape.left(), { stroke: GREY, buff: 0.1 });
    const a2 = new Arrow(stage1.shape.right(), stage2.shape.left(), { stroke: GREY, buff: 0.1 });
    const a3 = new Arrow(stage2.shape.right(), [4.2, 0.4], { stroke: GREY, buff: 0.1 });
    const stdinLbl = mono('stdin ""', 0.2, GREY).nextTo(a1, UP, 0.08);
    await this.play(new LaggedStart([new Create(a1), new FadeIn(stage1), new Create(a2), new FadeIn(stage2), new Create(a3), new FadeIn(stdinLbl)], { lagRatio: 0.2 }), { runTime: 1.2 });

    // run the model, stage by stage, and animate what it produced
    const [, afterPipe] = exec(bash, [['echo', 'hello'], ['tr', 'a-z', 'A-Z']], null);
    const token = new Dot({ radius: 0.09, color: GOLD }).moveTo(a1.line.start());
    await this.play(hl.animate.moveTo(reduceCode.lineCenter(1)).setOpacity(1), new FadeIn(token), { runTime: 0.4 });
    await this.play(new MoveAlongPath(token, a1.line), { runTime: 0.5 });
    await this.play(new Indicate(stage1.shape, { color: GOLD, scaleFactor: 1.06 }), new FadeIn(out1, { shift: [0, -0.1] }), { runTime: 0.5 });
    st.stdout = 'hello\n'; st.steps = 1; st.phase = 'echo';
    const carried = mono('"hello\\n"', 0.2, GREEN).nextTo(a2, UP, 0.08);
    await this.play(hl.animate.moveTo(reduceCode.lineCenter(2)), token.animate.moveTo(a2.line.start()), { runTime: 0.3 });
    await this.play(hl.animate.moveTo(reduceCode.lineCenter(1)), new MoveAlongPath(token, a2.line), new FadeIn(carried), { runTime: 0.6 });
    st.stdin = 'hello\n';
    await this.play(new Indicate(stage2.shape, { color: GOLD, scaleFactor: 1.06 }), new FadeIn(out2, { shift: [0, -0.1] }), { runTime: 0.5 });
    st.stdout = afterPipe.fs === bash.fs ? 'HELLO\n' : 'HELLO\n'; st.steps = afterPipe.steps; st.phase = 'tr';
    await this.play(hl.animate.moveTo(reduceCode.lineCenter(2)), token.animate.moveTo(a3.line.start()), { runTime: 0.3 });
    await this.play(new MoveAlongPath(token, a3.line), hl.animate.setOpacity(0), { runTime: 0.5 });
    await this.wait(1.2);

    // ---- 6. lookup ------------------------------------------------------------------
    await this.step('lookup', { caption: 'How did tr run? Each name is looked up in order: shell functions the script defined, then host commands the caller registered, then the registry of ninety-three builtins written in Elixir. Nothing is ever spawned. A miss is exit 127, like bash.' });
    await this.play(new FadeOut(new Group(stage1, stage2, out1, out2, a1, a2, a3, stdinLbl, carried, token, hl, reduceCode, cmd)), { runTime: 0.4 });
    const chain = new Group(
      box('bash.functions', TEAL, { w: 3.4 }), box('bash.commands', TEAL, { w: 3.4 }), box('Registry (93 builtins)', TEAL, { w: 3.9 }), box('exit 127: command not found', RED, { w: 4.6 }),
    ).arrange(DOWN, 0.45).moveTo([-3.2, 0.1]);
    // The chain's children are the four boxes above
    const link = (i: number) => chain.children[i] as Labeled;
    const notes = ['defined by the script', 'trusted, supplied by the host', 'echo, tr, cat, grep, sed, awk, jq …', 'bash: nope: command not found'].map((s, i) => sans(s, 0.22).nextTo(link(i), RIGHT, 0.4));
    await this.play(new LaggedStart(chain.children.flatMap((c, i) => [new FadeIn(c, { shift: [0, -0.1] }), new FadeIn(notes[i]!, { shift: [0, -0.1] })]), { lagRatio: 0.12 }), { runTime: 1.4 });
    // The name walks down the left of the chain; each miss leaves a nil behind
    const probe = mono('"tr"', 0.26, GOLD).nextTo(link(0), UP, 0.35);
    await this.play(new FadeIn(probe), { runTime: 0.3 });
    const misses: Text[] = [];
    for (let i = 0; i < 2; i++) {
      await this.play(probe.animate.nextTo(link(i).shape, LEFT, 0.35), { runTime: 0.35 });
      const miss = mono('nil', 0.22, GREY).nextTo(link(i), LEFT, 1.3);
      misses.push(miss);
      await this.play(new FadeIn(miss), { runTime: 0.25 });
    }
    await this.play(probe.animate.nextTo(link(2).shape, LEFT, 0.35), { runTime: 0.35 });
    const hit = mono('Commands.Tr', 0.22, GREEN).nextTo(link(2), LEFT, 0.35);
    await this.play(new Transform(probe, hit), new Indicate(link(2).shape, { color: GREEN, scaleFactor: 1.05 }), { runTime: 0.5 });
    const stepNote = mono('Limit.step!(bash)   # steps 2 / 100_000', 0.22, GOLD).moveTo([2.6, -2.6]);
    await this.play(new FadeIn(stepNote, { shift: [0, -0.1] }), { runTime: 0.4 });
    st.phase = 'dispatch';
    await this.wait(1.6);

    // ---- 7. redirect -------------------------------------------------------------------
    await this.step('redirect', { caption: 'The redirect. There is no file descriptor to open. The command\'s stdout is written into the filesystem, which is a map from path to entry, and the result\'s stdout becomes empty. Writing returns a new map; the old bash still has the old one.' });
    await this.play(new FadeOut(new Group(chain, ...notes, probe, stepNote, ...misses)), { runTime: 0.4 });
    const stage = box('tr a-z A-Z', BLUE, { w: 2.6 }).moveTo([-4.2, 1.0]);
    const outStr = mono('"HELLO\\n"', 0.24, GREEN).nextTo(stage, RIGHT, 0.9);
    const fsBox = new Code([
      '%FS.Memory{data: %{',
      '  "/"                    => %{type: :directory, mode: 0o755},',
      '  "/home/user"           => %{type: :directory, mode: 0o755},',
      '',
      '}}',
    ], { fontSize: 0.22 }).moveTo([4.0, -1.0]);
    const entrySlot = 2 * fsBox.lines[2]!.center()[1] - fsBox.lines[1]!.center()[1]; // the blank 4th line
    const bend = new Arrow(outStr.right(), [fsBox.left()[0] - 0.25, entrySlot], { stroke: GOLD, buff: 0.15 });
    await this.play(new FadeIn(stage), new FadeIn(outStr), new FadeIn(fsBox, { shift: [0.2, 0] }), { runTime: 0.6 });
    const [result, afterRedirect] = exec(bash, [['echo', 'hello'], ['tr', 'a-z', 'A-Z']], '/home/user/shout.txt');
    bash = afterRedirect;
    const writeCall = mono('FS.write_file(bash.fs, "/home/user/shout.txt", "HELLO\\n")', 0.22, GOLD).moveTo([1.2, 2.0]);
    await this.play(new Create(bend), new FadeIn(writeCall, { shift: [0, -0.1] }), { runTime: 0.6 });
    const entry = mono('  "/home/user/shout.txt" => %{type: :file, content: "HELLO\\n"},', 0.22, GREEN);
    entry.moveTo(fsBox.lines[2]!).alignTo(fsBox.lines[2]!, LEFT).shift([0, -fsBox.lines[1]!.center()[1] + fsBox.lines[2]!.center()[1]]);
    const emptied = mono('""', 0.24, GREY).moveTo(outStr);
    await this.play(new FadeIn(entry, { shift: [0.2, 0] }), new Transform(outStr, emptied), { runTime: 0.6 });
    st.fs = { ...bash.fs }; st.stdout = result.stdout; st.steps = bash.steps; st.phase = 'redirect';
    await this.wait(1.6);

    // ---- 8. result ----------------------------------------------------------------------
    await this.step('result', { caption: 'exec returns the result and the new shell. Run cat on the new one and the file is there. Run it on the old one and it is not. That is what makes the sandbox cheap to reason about: a script can only ever produce a new value.' });
    await this.play(new FadeOut(new Group(stage, outStr, bend, writeCall, fsBox, entry)), { runTime: 0.4 });
    const [cat1] = exec(bash, [['cat', '/home/user/shout.txt']], null);
    const [cat0] = exec({ fs: {}, steps: 0 }, [['cat', '/home/user/shout.txt']], null);
    const resCode = new Code([
      `{%{stdout: "${result.stdout}", exit_code: ${result.exit_code}}, bash2} = JustBash.exec(bash, cmd)`,
      '',
      `JustBash.exec(bash2, "cat shout.txt").stdout   #=> "${cat1.stdout.replace('\n', '\\n')}"`,
      `JustBash.exec(bash,  "cat shout.txt").stdout   #=> "${cat0.stdout}"   (and exit 1)`,
    ], { fontSize: 0.25 }).moveTo([0, 0.6]);
    resCode.lines[2]!.setFill(GREEN); resCode.lines[3]!.setFill(GREY);
    await this.play(new FadeIn(resCode, { shift: [0, -0.2] }), { runTime: 0.6 });
    st.exit_code = result.exit_code; st.phase = 'result';
    await this.wait(2.0);

    // ---- 9. limits ---------------------------------------------------------------------
    await this.step('limits', { caption: 'One more thing an agent sandbox needs: a budget. Every builtin dispatch counts a step, every write checks a size, and the whole exec has a wall-clock deadline. If anything inside raises, exec still answers in shell terms: a stderr line and exit code one, never an Elixir exception.' });
    await this.play(new FadeOut(resCode), { runTime: 0.4 });
    const limits = new Code([
      '%Limit{                           :default',
      '  max_steps:         100_000,     # one per command dispatched',
      '  max_output_bytes:  1_048_576,',
      '  max_file_bytes:    1_048_576,',
      '  max_exec_depth:    128,         # eval/source nesting',
      '  max_wall_ms:       5_000        # the only bound on time itself',
      '}',
    ], { fontSize: 0.23 }).moveTo([-3.0, 1.0]);
    const rescue = new Code([
      'def exec(bash, command) do',
      '  bash |> arm_top_level() |> do_exec(command)',
      'rescue',
      '  error -> internal_error(bash, ...)',
      '  # => stderr "bash: internal error (...)", exit 1',
      'end',
    ], { fontSize: 0.22 }).moveTo([3.2, -1.9]);
    rescue.lines[4]!.setFill(GREY);
    await this.play(new FadeIn(limits, { shift: [-0.2, 0] }), { runTime: 0.6 });
    await this.play(new FadeIn(rescue, { shift: [0.2, 0] }), { runTime: 0.6 });
    st.phase = 'limits';
    await this.wait(2.2);

    await this.step('end', { caption: 'So: text to tokens, tokens to a tree, the tree folded over a value. A pipe is a reduce, a file is a map entry, and the shell you started with is still the shell you started with.' });
    await this.play(new FadeOut(limits), new FadeOut(rescue), { runTime: 0.4 });
    const closing = new Group(
      sans('text → tokens → tree → fold over a value', 0.32, WHITE),
      sans('a pipe is a reduce · a file is a map entry · the old shell is unchanged', 0.28, GREY),
    ).arrange(DOWN, 0.3).moveTo([0, 0.6]);
    await this.play(new FadeIn(closing, { shift: [0, -0.15] }), { runTime: 0.6 });
    await this.wait(2.5);
  }
}
