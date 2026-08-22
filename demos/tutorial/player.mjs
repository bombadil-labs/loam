// The tutorial's ENGINE (§48), UI-free: the machine that plays any arc of the shape
// `lessons.mjs` describes. The page is its theater and `test/site/arc.test.ts` drives it with
// no DOM at all — same functions, same commit, no skew.
//
// THE ONE IDEA HERE: the tutorial has no memory of its own. Where the student stands, which
// steps they banked, what they answered, which boundaries have a checkpoint — all of it is
// SIGNED CLAIMS in the student's own store, under a `tutorial.*` vocabulary, and every reading
// below recomputes from the ground. There is no parallel state machine, so a reload cannot
// disagree with the store and progress cannot be faked by a variable. The falsifier this is
// built to pass: delete every key that is not a store row, reload, and land in the same place.
//
// WHAT LIVES OUTSIDE THE STORE, and why: the CHECKPOINTS. A store cannot contain its own
// serialization, so a checkpoint is a blob beside it, under its own `loam:tutorial-ckpt:<n>`
// prefix — NOT under `loam:tutorial:`, whose non-hex keys the boot heals away, and not inside
// the ground. That places a copy of the student's bytes outside the store's reach, which is
// exactly why `sweepCheckpoints` exists: an erasure that spared a copy would be T40 reproduced
// inside the lesson that teaches forgetting.

// ---- the vocabulary ----------------------------------------------------------------------------

export const STORE_PREFIX = "loam:tutorial:";
export const SEED_KEY = "loam:tutorial:seed";
export const CKPT_PREFIX = "loam:tutorial-ckpt:";

// Every context the tutorial writes under. The Ground pane filters exactly these out by
// default (a student watching their own facts should not have to wade through the tutorial's
// bookkeeping), and `classifyDelta` badges them `tutorial` rather than `fact`.
export const TUTORIAL_CONTEXTS = {
  entered: "tutorial.entered",
  step: "tutorial.step",
  quiz: "tutorial.quiz",
  checkpoint: "tutorial.checkpoint",
  glossary: "tutorial.glossary",
};

const CONTEXT_SET = new Set(Object.values(TUTORIAL_CONTEXTS));

/** Is this delta one of the tutorial's own records? The classifier's question, shared. */
export function isTutorialDelta(delta) {
  return delta.claims.pointers.some(
    (p) => p.target.kind === "entity" && CONTEXT_SET.has(p.target.entity.context),
  );
}

// ---- the claim grammar --------------------------------------------------------------------------

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (role, value) => ({ role, target: { kind: "primitive", value } });

const sign = (loam, ctx, pointers) =>
  loam.signClaims({ timestamp: ctx.ts(), author: ctx.author, pointers }, ctx.seed);

/**
 * The student's own LIVE tutorial records. Progress is what THEY did, so three filters, each
 * load-bearing and each with a direction it protects:
 *
 *   AUTHORED BY THEM — someone else's claim about my progress is data and moves nothing; a
 *   federated packet cannot advance the lesson.
 *   SIGNED — `claims.author` is a plain field, and an unsigned row planted under this origin's
 *   prefix is admitted to the ground (the driver quarantines an INVALID signature, not a
 *   missing one). Without this, anything on a shared origin could write the student's history.
 *   NOT STRUCK — and struck by a strike that SURVIVES, and by one of the student's OWN, which
 *   is the rule the gateway's readers keep: a stranger's strike retires nothing the operator
 *   planted (H1), and a struck strike revives its target, so survival is recursive rather than
 *   a one-link presence test. The chain guard makes a cycle answer "not struck" — a loop of
 *   strikes proves nothing, and the safe direction here is to keep the student's progress.
 */
function mine(ctx) {
  const reactor = ctx.gateway.reactor;
  // One index per reading, not one per delta: the page reads progress on every render.
  const byId = new Map([...reactor.snapshot()].map((d) => [d.id, d]));
  const struck = (id, chain = new Set()) => {
    if (chain.has(id)) return false;
    chain.add(id);
    const answer = reactor.negationsOf(id).some((strikeId) => {
      const strike = byId.get(strikeId);
      return (
        strike !== undefined &&
        strike.claims.author === ctx.author &&
        strike.sig !== undefined &&
        !struck(strikeId, chain)
      );
    });
    chain.delete(id);
    return answer;
  };
  return ctx.gateway
    .offeredDeltas()
    .filter(
      (d) =>
        d.claims.author === ctx.author &&
        d.sig !== undefined &&
        isTutorialDelta(d) &&
        !struck(d.id),
    );
}

const contextOf = (delta) => {
  for (const p of delta.claims.pointers) {
    if (p.target.kind === "entity" && CONTEXT_SET.has(p.target.entity.context)) {
      return p.target.entity.context;
    }
  }
  return undefined;
};

const valueOf = (delta, role) => {
  const found = delta.claims.pointers.find((p) => p.role === role && p.target.kind === "primitive");
  return found === undefined ? undefined : found.target.value;
};

// ---- reading the progress -----------------------------------------------------------------------

/**
 * Everything the tutorial knows about this student, recomputed from their ground. The page's
 * rail, the resume, and the quiz results are all readings of this one function.
 */
export function readProgress(ctx) {
  const entered = new Set();
  const steps = new Set();
  const quiz = new Map();
  const skipped = new Set();
  const checkpoints = new Set();
  for (const d of mine(ctx)) {
    switch (contextOf(d)) {
      case TUTORIAL_CONTEXTS.entered:
        entered.add(Number(valueOf(d, "number")));
        break;
      case TUTORIAL_CONTEXTS.step:
        steps.add(String(valueOf(d, "name")));
        break;
      case TUTORIAL_CONTEXTS.quiz:
        if (valueOf(d, "skipped") === true) skipped.add(String(valueOf(d, "quiz")));
        else {
          quiz.set(String(valueOf(d, "question")), {
            choice: Number(valueOf(d, "choice")),
            correct: valueOf(d, "correct") === true,
          });
        }
        break;
      case TUTORIAL_CONTEXTS.checkpoint:
        checkpoints.add(Number(valueOf(d, "lesson")));
        break;
      default:
        break;
    }
  }
  const ascending = (a, b) => a - b;
  return {
    entered: [...entered].sort(ascending),
    steps,
    quiz,
    skipped,
    checkpoints: [...checkpoints].sort(ascending),
  };
}

/** The glossary, as a reading of the claims that planted it — oldest term first. */
export function readGlossary(ctx) {
  return mine(ctx)
    .filter((d) => contextOf(d) === TUTORIAL_CONTEXTS.glossary)
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp || (a.id < b.id ? -1 : 1))
    .map((d) => ({
      term: String(valueOf(d, "name")),
      meaning: String(valueOf(d, "meaning")),
      lesson: Number(valueOf(d, "lesson")),
      deltaId: d.id,
    }));
}

/**
 * Where the student stands, from the claims alone — this function IS the resume, and nothing
 * here reads UI memory.
 *
 * THE LESSON IS THE FURTHEST ONE THEY ENTERED, not the first unfinished one. Entering is an act
 * the student performed and the store recorded, so a completed lesson they are still sitting
 * with (reading its quiz, its glossary, its ground) is where they left off — moving them on
 * would be the page deciding for them. It also makes a revert land exactly where the checkpoint
 * was taken, and land there WITHOUT writing: a store restored to a boundary already holds that
 * lesson's entry, so reopening it adds nothing and the restored ground stays byte-for-byte the
 * checkpoint's.
 *
 * An entered lesson the arc no longer has (an old store meeting a new arc) is ignored rather
 * than trusted, so a rewritten arc opens at its own beginning instead of nowhere.
 */
export function resumeState(arc, progress) {
  const known = new Set(arc.map((l) => l.id));
  const furthest = progress.entered.filter((id) => known.has(id)).pop();
  const lesson = arc.find((l) => l.id === furthest) ?? arc[0];
  const pending = lesson.steps.findIndex((s) => !progress.steps.has(s.id));
  return {
    lessonId: lesson.id,
    stepIndex: pending === -1 ? lesson.steps.length : pending,
    quiz: progress.quiz,
  };
}

// ---- writing the progress -----------------------------------------------------------------------

/**
 * Arriving at a lesson: one `entered` claim, and one glossary claim per term the lesson
 * introduces. Idempotent — re-entering a lesson (a revisit, a revert, a click on the rail)
 * lands nothing new, so the counts stay honest.
 */
export async function enterLesson(loam, ctx, lesson) {
  const progress = readProgress(ctx);
  const known = new Set(readGlossary(ctx).map((e) => e.term));
  const batch = [];
  if (!progress.entered.includes(lesson.id)) {
    batch.push(
      sign(loam, ctx, [
        entity("lesson", `tutorial:lesson:${lesson.id}`, TUTORIAL_CONTEXTS.entered),
        prim("number", lesson.id),
      ]),
    );
  }
  for (const t of lesson.terms ?? []) {
    if (known.has(t.term)) continue;
    batch.push(...glossaryClaims(loam, ctx, lesson.id, t));
    known.add(t.term);
  }
  if (batch.length > 0) await ctx.gateway.append(batch);
}

const glossaryClaims = (loam, ctx, lessonId, t) => [
  sign(loam, ctx, [
    entity("term", `tutorial:term:${t.term}`, TUTORIAL_CONTEXTS.glossary),
    prim("name", t.term),
    prim("meaning", t.meaning),
    prim("lesson", lessonId),
  ]),
];

/** Plant one term from inside a step (the reveal's payoff): the same claim, on demand. */
export async function plantTerm(loam, ctx, lessonId, term, meaning) {
  if (readGlossary(ctx).some((e) => e.term === term)) return;
  await ctx.gateway.append(glossaryClaims(loam, ctx, lessonId, { term, meaning }));
}

/**
 * Run a step and bank it — but ONLY if both of its observables hold afterwards. The prose is
 * never consulted: a step is complete when the page shows the thing and the store holds the
 * thing, so a `run` that quietly stopped working is refused by name (H10 — never compare a
 * step's words to the DOM its words describe).
 *
 * `opts.afterRun` lets the page re-render between the work and the page predicate; headless
 * callers pass neither it nor `seePage`, and the store predicate carries the whole weight there.
 */
export async function completeStep(loam, ctx, lesson, step, opts = {}) {
  const where = `lesson ${lesson.id}, step ${step.id}`;
  try {
    await step.run(ctx);
  } catch (err) {
    return { ok: false, failed: "run", message: `${where}: the store refused — ${err.message}` };
  }
  if (opts.afterRun !== undefined) await opts.afterRun();
  const page = step.observe.page;
  if (opts.seePage !== undefined && page !== undefined && !opts.seePage(page)) {
    // Name what it looked for, both halves: a refusal that named only the selector cannot tell
    // "the pane is missing" from "the pane says something else", and those are different bugs.
    const looked =
      page.contains === undefined ? page.selector : `${page.selector} showing "${page.contains}"`;
    return {
      ok: false,
      failed: "page",
      message: `${where}: the page does not show what this step promised (${looked})`,
    };
  }
  if (!(await step.observe.store(ctx))) {
    return {
      ok: false,
      failed: "store",
      message: `${where}: the store does not hold what this step promised — nothing was banked`,
    };
  }
  if (!readProgress(ctx).steps.has(step.id)) {
    await ctx.gateway.append([
      sign(loam, ctx, [
        entity("step", `tutorial:step:${step.id}`, TUTORIAL_CONTEXTS.step),
        prim("name", step.id),
        prim("lesson", lesson.id),
      ]),
    ]);
  }
  return { ok: true, banked: step.id };
}

/** One answer, checked locally, banked as a claim. A wrong answer names the teaching step. */
export async function answerQuiz(loam, ctx, quiz, index, choice) {
  const question = quiz.questions[index];
  const correct = choice === question.answer;
  const key = `${quiz.id}#${index}`;
  await ctx.gateway.append([
    sign(loam, ctx, [
      entity("quiz", `tutorial:quiz:${key}`, TUTORIAL_CONTEXTS.quiz),
      prim("quiz", quiz.id),
      prim("question", key),
      prim("choice", choice),
      prim("correct", correct),
    ]),
  ]);
  return { correct, teaches: question.teaches, chose: choice };
}

/** Skipping is always allowed and always recorded — the arc never blocks on a quiz. */
export async function skipQuiz(loam, ctx, quiz) {
  if (readProgress(ctx).skipped.has(quiz.id)) return;
  await ctx.gateway.append([
    sign(loam, ctx, [
      entity("quiz", `tutorial:quiz:${quiz.id}`, TUTORIAL_CONTEXTS.quiz),
      prim("quiz", quiz.id),
      prim("skipped", true),
    ]),
  ]);
}

// ---- the checkpoints ----------------------------------------------------------------------------

const ckptKey = (lesson) => `${CKPT_PREFIX}${lesson}`;
const isRowKey = (key) =>
  key.startsWith(STORE_PREFIX) && /^[0-9a-f]+$/.test(key.slice(STORE_PREFIX.length));

function rowKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && isRowKey(key)) keys.push(key);
  }
  return keys;
}

/**
 * Freeze the store's rows at a lesson boundary. ONE checkpoint per boundary, superseded in
 * place, so the quota stays bounded no matter how often a lesson is replayed. The seed is
 * never copied: it is not a delta and a checkpoint has no business holding key material.
 */
export function takeCheckpoint(storage, lesson, opts = {}) {
  const rows = {};
  for (const key of rowKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) rows[key] = value;
  }
  const blob = JSON.stringify({ version: 1, lesson, takenAt: Date.now(), rows });
  try {
    storage.setItem(ckptKey(lesson), blob);
  } catch (err) {
    return {
      ok: false,
      message:
        `this browser has no room for the checkpoint after ${opts.label ?? `lesson ${lesson}`} ` +
        `(${err.name ?? "the write was refused"}) — the lesson stands, but you cannot revert to ` +
        `this moment. "Start over" frees the space.`,
    };
  }
  return { ok: true, lesson, rows: Object.keys(rows).length };
}

/** Take the checkpoint AND record that it was taken — the claim first, so the blob holds it. */
export async function bankCheckpoint(loam, ctx, lesson, opts = {}) {
  if (!readProgress(ctx).checkpoints.includes(lesson)) {
    await ctx.gateway.append([
      sign(loam, ctx, [
        entity("checkpoint", `tutorial:checkpoint:${lesson}`, TUTORIAL_CONTEXTS.checkpoint),
        prim("lesson", lesson),
      ]),
    ]);
  }
  return takeCheckpoint(ctx.storage, lesson, opts);
}

/** A blob is only a checkpoint if it parses AND carries rows; anything else is unreadable. */
function parseBlob(raw) {
  try {
    const blob = JSON.parse(raw);
    if (blob === null || typeof blob !== "object" || typeof blob.rows !== "object") return null;
    if (blob.rows === null) return null;
    return blob;
  } catch {
    return null;
  }
}

export function readCheckpoint(storage, lesson) {
  const raw = storage.getItem(ckptKey(lesson));
  return raw === null ? null : parseBlob(raw);
}

/**
 * Every key under the checkpoint prefix, VERBATIM — the sweep walks these rather than a list of
 * numbers it re-derives, because a suffix that does not round-trip through `Number` would either
 * be skipped (a blob keeping condemned bytes while the report says none do) or point the removal
 * at a different key entirely. Nothing in the arc writes such a key; reading the keys themselves
 * means nothing has to.
 */
function checkpointKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(CKPT_PREFIX)) keys.push(key);
  }
  return keys;
}

/** The boundaries a student can revert to: the checkpoints whose suffix really is a lesson. */
export function checkpointLessons(storage) {
  return checkpointKeys(storage)
    .map((key) => key.slice(CKPT_PREFIX.length))
    .filter((suffix) => String(Number(suffix)) === suffix && Number.isInteger(Number(suffix)))
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Re-seed the store's rows from a checkpoint. The CALLER reloads afterwards, and that reload is
 * load-bearing: the page captured the gateway at module scope and holds live subscriptions, so
 * swapping the ground underneath it would leave panes rendering a future that no longer exists.
 *
 * WRITE FIRST, REMOVE SECOND. Deleting the present rows before writing the checkpoint's means a
 * write that fails halfway (quota, a closed handle) has already destroyed rows whose only copy
 * was the one it deleted — and a rollback attempted into the same full quota can fail again,
 * leaving a hole no report can honestly call "nothing changed". Restoring the rows first costs
 * almost nothing (the two sets mostly share keys AND values) and cannot lose a row: a refusal
 * leaves a store holding both states, which the next attempt finishes.
 *
 * AND AN ERASED ROW IS NEVER WRITTEN BACK. `erasedIds` is proof, asked at the moment of the
 * write, rather than an inference that some earlier sweep must have cleaned this blob. Every
 * refused id is named in the result so the page can say what it would not restore.
 */
export function restoreCheckpoint(storage, lesson, opts = {}) {
  const blob = readCheckpoint(storage, lesson);
  if (blob === null) return { ok: false, message: `there is no readable checkpoint for ${lesson}` };
  const condemned = new Set(opts.erasedIds ?? []);
  const wanted = new Map();
  const refused = [];
  for (const [key, value] of Object.entries(blob.rows)) {
    if (!isRowKey(key) || typeof value !== "string") continue; // never write what is not a row
    const id = key.slice(STORE_PREFIX.length);
    if (condemned.has(id)) {
      refused.push(id);
      continue;
    }
    wanted.set(key, value);
  }

  let restored = 0;
  try {
    for (const [key, value] of wanted) {
      if (storage.getItem(key) === value) continue; // already exactly this row
      storage.setItem(key, value);
      restored += 1;
    }
  } catch (err) {
    return {
      ok: false,
      refused,
      message:
        `the revert could not be written (${err.name ?? "the write was refused"}) — nothing was ` +
        `removed, and every row it did put back belongs to that checkpoint. Free some space and ` +
        `try again.`,
    };
  }
  for (const key of rowKeys(storage)) if (!wanted.has(key)) storage.removeItem(key);
  return { ok: true, restored, refused };
}

/**
 * Start over drops the checkpoints too: an undo into a store that no longer exists is a lie.
 * Every key under the prefix goes, not only the ones that parse as a lesson — the promise the
 * confirmation makes is "every checkpoint", and a key this could not name is still a copy.
 */
export function clearCheckpoints(storage) {
  for (const key of checkpointKeys(storage)) storage.removeItem(key);
}

/**
 * ERASURE REACHES THE CHECKPOINTS. A checkpoint is a copy, and a copy holds the bytes; a right
 * to be forgotten that spares the student's undo button is not a right at all. Every blob that
 * holds a condemned id is destroyed, named, with its reason — and every blob that does not is
 * KEPT and reported, because a sweep that took everything would be over-purging wearing a
 * sweep's clothes, and that failure is invisible unless both sides are stated.
 *
 * A blob this cannot read is destroyed too: it cannot be shown to be clean, and an unreadable
 * checkpoint could not be reverted to anyway.
 */
export function sweepCheckpoints(storage, erasedIds) {
  const dead = new Set(erasedIds);
  const destroyed = [];
  const kept = [];
  // Over the KEYS, and removing the key it read — never a key re-derived from a parsed name.
  for (const key of checkpointKeys(storage)) {
    const lesson = key.slice(CKPT_PREFIX.length);
    const raw = storage.getItem(key);
    const blob = raw === null ? null : parseBlob(raw);
    if (blob === null) {
      storage.removeItem(key);
      destroyed.push({
        lesson,
        ids: [],
        reason: "this checkpoint could not be read, so it could not be shown to be clean",
      });
      continue;
    }
    // The bytes are in the VALUES; the keys only name them. A row filed under a key whose id it
    // does not match is not a lawful row (the driver quarantines exactly that), so the id in the
    // key is the right question — but a blob holding the condemned id ANYWHERE goes too, because
    // this side of the wall cannot prove what an unexpected shape is carrying.
    const held = Object.keys(blob.rows)
      .filter(isRowKey)
      .map((rowKey) => rowKey.slice(STORE_PREFIX.length))
      .filter((id) => dead.has(id));
    const hiding = held.length === 0 && [...dead].some((id) => raw.includes(id));
    if (held.length === 0 && !hiding) {
      kept.push({ lesson });
      continue;
    }
    storage.removeItem(key);
    destroyed.push({
      lesson,
      ids: held,
      reason: hiding
        ? "an erased record's name is somewhere in it, in a shape this could not account for"
        : `it held ${held.length === 1 ? "the erased record" : `${held.length} erased records`}`,
    });
  }
  return { destroyed, kept };
}
