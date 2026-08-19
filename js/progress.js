/**
 * progress.js
 * ---------------------------------------------------------------------
 * Pure functions that turn a list of `attempts` (from storage.js) into
 * the statistics the UI needs: overall accuracy, per-subject accuracy,
 * per-chapter accuracy, weak areas and streaks.
 *
 * Nothing here touches IndexedDB directly - it only receives data and
 * returns derived numbers, which keeps it easy to test and reuse.
 * ---------------------------------------------------------------------
 */

/** Flatten every answer across every attempt into one array, tagged with subject/chapter. */
function allAnswers(attempts) {
  const rows = [];
  for (const attempt of attempts) {
    if (!attempt.answers) continue;
    for (const ans of attempt.answers) {
      rows.push({
        ...ans,
        subject: attempt.subject,
        chapterIds: attempt.chapterIds || [],
      });
    }
  }
  return rows;
}

function pct(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/** Overall accuracy + totals across every completed attempt. */
function computeOverall(attempts) {
  const completed = attempts.filter((a) => a.completedAt);
  const totalQuestions = completed.reduce((sum, a) => sum + (a.total || 0), 0);
  const totalCorrect = completed.reduce((sum, a) => sum + (a.score || 0), 0);
  return {
    testsCompleted: completed.length,
    questionsAttempted: totalQuestions,
    accuracy: pct(totalCorrect, totalQuestions),
  };
}

/** Accuracy grouped by subject name, e.g. { Maths: { correct, total, accuracy } }. */
function computeSubjectAccuracy(attempts) {
  const completed = attempts.filter((a) => a.completedAt);
  const bySubject = {};
  for (const attempt of completed) {
    // Mixed-subject attempts (Quick 10 / Mock) contribute per-question via answers+questionId subject
    const subject = attempt.subject;
    if (subject && subject !== "Mixed") {
      if (!bySubject[subject]) bySubject[subject] = { correct: 0, total: 0 };
      bySubject[subject].correct += attempt.score || 0;
      bySubject[subject].total += attempt.total || 0;
    } else if (Array.isArray(attempt.answers)) {
      for (const ans of attempt.answers) {
        const s = ans.subject || "Mixed";
        if (!bySubject[s]) bySubject[s] = { correct: 0, total: 0 };
        bySubject[s].total += 1;
        if (ans.correct) bySubject[s].correct += 1;
      }
    }
  }
  const result = {};
  for (const [subject, { correct, total }] of Object.entries(bySubject)) {
    result[subject] = { correct, total, accuracy: pct(correct, total) };
  }
  return result;
}

/** Accuracy grouped by chapterId, including subject + chapter name for display. */
function computeChapterAccuracy(attempts) {
  const rows = allAnswers(attempts);
  const byChapter = {};
  for (const row of rows) {
    const chapterId = row.chapterId;
    if (!chapterId) continue;
    if (!byChapter[chapterId]) {
      byChapter[chapterId] = {
        chapterId,
        subject: row.subject,
        chapter: row.chapter,
        correct: 0,
        total: 0,
        lastPracticed: null,
      };
    }
    const entry = byChapter[chapterId];
    entry.total += 1;
    if (row.correct) entry.correct += 1;
    if (row.answeredAt && (!entry.lastPracticed || row.answeredAt > entry.lastPracticed)) {
      entry.lastPracticed = row.answeredAt;
    }
  }
  for (const entry of Object.values(byChapter)) {
    entry.accuracy = pct(entry.correct, entry.total);
  }
  return byChapter;
}

/**
 * Chapters below `weakThreshold` accuracy (with a minimum attempt count so
 * a single unlucky question doesn't brand a chapter "weak").
 */
function computeWeakAreas(attempts, weakThreshold = 60, minAttempts = 3) {
  const byChapter = computeChapterAccuracy(attempts);
  return Object.values(byChapter)
    .filter((c) => c.total >= minAttempts && c.accuracy < weakThreshold)
    .sort((a, b) => a.accuracy - b.accuracy);
}

/** Label helper used across chapter/subject screens. */
function performanceLabel(accuracy, attempted, weakThreshold = 60, strongThreshold = 80) {
  if (!attempted) return "Not attempted";
  if (accuracy < weakThreshold) return "Needs Practice";
  if (accuracy >= strongThreshold) return "Strong";
  return "Improving";
}

/** Compute current daily streak from attempt completion dates (local dates). */
function computeStreak(attempts) {
  const completed = attempts.filter((a) => a.completedAt);
  if (!completed.length) return 0;

  const dateStrings = new Set(
    completed.map((a) => new Date(a.completedAt).toDateString())
  );

  let streak = 0;
  const cursor = new Date();
  // Today counts if practised today; otherwise the streak is "broken" for today
  // but we still count backwards from yesterday so a same-day check doesn't
  // zero out a streak that's simply waiting for today's practice.
  if (!dateStrings.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dateStrings.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Strongest / weakest subject helpers for the dashboard headline. */
function strongestAndWeakestSubjects(subjectAccuracy) {
  const entries = Object.entries(subjectAccuracy).filter(([, v]) => v.total > 0);
  if (!entries.length) return { strongest: null, weakest: null };
  entries.sort((a, b) => b[1].accuracy - a[1].accuracy);
  return {
    strongest: { subject: entries[0][0], ...entries[0][1] },
    weakest: { subject: entries[entries.length - 1][0], ...entries[entries.length - 1][1] },
  };
}

export const progressEngine = {
  computeOverall,
  computeSubjectAccuracy,
  computeChapterAccuracy,
  computeWeakAreas,
  performanceLabel,
  computeStreak,
  strongestAndWeakestSubjects,
};
