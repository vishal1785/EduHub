/**
 * quiz.js
 * ---------------------------------------------------------------------
 * The quiz engine. Responsible for:
 *   - building a quiz (chapter practice, Quick 10, Mid-Term Mock, weak-area)
 *   - shuffling question order (fresh quizzes only - never on resume)
 *   - recording answers and scoring
 *
 * Two things are worth knowing before changing anything here:
 *
 * 1. QUESTION SOURCES. A chapter produces fresh randomised questions if
 *    data/syllabus.json gives it a "generators" field; every other chapter
 *    draws from the static bank in data/questions.json. For a generated
 *    chapter the static entries are held back as a fallback and only used
 *    if generation comes up short, otherwise the old repetition problem
 *    would leak straight back in.
 *
 *    Every builder therefore takes a `content` bundle - { questions,
 *    chapters } - rather than a bare question array, where `chapters` is
 *    the chapter index built from data/syllabus.json. Subject and chapter
 *    names come from there, so nothing in js/ has to be edited when the
 *    syllabus changes.
 *
 * 2. QUIZ STATE CARRIES ITS QUESTIONS. createQuizState() stores the full
 *    question objects, not just their ids. A generated question exists
 *    nowhere but in the quiz that created it, so resume and review would
 *    both break if we stored ids and looked them up in the bank later.
 *    `questionIds` is still written alongside for backwards compatibility
 *    with attempts saved by earlier versions of the app.
 *
 * Currently only the "mcq" question type is implemented, but every
 * function here is written against a generic `question` shape so that
 * true/false, fill-in-the-blank, numerical, etc. can be added later by
 * teaching gradeAnswer() how to grade the new type, without touching the
 * rest of the app.
 * ---------------------------------------------------------------------
 */

import { hasGenerator, generateForChapter } from "./generators.js";

/** How many fresh questions to mint per generated chapter when building a mixed pool. */
const GENERATED_PER_CHAPTER = 5;

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickRandom(array, count) {
  return shuffle(array).slice(0, count);
}

function newQuizId() {
  return `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Assemble the pool a mixed quiz draws from.
 *
 * `content` is { questions, chapters } - the static bank plus the chapter
 * index built from data/syllabus.json. Which chapters generate is decided
 * entirely by their "generators" field in the syllabus, so this function
 * needs no list of its own.
 *
 * Static questions belonging to a generated chapter are dropped in favour of
 * freshly generated ones; if a generator yields nothing for a chapter (it
 * never should, but the app must not go blank if it does) that chapter's
 * static questions are put back.
 */
function buildPool(content, perChapter = GENERATED_PER_CHAPTER) {
  const { questions, chapters } = content;
  const generated = Object.values(chapters).filter(hasGenerator);
  const generatedIds = new Set(generated.map((c) => c.id));
  const pool = questions.filter((q) => !generatedIds.has(q.chapterId));

  for (const chapter of generated) {
    const fresh = generateForChapter(chapter, perChapter);
    if (fresh.length) {
      pool.push(...fresh);
    } else {
      pool.push(...questions.filter((q) => q.chapterId === chapter.id));
    }
  }
  return pool;
}

/** Base shape shared by every quiz type. */
function createQuizState({ quizType, title, subject, chapterIds, questions }) {
  return {
    id: newQuizId(),
    quizType,
    title,
    subject: subject || "Mixed",
    // Full objects, so generated questions survive resume and review.
    questions,
    // Kept for older attempts and for any code that only needs the ids.
    questionIds: questions.map((q) => q.id),
    currentIndex: 0,
    answers: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    score: 0,
    total: questions.length,
    percentage: 0,
  };
}

/**
 * Practice / quiz for a single chapter.
 *
 * Generated chapters mint `count` brand-new questions every time, so the
 * same quiz is essentially never seen twice. Static chapters use their
 * whole bank, or as much of it as exists.
 */
function buildChapterQuiz(content, chapterId, count = 10) {
  const chapter = content.chapters[chapterId];
  if (!chapter) return createQuizState({ quizType: "practice", title: "", subject: "Mixed", chapterIds: [chapterId], questions: [] });

  const staticPool = content.questions.filter((q) => q.chapterId === chapterId);
  let selected;

  if (hasGenerator(chapter)) {
    const fresh = generateForChapter(chapter, count);
    if (fresh.length >= count) {
      selected = fresh;
    } else {
      // Generation came up short - top up from the hand-written bank.
      const topUp = pickRandom(staticPool, count - fresh.length);
      selected = shuffle([...fresh, ...topUp]);
    }
  } else {
    selected = shuffle(staticPool).slice(0, Math.min(count, staticPool.length));
  }

  return createQuizState({
    quizType: "practice",
    title: chapter.name,
    subject: chapter.subjectName,
    chapterIds: [chapterId],
    questions: selected,
  });
}

/** Quick 10 - mixed questions from one subject, or fully mixed if subjectName is null. */
function buildQuickPractice(content, subjectName, size = 10) {
  const all = buildPool(content);
  const pool = subjectName ? all.filter((q) => q.subject === subjectName) : all;
  const selected = pickRandom(pool, Math.min(size, pool.length));
  const chapterIds = [...new Set(selected.map((q) => q.chapterId))];
  return createQuizState({
    quizType: "quick10",
    title: subjectName ? `Quick 10 · ${subjectName}` : "Quick 10 · Mixed",
    subject: subjectName || "Mixed",
    chapterIds,
    questions: selected,
  });
}

/**
 * Mid-Term Mock - pulls a configurable number of questions per subject
 * (from data/config.json -> midTermMock.subjectCounts). Falls back to
 * however many are available if a subject has fewer questions than requested.
 */
function buildMockTest(content, mockConfig) {
  const pool = buildPool(content);
  const selected = [];
  for (const [subjectId, count] of Object.entries(mockConfig.subjectCounts || {})) {
    const subjectPool = pool.filter((q) => q.subject.toLowerCase() === subjectId.toLowerCase());
    selected.push(...pickRandom(subjectPool, Math.min(count, subjectPool.length)));
  }
  const shuffled = shuffle(selected);
  const chapterIds = [...new Set(shuffled.map((q) => q.chapterId))];
  return createQuizState({
    quizType: "mock",
    title: mockConfig.title || "Mid-Term Mock Test",
    subject: "Mixed",
    chapterIds,
    questions: shuffled,
  });
}

/** Weak-area practice - questions drawn only from the given (weak) chapter ids. */
function buildWeakAreaQuiz(content, weakChapterIds, size = 10) {
  const pool = buildPool(content).filter((q) => weakChapterIds.includes(q.chapterId));
  const selected = pickRandom(pool, Math.min(size, pool.length));
  return createQuizState({
    quizType: "weak",
    title: "Needs Practice",
    subject: "Mixed",
    chapterIds: weakChapterIds,
    questions: selected,
  });
}

/**
 * The questions belonging to a saved quiz or attempt, in order.
 *
 * New records embed them. Records written before questions were embedded
 * only have ids, so those are resolved against the static bank instead.
 */
function questionsOf(quizState, allQuestions = []) {
  if (Array.isArray(quizState.questions) && quizState.questions.length) {
    return quizState.questions;
  }
  const map = new Map(allQuestions.map((q) => [q.id, q]));
  return (quizState.questionIds || []).map((id) => map.get(id)).filter(Boolean);
}

/** Grade a single MCQ answer. Returns true/false. Built to be extended per question type. */
function gradeAnswer(question, selectedAnswer) {
  if (question.type === "mcq") {
    return selectedAnswer === question.answer;
  }
  // Future question types (true/false, numerical, fill-blank...) hook in here.
  return false;
}

/** Record an answer against the active quiz state (mutates and returns it). */
function answerQuestion(quizState, question, selectedAnswer) {
  const correct = gradeAnswer(question, selectedAnswer);
  quizState.answers.push({
    questionId: question.id,
    subject: question.subject,
    chapterId: question.chapterId,
    chapter: question.chapter,
    selectedAnswer,
    correct,
    answeredAt: new Date().toISOString(),
  });
  return correct;
}

function isComplete(quizState) {
  return quizState.answers.length >= quizState.total;
}

/** Finalise a quiz: compute score/percentage and stamp completedAt. */
function finalizeQuiz(quizState) {
  const score = quizState.answers.filter((a) => a.correct).length;
  quizState.score = score;
  quizState.percentage = quizState.total ? Math.round((score / quizState.total) * 100) : 0;
  quizState.completedAt = new Date().toISOString();
  return quizState;
}

export const quizEngine = {
  shuffle,
  pickRandom,
  buildPool,
  buildChapterQuiz,
  buildQuickPractice,
  buildMockTest,
  buildWeakAreaQuiz,
  questionsOf,
  gradeAnswer,
  answerQuestion,
  isComplete,
  finalizeQuiz,
};
