export const STORE_PREFIX = "loam:tutorial:";
export const SEED_KEY = "loam:tutorial:seed";
export const CKPT_PREFIX = "loam:tutorial-ckpt:";

export const TUTORIAL_CONTEXTS = {
  entered: "tutorial.entered",
  step: "tutorial.step",
  quiz: "tutorial.quiz",
  checkpoint: "tutorial.checkpoint",
  glossary: "tutorial.glossary",
};

const CONTEXT_SET = new Set(Object.values(TUTORIAL_CONTEXTS));

function isTutorialDelta(delta) {
  return delta.claims.pointers.some(
    (p) => p.target.kind === "entity" && CONTEXT_SET.has(p.target.entity.context),
  );
}

export function isOnlyTutorial(delta) {
  if (!isTutorialDelta(delta)) return false;
  return !delta.claims.pointers.some(
    (p) =>
      p.target.kind === "delta" ||
      String(p.role).startsWith("rhizomatic.") ||
      (p.target.kind === "entity" && String(p.target.entity.context).startsWith("loam.")),
  );
}

const entity = (role, id, context) => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const prim = (role, value) => ({ role, target: { kind: "primitive", value } });

export const stampOf = (ctx) => {
  const timestamp = ctx.ts();
  return { timestamp, validFrom: Math.min(timestamp, Date.now()) };
};
export const heldNow = (claims) => ({
  ...claims,
  validFrom: Math.min(claims.validFrom, Date.now()),
});

const sign = (loam, ctx, pointers) =>
  loam.signClaims({ ...stampOf(ctx), author: ctx.author, pointers }, ctx.seed);

function mine(ctx) {
  const reactor = ctx.gateway.reactor;
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
        d.claims.author === ctx.author && d.sig !== undefined && isOnlyTutorial(d) && !struck(d.id),
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

export async function plantTerm(loam, ctx, lessonId, term, meaning) {
  if (readGlossary(ctx).some((e) => e.term === term)) return;
  await ctx.gateway.append(glossaryClaims(loam, ctx, lessonId, { term, meaning }));
}

export async function completeStep(loam, ctx, lesson, step, opts = {}) {
  const where = `lesson ${lesson.id}, step ${step.id}`;
  if (opts.workAlreadyDone !== true) {
    try {
      await step.run(ctx);
    } catch (err) {
      return { ok: false, failed: "run", message: `${where}: the store refused — ${err.message}` };
    }
  }
  if (opts.afterRun !== undefined) await opts.afterRun();
  const page = step.observe.page;
  if (opts.seePage !== undefined && page !== undefined && !opts.seePage(page)) {
    const looked =
      page.contains === undefined ? page.selector : `${page.selector} showing "${page.contains}"`;
    return {
      ok: false,
      failed: "page",
      workDone: true,
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

export function takeCheckpoint(storage, lesson, opts = {}) {
  const rows = {};
  const vouched = opts.holds === undefined ? undefined : new Set(opts.holds);
  for (const key of rowKeys(storage)) {
    if (vouched !== undefined && !vouched.has(key.slice(STORE_PREFIX.length))) continue;
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
        `no checkpoint was taken after ${opts.label ?? `lesson ${lesson}`}: this browser has no ` +
        `room for it (${err.name ?? "the write was refused"}). You cannot revert to this moment, ` +
        `and a later lesson that reaches back for it will say so. "Start over" frees the space.`,
    };
  }
  return { ok: true, lesson, rows: Object.keys(rows).length };
}

export async function bankCheckpoint(loam, ctx, lesson, opts = {}) {
  const holds = () => [...ctx.gateway.reactor.snapshot()].map((d) => d.id);
  const taken = takeCheckpoint(ctx.storage, lesson, { ...opts, holds: holds() });
  if (!taken.ok) return taken;
  if (readProgress(ctx).checkpoints.includes(lesson)) return taken;
  await ctx.gateway.append([
    sign(loam, ctx, [
      entity("checkpoint", `tutorial:checkpoint:${lesson}`, TUTORIAL_CONTEXTS.checkpoint),
      prim("lesson", lesson),
    ]),
  ]);
  const withClaim = takeCheckpoint(ctx.storage, lesson, { ...opts, holds: holds() });
  return withClaim.ok ? withClaim : taken;
}

function claimedId(value) {
  try {
    const row = typeof value === "string" ? JSON.parse(value) : null;
    return row !== null && typeof row === "object" && typeof row.id === "string"
      ? row.id
      : undefined;
  } catch {
    return undefined;
  }
}

function wirePointers(value) {
  try {
    const row = typeof value === "string" ? JSON.parse(value) : null;
    const pointers = row?.claims?.pointers;
    return Array.isArray(pointers) ? pointers : [];
  } catch {
    return [];
  }
}

function isErasureOrder(value) {
  return wirePointers(value).some((p) => String(p?.target?.context).startsWith("loam.erasure"));
}

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

function checkpointKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(CKPT_PREFIX)) keys.push(key);
  }
  return keys;
}

export function checkpointLessons(storage) {
  return checkpointKeys(storage)
    .map((key) => key.slice(CKPT_PREFIX.length))
    .filter((suffix) => String(Number(suffix)) === suffix && Number.isInteger(Number(suffix)))
    .map(Number)
    .sort((a, b) => a - b);
}

export function restoreCheckpoint(storage, lesson, opts = {}) {
  const blob = readCheckpoint(storage, lesson);
  if (blob === null) return { ok: false, message: `there is no readable checkpoint for ${lesson}` };
  const condemned = new Set(opts.erasedIds ?? []);
  const wanted = new Map();
  const refused = [];
  for (const [key, value] of Object.entries(blob.rows)) {
    if (!isRowKey(key) || typeof value !== "string") continue;
    const id = key.slice(STORE_PREFIX.length);
    if (condemned.has(id) || condemned.has(claimedId(value) ?? "")) {
      refused.push(id);
      continue;
    }
    wanted.set(key, value);
  }

  let restored = 0;
  try {
    for (const [key, value] of wanted) {
      if (storage.getItem(key) === value) continue;
      storage.setItem(key, value);
      restored += 1;
    }
  } catch (err) {
    return {
      ok: false,
      restored,
      refused,
      message:
        `the revert could not be written (${err.name ?? "the write was refused"}) — nothing was ` +
        `removed, and the ${restored} row(s) it did put back belong to that checkpoint. Free some ` +
        `space and try again.`,
    };
  }
  const keptOrders = [];
  const orders = new Set();
  const present = rowKeys(storage).filter((key) => !wanted.has(key));
  for (const [key, value] of wanted) {
    if (isErasureOrder(value)) orders.add(key.slice(STORE_PREFIX.length));
  }
  for (const key of present) {
    if (isErasureOrder(storage.getItem(key))) orders.add(key.slice(STORE_PREFIX.length));
  }
  for (const key of present) {
    const id = key.slice(STORE_PREFIX.length);
    const negates = wirePointers(storage.getItem(key)).some(
      (p) => typeof p?.target?.delta === "string" && orders.has(p.target.delta),
    );
    if (orders.has(id) || negates) {
      keptOrders.push(id);
      continue;
    }
    storage.removeItem(key);
  }
  return { ok: true, restored, refused, keptOrders };
}

export function clearCheckpoints(storage) {
  for (const key of checkpointKeys(storage)) storage.removeItem(key);
}

export function sweepCheckpoints(storage, erasedIds) {
  const dead = new Set(erasedIds);
  const destroyed = [];
  const kept = [];
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
    const held = [];
    for (const [rowKey, value] of Object.entries(blob.rows)) {
      const filed = isRowKey(rowKey) ? rowKey.slice(STORE_PREFIX.length) : undefined;
      const claimed = claimedId(value);
      if (filed !== undefined && dead.has(filed)) held.push(filed);
      else if (claimed !== undefined && dead.has(claimed)) held.push(claimed);
    }
    if (held.length === 0) {
      kept.push({ lesson });
      continue;
    }
    storage.removeItem(key);
    destroyed.push({
      lesson,
      ids: held,
      reason: `it held ${held.length === 1 ? "the erased record" : `${held.length} erased records`}`,
    });
  }
  return { destroyed, kept };
}
