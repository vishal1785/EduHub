/**
 * quiz.js
 * ---------------------------------------------------------------------
 * The quiz engine. Responsible for:
 *   - building a quiz (chapter practice, Quick 10, Mid-Term Mock, weak-area)
 *   - shuffling question order (fresh quizzes only - never on resume)
 *   - recording answers and scoring
 *
 * Currently only the "mcq" question type is implemented, but every
 * function here is written against a generic `question` shape so that
 * true/false, fill-in-the-blank, numerical, etc. can be added later by
 * teaching answerQuestion() how to grade the new type, without touching
 * the rest of the app.
 * ---------------------------------------------------------------------
 */

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

/** Base shape shared by every quiz type. */
function createQuizState({ quizType, title, subject, chapterIds, questions }) {
  return {
    id: newQuizId(),
    quizType,
    title,
    subject: subject || "Mixed",
    chapterIds: chapterIds || [],
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

/** Practice / quiz for a single chapter. Uses every question if fewer than `count` exist. */
function buildChapterQuiz(allQuestions, subject, chapterId, chapterName, count = 10) {
  const pool = allQuestions.filter((q) => q.chapterId === chapterId);
  const selected = shuffle(pool).slice(0, Math.min(count, pool.length));
  return createQuizState({
    quizType: "practice",
    title: chapterName,
    subject,
    chapterIds: [chapterId],
    questions: selected,
  });
}

/** Quick 10 - mixed questions from one subject, or fully mixed if subjectId is null. */
function buildQuickPractice(allQuestions, subjectName, size = 10) {
  const pool = subjectName
    ? allQuestions.filter((q) => q.subject === subjectName)
    : allQuestions;
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
function buildMockTest(allQuestions, mockConfig) {
  const selected = [];
  for (const [subjectId, count] of Object.entries(mockConfig.subjectCounts || {})) {
    const pool = allQuestions.filter((q) => q.subject.toLowerCase() === subjectId.toLowerCase());
    selected.push(...pickRandom(pool, Math.min(count, pool.length)));
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
function buildWeakAreaQuiz(allQuestions, weakChapterIds, size = 10) {
  const pool = allQuestions.filter((q) => weakChapterIds.includes(q.chapterId));
  const selected = pickRandom(pool, Math.min(size, pool.length));
  return createQuizState({
    quizType: "weak",
    title: "Needs Practice",
    subject: "Mixed",
    chapterIds: weakChapterIds,
    questions: selected,
  });
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
  buildChapterQuiz,
  buildQuickPractice,
  buildMockTest,
  buildWeakAreaQuiz,
  answerQuestion,
  isComplete,
  finalizeQuiz,
};
