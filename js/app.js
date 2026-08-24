/**
 * app.js
 * ---------------------------------------------------------------------
 * Application entry point: loads content data, sets up hash-based
 * routing, and renders every screen. Business logic (storage, quiz
 * building, progress math) lives in storage.js / quiz.js / progress.js —
 * this file is mostly "glue" that turns that logic into HTML.
 * ---------------------------------------------------------------------
 */

import { storage } from "./storage.js";
import { quizEngine } from "./quiz.js";
import { hasGenerator, unknownFamilies } from "./generators.js";
import { progressEngine } from "./progress.js";
import { escapeHtml, ringSvg, barHtml, letterFor, showToast, confirmDialog, formatDateGroup, formatTime } from "./ui.js";

const appEl = document.getElementById("app");
const bottomNavInner = document.getElementById("bottom-nav-inner");

/** All content data, loaded once at startup. */
const DATA = {
  subjects: [],
  syllabus: {},
  questions: [],
  config: {},
};

/**
 * The student's name, and whether the welcome screen has been dealt with.
 *
 * Both live in the `settings` store. They are cached here so every render
 * does not have to await IndexedDB just to draw a greeting; setStudentName()
 * is the single place that writes, so the cache cannot drift.
 */
let studentName = "";
let onboarded = false;

/** Longest name we will store - keeps the greeting on one line. */
const MAX_NAME_LENGTH = 24;

/** chapterId -> { id, name, description, number, subjectId, subjectName } */
let chapterIndex = {};
/** subjectId -> subject meta */
let subjectIndex = {};

let dataReady = false;

/* ============================== DATA LOADING ============================== */

async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

async function loadData() {
  const [subjects, syllabus, questions, config] = await Promise.all([
    loadJSON("data/subjects.json"),
    loadJSON("data/syllabus.json"),
    loadJSON("data/questions.json"),
    loadJSON("data/config.json"),
  ]);
  DATA.subjects = subjects;
  DATA.syllabus = syllabus;
  DATA.questions = questions;
  DATA.config = config;

  subjectIndex = {};
  for (const s of subjects) subjectIndex[s.id] = s;

  chapterIndex = {};
  for (const [subjectId, chapters] of Object.entries(syllabus)) {
    const subject = subjectIndex[subjectId];
    for (const ch of chapters) {
      chapterIndex[ch.id] = { ...ch, subjectId, subjectName: subject ? subject.name : subjectId };
    }
  }
  // A mistyped "generators" entry in syllabus.json would otherwise show up
  // only as a chapter that quietly stopped generating. Say so plainly.
  for (const ch of Object.values(chapterIndex)) {
    const unknown = unknownFamilies(ch);
    if (unknown.length) {
      console.warn(`[syllabus] chapter "${ch.id}" asks for unknown generator families: ${unknown.join(", ")}`);
    }
  }

  dataReady = true;
}

/** Read the stored name and onboarding flag into the module cache. */
async function loadStudent() {
  const [name, flag] = await Promise.all([
    storage.getSetting("studentName", ""),
    storage.getSetting("onboarded", false),
  ]);
  studentName = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
  // Someone who already has a name from an earlier version has plainly been
  // through onboarding, so never ask them.
  onboarded = flag === true || !!studentName;
}

/** Persist the name (empty string clears it) and mark onboarding as done. */
async function setStudentName(name) {
  studentName = (name || "").trim().slice(0, MAX_NAME_LENGTH);
  onboarded = true;
  await Promise.all([
    storage.setSetting("studentName", studentName),
    storage.setSetting("onboarded", true),
  ]);
}

/**
 * What the quiz engine needs: the static bank plus the chapter index built
 * from data/syllabus.json. Passing both means the engine never has to know
 * any chapter id itself.
 */
function content() {
  return { questions: DATA.questions, chapters: chapterIndex };
}

function questionsForChapter(chapterId) {
  return DATA.questions.filter((q) => q.chapterId === chapterId);
}

/**
 * Can this chapter be practised at all? True if it has hand-written
 * questions in the bank, or if generators.js can mint them on demand.
 * Everything else shows the "Content coming soon" note.
 */
function chapterHasContent(chapterId) {
  return hasGenerator(chapterIndex[chapterId]) || questionsForChapter(chapterId).length > 0;
}

/* ================================ ROUTER =================================== */

function currentRoute() {
  const hash = location.hash || "#/home";
  const parts = hash.replace(/^#\//, "").split("/");
  return { name: parts[0] || "home", param: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function navigate(hash) {
  if (location.hash === hash) {
    renderRoute();
  } else {
    location.hash = hash;
  }
}

const NAV_ROUTES = { home: "#/home", practice: "#/practice", tests: "#/tests", progress: "#/progress", more: "#/more" };

function updateBottomNav(routeName) {
  const activeGroup = ["home"].includes(routeName)
    ? "home"
    : ["practice", "subject", "chapter", "quiz"].includes(routeName)
    ? "practice"
    : ["tests", "result", "review"].includes(routeName)
    ? "tests"
    : ["progress"].includes(routeName)
    ? "progress"
    : ["more"].includes(routeName)
    ? "more"
    : "home";

  bottomNavInner.querySelectorAll(".nav-item").forEach((el) => {
    const route = el.getAttribute("data-route");
    const key = Object.keys(NAV_ROUTES).find((k) => NAV_ROUTES[k] === route);
    el.classList.toggle("active", key === activeGroup);
  });
}

async function renderRoute() {
  if (!dataReady) return;
  let { name, param } = currentRoute();

  // Until the welcome screen has been dealt with, it is the only screen.
  if (!onboarded && name !== "welcome") {
    return navigate("#/welcome");
  }
  // ...and once it has, there is nothing to go back to.
  if (onboarded && name === "welcome") {
    return navigate("#/home");
  }

  // The welcome screen hides the bottom nav so it has one obvious next step.
  document.body.classList.toggle("no-nav", name === "welcome");

  updateBottomNav(name);
  window.scrollTo(0, 0);

  try {
    switch (name) {
      case "welcome": return renderWelcome();
      case "home": return await renderHome();
      case "practice": return await renderPractice();
      case "subject": return await renderSubject(param);
      case "chapter": return await renderChapter(param);
      case "quiz": return await renderQuiz(param);
      case "result": return await renderResult(param);
      case "review": return await renderReview(param);
      case "tests": return await renderTests();
      case "progress": return await renderProgress();
      case "more": return await renderMore();
      default: return await renderHome();
    }
  } catch (err) {
    console.error(err);
    renderCrashState(err);
  }
}

function renderCrashState(err) {
  appEl.innerHTML = `
    <div class="screen">
      <div class="empty-state">
        <div class="emoji">⚠️</div>
        <div class="title">Something went wrong</div>
        <div class="desc">${escapeHtml(err.message || "Please try going back home.")}</div>
      </div>
      <a class="btn-primary" style="display:block;margin-top:18px;" href="#/home">Back Home</a>
    </div>`;
}

/* =============================== WELCOME ================================== */

/**
 * First-run screen. Asks for the student's name so the app can greet them
 * by it. Skipping is allowed - the name is a nicety, not a login - and
 * skipping still marks onboarding done so the screen is not shown again.
 * Either way it can be changed later from More.
 */
function renderWelcome() {
  appEl.innerHTML = `
    <div class="welcome">
      <div class="welcome-emoji" aria-hidden="true">📚</div>
      <h1>Welcome to Class 7 Practice</h1>
      <p>Practise your chapters, take mock tests and watch your progress build up. First, what should we call you?</p>

      <label class="field-label" for="student-name">Your name</label>
      <input class="text-input" type="text" id="student-name" maxlength="${MAX_NAME_LENGTH}"
             placeholder="e.g. Aarav" autocomplete="given-name" autocapitalize="words" />

      <button class="btn-primary" id="btn-welcome-start" type="button" disabled>Get Started</button>
      <button class="welcome-skip" id="btn-welcome-skip" type="button">Skip for now</button>

      <div class="welcome-note">Everything stays on this device. Nothing is sent anywhere, and there is no account to create.</div>
    </div>`;

  const input = document.getElementById("student-name");
  const startBtn = document.getElementById("btn-welcome-start");

  const sync = () => (startBtn.disabled = !input.value.trim());
  const start = async () => {
    if (!input.value.trim()) return;
    startBtn.disabled = true;
    await setStudentName(input.value);
    navigate("#/home");
  };

  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") start();
  });
  startBtn.addEventListener("click", start);
  document.getElementById("btn-welcome-skip").addEventListener("click", async () => {
    await setStudentName("");
    navigate("#/home");
  });

  sync();
  input.focus();
}

/* ================================ HOME ===================================== */

async function renderHome() {
  appEl.innerHTML = skeletonScreen();
  const [attempts, activeQuizzes] = await Promise.all([storage.getAttempts(), storage.getActiveQuizzes()]);
  const overall = progressEngine.computeOverall(attempts);
  const streak = progressEngine.computeStreak(attempts);

  const subjectTiles = DATA.subjects
    .map(
      (s) => `
      <a class="subject-tile" href="#/subject/${s.id}">
        <span class="icon" aria-hidden="true">${s.icon}</span>
        <span class="name">${escapeHtml(s.name)}</span>
      </a>`
    )
    .join("");

// One card per in-progress quiz. Each quiz type has its own slot, so a
  // half-finished Mid-Term Mock stays here even after a Quick 10 is started.
  let continueCard = "";
  if (activeQuizzes.length) {
    const cards = activeQuizzes
      .map((q) => {
        const done = q.answers.length;
        return `
      <a class="card continue-card" href="#/quiz/${encodeURIComponent(q.quizType)}">
        <div class="body">
          <div class="title">${escapeHtml(q.title)}${q.quizType === "mock" ? " 🏆" : ""}</div>
          <div class="meta">Question ${Math.min(done + 1, q.total)} of ${q.total}</div>
          ${barHtml((done / q.total) * 100)}
        </div>
        <span class="arrow" aria-hidden="true">→</span>
      </a>`;
      })
      .join("");
    continueCard = `
      <div class="section-title">Continue Learning</div>
      ${cards}`;
  }

  appEl.innerHTML = `
    <div class="screen">
      <div class="greeting">Hi${studentName ? ", " + escapeHtml(studentName) : ""}! 👋</div>
      <div class="greeting-sub">Ready to practise?</div>

      <div class="stat-row">
        <div class="card ring-card">
          <div class="ring-wrap">${ringSvg(overall.accuracy)}<div class="ring-value">${overall.accuracy}%</div></div>
          <div>
            <div class="ring-label-title">Accuracy</div>
            <div class="ring-label-sub">${overall.questionsAttempted} questions · ${overall.testsCompleted} tests</div>
          </div>
        </div>
        <div class="card streak-card">
          <div class="streak-flame" aria-hidden="true">🔥</div>
          <div class="streak-num">${streak}</div>
          <div class="streak-text">day streak</div>
        </div>
      </div>

      <div class="section-title">Subjects</div>
      <div class="subject-grid">${subjectTiles}</div>

      ${continueCard}

      <div class="section-title">Quick Practice</div>
      <div class="quick-actions">
        <button class="action-btn primary" id="btn-quick10"><span class="emoji">⚡</span> Quick 10</button>
        <button class="action-btn accent" id="btn-mock"><span class="emoji">🏆</span> ${activeQuizzes.some((q) => q.quizType === "mock") ? "Resume Mock" : "Mid-Term Mock"}</button>
      </div>
    </div>`;

  document.getElementById("btn-quick10").addEventListener("click", () => startQuick10(null));
  document.getElementById("btn-mock").addEventListener("click", () => startMock());
}

function skeletonScreen() {
  return `<div class="screen"><div class="skeleton" style="height:90px;margin-bottom:16px;"></div><div class="skeleton" style="height:220px;"></div></div>`;
}

/* =============================== PRACTICE HUB =============================== */

async function renderPractice() {
  const attempts = await storage.getAttempts();
  const subjectAcc = progressEngine.computeSubjectAccuracy(attempts);

  const rows = DATA.subjects
    .map((s) => {
      const acc = subjectAcc[s.name];
      const pct = acc ? acc.accuracy : 0;
      const label = acc ? `${pct}% accuracy` : "Not started yet";
      return `
      <a class="chapter-row" href="#/subject/${s.id}">
        <div class="status-dot">${s.icon}</div>
        <div class="info">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="meta">${label}</div>
        </div>
        <span class="chev" aria-hidden="true">›</span>
      </a>`;
    })
    .join("");

  appEl.innerHTML = `
    <div class="screen">
      <div class="greeting" style="font-size:1.3rem;">Practice</div>
      <div class="greeting-sub">Choose a subject to get started</div>
      <div class="chapter-list">${rows}</div>
    </div>`;
}

/* ================================ SUBJECT =================================== */

async function renderSubject(subjectId) {
  const subject = subjectIndex[subjectId];
  if (!subject) return renderCrashState(new Error("That subject couldn't be found."));

  const chapters = DATA.syllabus[subjectId] || [];
  const attempts = await storage.getAttempts();
  const chapterAcc = progressEngine.computeChapterAccuracy(attempts);
  const subjectAcc = progressEngine.computeSubjectAccuracy(attempts)[subject.name];
  const { weakThreshold, strongThreshold } = DATA.config;

  const rows = chapters
    .map((ch) => {
      const hasContent = chapterHasContent(ch.id);
      const stat = chapterAcc[ch.id];
      const attempted = !!stat && stat.total > 0;
      const label = progressEngine.performanceLabel(stat ? stat.accuracy : 0, attempted, weakThreshold, strongThreshold);
      const rowClass = !attempted ? "" : label === "Needs Practice" ? "weak" : label === "Strong" ? "strong" : "";
      const dot = attempted ? `${stat.accuracy}%` : hasContent ? "○" : "–";
      const meta = !hasContent ? "Content coming soon" : attempted ? `${stat.accuracy}% accuracy` : "Not attempted";
      const badge =
        attempted && label !== "Improving" ? `<span class="badge ${label === "Strong" ? "strong" : "weak"}">${label}</span>` : "";
      return `
      <a class="chapter-row ${rowClass}" href="#/chapter/${ch.id}">
        <div class="status-dot">${dot}</div>
        <div class="info">
          <div class="name">${ch.number ? `Ch. ${ch.number} · ` : ""}${escapeHtml(ch.name)}</div>
          <div class="meta">${meta}${badge}</div>
        </div>
        <span class="chev" aria-hidden="true">›</span>
      </a>`;
    })
    .join("");

  appEl.innerHTML = `
    <div class="screen">
      <div class="topbar" style="padding:0 0 4px;">
        <a class="back-btn" href="#/practice" aria-label="Back to Practice">←</a>
      </div>
      <div class="subject-hero">
        <div class="icon-badge" aria-hidden="true">${subject.icon}</div>
        <h1>${escapeHtml(subject.name)}</h1>
      </div>
      <div class="subject-progress-row">
        ${barHtml(subjectAcc ? subjectAcc.accuracy : 0)}
        <span class="pct">${subjectAcc ? subjectAcc.accuracy : 0}%</span>
      </div>
      <div class="section-title">Chapters</div>
      <div class="chapter-list">${rows || `<div class="empty-note">No chapters configured yet.</div>`}</div>
    </div>`;
}

/* ================================ CHAPTER =================================== */

async function renderChapter(chapterId) {
  const ch = chapterIndex[chapterId];
  if (!ch) return renderCrashState(new Error("That chapter couldn't be found."));

  const attempts = await storage.getAttempts();
  const chapterAcc = progressEngine.computeChapterAccuracy(attempts)[chapterId];
  const attempted = !!chapterAcc && chapterAcc.total > 0;

  const lastPracticed = attempted && chapterAcc.lastPracticed ? new Date(chapterAcc.lastPracticed).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

  const hasQuestions = chapterHasContent(chapterId);

  appEl.innerHTML = `
    <div class="screen">
      <div class="topbar" style="padding:0 0 4px;">
        <a class="back-btn" href="#/subject/${ch.subjectId}" aria-label="Back">←</a>
      </div>
      <h1 style="font-size:1.25rem;">${ch.number ? `Chapter ${ch.number} · ` : ""}${escapeHtml(ch.name)}</h1>
      ${ch.description ? `<p class="chapter-desc">${escapeHtml(ch.description)}</p>` : ""}

      <div class="stat-mini-row">
        <div class="stat-mini"><div class="num">${attempted ? chapterAcc.total : 0}</div><div class="lbl">Attempted</div></div>
        <div class="stat-mini"><div class="num">${attempted ? chapterAcc.accuracy + "%" : "—"}</div><div class="lbl">Accuracy</div></div>
        <div class="stat-mini"><div class="num">${lastPracticed}</div><div class="lbl">Last practised</div></div>
      </div>

      ${
        hasQuestions
          ? `<div class="btn-stack">
              <button class="btn-primary" id="btn-practise">Practise · 10 questions</button>
              <button class="btn-secondary" id="btn-quickquiz">Quick Quiz · 5 questions</button>
            </div>`
          : `<div class="empty-note">📚 Content coming soon for this chapter. Check back once questions have been added.</div>`
      }
    </div>`;

  if (hasQuestions) {
    document.getElementById("btn-practise").addEventListener("click", () => startChapterQuiz(ch, 10));
    document.getElementById("btn-quickquiz").addEventListener("click", () => startChapterQuiz(ch, 5));
  }
}

/* ================================== QUIZ START HELPERS ============================ */

/**
 * Each quiz type has its own in-progress slot, so starting a quiz only ever
 * risks the unfinished quiz OF THE SAME TYPE. When there is one, offer to
 * resume it rather than throwing the work away without asking.
 *
 * Returns true if the caller should stop (we resumed, or the student backed
 * out), false if it is fine to start something new.
 */
async function offerResume(quizType, label) {
  const existing = await storage.getActiveQuiz(quizType);
  if (!existing || !existing.total || !existing.answers.length) return false;

  const done = existing.answers.length;
  // "Start new" is the destructive choice, so it is the confirm button (styled
  // red) and "Resume" is the cancel. Dismissing the dialog by tapping outside
  // therefore resumes rather than quietly binning the student's work.
  const startNew = await confirmDialog({
    title: `${label} is unfinished`,
    message: `You are on question ${Math.min(done + 1, existing.total)} of ${existing.total}. Starting a new one will discard that progress.`,
    okLabel: "Start new",
    cancelLabel: "Resume",
  });
  if (!startNew) {
    navigate(`#/quiz/${encodeURIComponent(quizType)}`);
    return true;
  }
  return false;
}

async function startQuiz(quiz, emptyMessage) {
  if (quiz.total === 0) return showToast(emptyMessage);
  await storage.saveActiveQuiz(quiz);
  navigate(`#/quiz/${encodeURIComponent(quiz.quizType)}`);
}

async function startChapterQuiz(ch, count) {
  if (await offerResume("practice", "Your last practice quiz")) return;
  return startQuiz(quizEngine.buildChapterQuiz(content(), ch.id, count), "No questions available yet for this chapter.");
}

async function startQuick10(subjectName) {
  if (await offerResume("quick10", "Your Quick 10")) return;
  return startQuiz(quizEngine.buildQuickPractice(content(), subjectName, DATA.config.quickPracticeSize || 10), "No questions available yet.");
}

async function startMock() {
  if (await offerResume("mock", "The Mid-Term Mock")) return;
  return startQuiz(quizEngine.buildMockTest(content(), DATA.config.midTermMock || {}), "No questions available yet for the mock test.");
}

async function startWeakPractice(weakChapterIds) {
  if (await offerResume("weak", "Your Needs Practice quiz")) return;
  return startQuiz(quizEngine.buildWeakAreaQuiz(content(), weakChapterIds, DATA.config.quickPracticeSize || 10), "No questions available for these chapters yet.");
}

/* ==================================== QUIZ SCREEN =================================== */

async function renderQuiz(quizType) {
  // With no type in the route, fall back to the most recently saved quiz -
  // which keeps older "#/quiz" links (and the back button) working.
  const activeQuiz = await storage.getActiveQuiz(quizType || null);
  if (!activeQuiz || !activeQuiz.total) {
    showToast("No active quiz right now.");
    return navigate("#/home");
  }

  // Fresh quizzes embed their questions; older saved quizzes only stored
  // ids, so questionsOf() resolves those against the static bank.
  const orderedQuestions = quizEngine.questionsOf(activeQuiz, DATA.questions);

  if (orderedQuestions.length !== activeQuiz.total) {
    // Content changed since the quiz was started - fail gracefully.
    await storage.clearActiveQuiz(activeQuiz.quizType);
    showToast("This quiz's questions changed. Please start a new one.");
    return navigate("#/home");
  }

  appEl.innerHTML = `
    <div class="quiz-header">
      <div class="topbar" style="padding:0 0 10px;">
        <a class="back-btn" href="#/home" aria-label="Exit quiz">←</a>
      </div>
      <div class="quiz-title-row">
        <span class="qtitle">${escapeHtml(activeQuiz.title)}</span>
        <span class="qcount" id="q-count"></span>
      </div>
      <div class="quiz-progress-track"><div class="quiz-progress-fill" id="q-progress-fill"></div></div>
    </div>
    <div id="quiz-body"></div>
    <div class="quiz-footer" id="quiz-footer"></div>`;

  let currentIndex = activeQuiz.answers.length;

  function showQuestion(index) {
    if (index >= activeQuiz.total) {
      return finishQuiz();
    }
    const question = orderedQuestions[index];
    document.getElementById("q-count").textContent = `Question ${index + 1} of ${activeQuiz.total}`;
    document.getElementById("q-progress-fill").style.width = `${(index / activeQuiz.total) * 100}%`;

    const optionsHtml = question.options
      .map(
        (opt, i) => `
        <button class="option" data-index="${i}" type="button">
          <span class="letter">${letterFor(i)}</span>
          <span class="opt-text">${escapeHtml(opt)}</span>
        </button>`
      )
      .join("");

    document.getElementById("quiz-body").innerHTML = `
      <div class="question-card">
        <div class="question-text">${escapeHtml(question.question)}</div>
        <div class="options" id="options-wrap">${optionsHtml}</div>
      </div>`;
    document.getElementById("quiz-footer").innerHTML = "";

    document.querySelectorAll("#options-wrap .option").forEach((btn) => {
      btn.addEventListener("click", () => handleAnswer(question, parseInt(btn.dataset.index, 10), index));
    });
  }

  async function handleAnswer(question, selectedIndex, index) {
    const optionButtons = document.querySelectorAll("#options-wrap .option");
    optionButtons.forEach((b) => (b.disabled = true));

    const correct = quizEngine.answerQuestion(activeQuiz, question, selectedIndex);
    await storage.saveActiveQuiz(activeQuiz);

    optionButtons.forEach((btn) => {
      const i = parseInt(btn.dataset.index, 10);
      if (i === question.answer) btn.classList.add("correct");
      else if (i === selectedIndex) btn.classList.add("incorrect");
      else btn.classList.add("dimmed");
      if (i === selectedIndex && i !== question.answer) btn.classList.add("selected");
    });

    document.getElementById("quiz-body").insertAdjacentHTML(
      "beforeend",
      `<div class="feedback-panel ${correct ? "correct" : "incorrect"}">
        <div class="feedback-head">${correct ? "✓ Correct!" : "✕ Not quite."}</div>
        ${!correct ? `<div class="feedback-correct-answer">Correct answer: <strong>${letterFor(question.answer)}. ${escapeHtml(question.options[question.answer])}</strong></div>` : ""}
        <div class="feedback-why-label">Why?</div>
        <div class="feedback-why">${escapeHtml(question.explanation)}</div>
      </div>`
    );

    const isLast = index + 1 >= activeQuiz.total;
    document.getElementById("quiz-footer").innerHTML = `
      <button class="btn-primary" id="btn-next">${isLast ? "See Results →" : "Next Question →"}</button>`;
    document.getElementById("btn-next").addEventListener("click", () => {
      currentIndex = index + 1;
      showQuestion(currentIndex);
    });
    document.getElementById("btn-next").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function finishQuiz() {
    quizEngine.finalizeQuiz(activeQuiz);
    const saved = await storage.saveAttempt(activeQuiz);
    await storage.clearActiveQuiz(activeQuiz.quizType);
    navigate(`#/result/${encodeURIComponent(saved.id)}`);
  }

  showQuestion(currentIndex);
}

/* =================================== RESULT ==================================== */

async function renderResult(attemptId) {
  const attempt = await storage.getAttempt(attemptId);
  if (!attempt) {
    appEl.innerHTML = emptyState("🔍", "Result not found", "This test result may have been removed.");
    return;
  }

  const pct = attempt.percentage;
  const emoji = pct >= 80 ? "🎉" : pct >= 60 ? "👍" : "💪";
  const title = pct >= 80 ? "Great job!" : pct >= 60 ? "Nice work!" : "Keep practising!";
  const toReview = attempt.total - attempt.score;
  const timeMs = attempt.completedAt && attempt.startedAt ? new Date(attempt.completedAt) - new Date(attempt.startedAt) : null;
  const timeStr = formatTime(timeMs);

  appEl.innerHTML = `
    <div class="screen">
      <div class="result-hero celebrate">
        <div class="result-emoji">${emoji}</div>
        <div class="result-title">${title}</div>
        <div class="result-ring-wrap">${ringSvg(pct, 160, 14, pct >= 60 ? "var(--success)" : "var(--accent)")}<div class="result-pct">${pct}%</div></div>
      </div>
      <div class="result-stats-row">
        <div class="result-stat"><div class="num">${attempt.score}</div><div class="lbl">Correct</div></div>
        <div class="result-stat"><div class="num">${toReview}</div><div class="lbl">To review</div></div>
        <div class="result-stat"><div class="num">${attempt.total}</div><div class="lbl">Total</div></div>
      </div>
      ${timeStr ? `<p style="text-align:center;color:var(--muted);font-size:0.85rem;margin-bottom:18px;">⏱ Time taken: ${timeStr}</p>` : ""}
      <div class="btn-stack">
        <button class="btn-primary" id="btn-review">Review Answers</button>
        <button class="btn-secondary" id="btn-again">Practise Again</button>
        <a class="btn-secondary" href="#/home" style="display:block;">Back Home</a>
      </div>
    </div>`;

  document.getElementById("btn-review").addEventListener("click", () => navigate(`#/review/${encodeURIComponent(attempt.id)}`));
  document.getElementById("btn-again").addEventListener("click", () => practiseAgain(attempt));
}

async function practiseAgain(attempt) {
  if (attempt.quizType === "practice" && attempt.chapterIds.length === 1) {
    const ch = chapterIndex[attempt.chapterIds[0]];
    if (ch) return startChapterQuiz(ch, attempt.total);
  }
  if (attempt.quizType === "mock") return startMock();
  if (attempt.quizType === "weak") return startWeakPractice(attempt.chapterIds);
  return startQuick10(attempt.subject !== "Mixed" ? attempt.subject : null);
}

/* =================================== REVIEW ==================================== */

async function renderReview(attemptId) {
  const attempt = await storage.getAttempt(attemptId);
  if (!attempt) {
    appEl.innerHTML = emptyState("🔍", "Result not found", "This test result may have been removed.");
    return;
  }
  // Generated questions live only inside the attempt that created them,
  // so the attempt's own copies take priority over the static bank.
  const questionMap = new Map(DATA.questions.map((q) => [q.id, q]));
  for (const q of quizEngine.questionsOf(attempt)) questionMap.set(q.id, q);

  const rows = attempt.answers
    .map((ans, i) => {
      const question = questionMap.get(ans.questionId);
      if (!question) {
        return `<div class="review-q"><div class="qnum">Q${i + 1}</div><div class="qtext">This question is no longer available.</div></div>`;
      }
      const yourText = ans.selectedAnswer === null || ans.selectedAnswer === undefined ? "Not answered" : `${letterFor(ans.selectedAnswer)}. ${question.options[ans.selectedAnswer]}`;
      return `
      <div class="review-q">
        <div class="qnum">Q${i + 1} · ${escapeHtml(question.chapter)}</div>
        <div class="qtext">${escapeHtml(question.question)}</div>
        <div class="review-line your ${ans.correct ? "right" : "wrong"}"><span class="lbl">Your answer:</span> ${escapeHtml(yourText)} ${ans.correct ? "✓" : "✕"}</div>
        ${!ans.correct ? `<div class="review-line correct"><span class="lbl">Correct:</span> ${letterFor(question.answer)}. ${escapeHtml(question.options[question.answer])} ✓</div>` : ""}
        <div class="review-why"><strong>Why:</strong> ${escapeHtml(question.explanation)}</div>
      </div>`;
    })
    .join("");

  appEl.innerHTML = `
    <div class="screen">
      <div class="topbar" style="padding:0 0 4px;">
        <a class="back-btn" href="#/result/${encodeURIComponent(attempt.id)}" aria-label="Back to result">←</a>
        <h1 style="font-size:1.1rem;">Review Answers</h1>
      </div>
      <div style="margin-top:14px;">${rows}</div>
      <a class="btn-primary" style="display:block;margin-top:6px;" href="#/home">Back Home</a>
    </div>`;
}

/* ==================================== TESTS ===================================== */

async function renderTests() {
  const attempts = await storage.getAttempts();
  const completed = attempts.filter((a) => a.completedAt);

  if (!completed.length) {
    appEl.innerHTML = `
      <div class="screen">
        <div class="greeting" style="font-size:1.3rem;">Past Tests</div>
        ${emptyStateInline("📝", "No tests yet", "Finish a quiz or mock test to see your results here.")}
      </div>`;
    return;
  }

  let lastGroup = null;
  let html = "";
  for (const a of completed) {
    const group = formatDateGroup(a.completedAt);
    if (group !== lastGroup) {
      html += `<div class="date-group-label">${group}</div>`;
      lastGroup = group;
    }
    html += `
      <a class="test-item" href="#/result/${encodeURIComponent(a.id)}">
        <div class="info">
          <div class="title">${escapeHtml(a.title)}${a.subject && a.subject !== "Mixed" ? "" : ""}</div>
          <div class="meta">${escapeHtml(a.subject)} · ${a.score}/${a.total}</div>
        </div>
        <div class="score">${a.percentage}%</div>
      </a>`;
  }

  appEl.innerHTML = `
    <div class="screen">
      <div class="greeting" style="font-size:1.3rem;">Past Tests</div>
      <div style="margin-top:8px;">${html}</div>
    </div>`;
}

/* =================================== PROGRESS ==================================== */

async function renderProgress() {
  const attempts = await storage.getAttempts();
  const overall = progressEngine.computeOverall(attempts);
  const streak = progressEngine.computeStreak(attempts);
  const subjectAcc = progressEngine.computeSubjectAccuracy(attempts);
  const weakAreas = progressEngine.computeWeakAreas(attempts, DATA.config.weakThreshold);
  const { strongest, weakest } = progressEngine.strongestAndWeakestSubjects(subjectAcc);

  const subjectRows = DATA.subjects
    .map((s) => {
      const acc = subjectAcc[s.name];
      const pct = acc ? acc.accuracy : 0;
      const variant = !acc ? "" : pct < DATA.config.weakThreshold ? "weak" : pct >= DATA.config.strongThreshold ? "strong" : "";
      return `
      <div class="subject-bar-row">
        <span class="lbl">${escapeHtml(s.name)}</span>
        ${barHtml(pct, variant)}
        <span class="pct">${acc ? pct + "%" : "–"}</span>
      </div>`;
    })
    .join("");

  const weakRows = weakAreas.length
    ? weakAreas
        .slice(0, 6)
        .map(
          (c) => `
      <div class="weak-row">
        <span class="icon">⚠️</span>
        <div class="info"><div class="name">${escapeHtml(c.chapter)}</div><div class="meta" style="font-size:0.75rem;color:var(--muted);">${escapeHtml(c.subject)}</div></div>
        <span class="pct">${c.accuracy}%</span>
      </div>`
        )
        .join("")
    : `<div class="empty-note">No weak areas yet — keep practising to see insights here.</div>`;

  appEl.innerHTML = `
    <div class="screen">
      <div class="greeting" style="font-size:1.3rem;">Progress</div>

      <div class="headline-cards" style="margin-top:14px;">
        <div class="headline-card"><div class="lbl">Accuracy</div><div class="val">${overall.accuracy}%</div></div>
        <div class="headline-card"><div class="lbl">Tests done</div><div class="val">${overall.testsCompleted}</div></div>
        <div class="headline-card"><div class="lbl">Streak</div><div class="val">🔥 ${streak}d</div></div>
      </div>

      ${
        strongest || weakest
          ? `<div class="card" style="margin-top:14px;">
              ${strongest ? `<p style="margin-bottom:6px;font-size:0.9rem;">💪 Strongest: <strong>${escapeHtml(strongest.subject)}</strong> (${strongest.accuracy}%)</p>` : ""}
              ${weakest ? `<p style="font-size:0.9rem;">🎯 Needs attention: <strong>${escapeHtml(weakest.subject)}</strong> (${weakest.accuracy}%)</p>` : ""}
            </div>`
          : ""
      }

      <div class="section-title">Subject-wise Accuracy</div>
      <div class="card">${subjectRows}</div>

      <div class="section-title">Needs Practice</div>
      ${weakRows}
      ${weakAreas.length ? `<button class="btn-primary" id="btn-weak-practice" style="margin-top:6px;">Practise Weak Areas</button>` : ""}
    </div>`;

  if (weakAreas.length) {
    document.getElementById("btn-weak-practice").addEventListener("click", () => startWeakPractice(weakAreas.map((c) => c.chapterId)));
  }
}

/* ===================================== MORE ====================================== */

async function renderMore() {
  appEl.innerHTML = `
    <div class="screen">
      <div class="greeting" style="font-size:1.3rem;">More</div>
      <div class="section-title">Your Data</div>

      <button class="settings-item" id="btn-export" style="width:100%;text-align:left;">
        <span class="emoji">⬇️</span>
        <div class="info"><div class="title">Export Data</div><div class="desc">Download a backup of all progress as a JSON file</div></div>
      </button>

      <label class="settings-item" style="cursor:pointer;">
        <span class="emoji">⬆️</span>
        <div class="info"><div class="title">Import Data</div><div class="desc">Restore progress from a backup file</div></div>
        <input type="file" accept="application/json" id="import-file" class="sr-only" />
      </label>

      <button class="settings-item danger" id="btn-reset" style="width:100%;text-align:left;">
        <span class="emoji">🗑️</span>
        <div class="info"><div class="title">Reset Progress</div><div class="desc">Permanently delete all attempts and progress on this device</div></div>
      </button>

      <div class="section-title">You</div>

      <button class="settings-item" id="btn-name" style="width:100%;text-align:left;">
        <span class="emoji">🙋</span>
        <div class="info"><div class="title">Your Name</div><div class="desc">${studentName ? escapeHtml(studentName) : "Not set — tap to add one"}</div></div>
      </button>

      <div class="section-title">App</div>

      <button class="settings-item" id="btn-update" style="width:100%;text-align:left;">
        <span class="emoji">🔄</span>
        <div class="info"><div class="title">Update App</div><div class="desc">Clear the offline cache and reload the latest version. Your progress is not affected.</div></div>
      </button>

      <div class="section-title">About</div>
      <div class="card" style="font-size:0.85rem;color:var(--ink-soft);line-height:1.6;">
        Class 7 Practice v3.0<br />
        All your data stays on this device — nothing is sent anywhere.<br />
        Use <strong>Export Data</strong> regularly to keep a backup, especially before clearing browser data.
      </div>
    </div>`;

  document.getElementById("btn-export").addEventListener("click", exportDataFlow);
  document.getElementById("btn-reset").addEventListener("click", resetDataFlow);
  document.getElementById("btn-update").addEventListener("click", updateAppFlow);
  document.getElementById("btn-name").addEventListener("click", changeNameFlow);
  document.getElementById("import-file").addEventListener("change", importDataFlow);
}

/**
 * Force a clean reinstall of the cached app files.
 *
 * This only touches the offline cache - attempts and settings live in
 * IndexedDB and are left completely alone, which is why it needs no scary
 * confirmation. It is the fix for a device stuck on a half-updated set of
 * files after a deploy.
 */
/**
 * Ask for a name, using the styled dialog when it is available.
 *
 * promptDialog() is the newest thing js/ui.js exports, so it is fetched with a
 * dynamic import rather than named in this file's static import list. That
 * distinction matters: a static import of a name the module does not provide
 * is a LINK error, which kills the whole of app.js before a line of it runs -
 * a device holding an older cached ui.js would get nothing but the loading
 * placeholder. Done this way, a stale ui.js costs you the pretty dialog and
 * nothing else.
 */
async function askForName(current) {
  try {
    const ui = await import("./ui.js");
    if (typeof ui.promptDialog === "function") {
      return ui.promptDialog({
        title: "Your name",
        message: "This is only used to greet you on the home screen.",
        value: current,
        placeholder: "e.g. Aarav",
        maxLength: MAX_NAME_LENGTH,
      });
    }
  } catch (err) {
    console.warn("Falling back to a plain prompt for the name:", err);
  }
  const typed = window.prompt("Your name", current || "");
  return typed === null ? null : typed.trim() || null;
}

async function changeNameFlow() {
  const name = await askForName(studentName);
  if (name === null) return; // cancelled - leave the current name alone
  await setStudentName(name);
  showToast("Name updated");
  // Only repaint if we are still on More. Awaiting the write above gives the
  // student time to navigate, and re-rendering then would paint the More
  // screen over whatever they actually opened.
  if (currentRoute().name === "more") renderMore();
}

async function updateAppFlow() {
  showToast("Updating…");
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* If any of it fails, the reload below still gets us a fresh start. */
  }
  // Reload past the HTTP cache too, so nothing stale survives.
  location.reload(true);
}

async function exportDataFlow() {
  try {
    const data = await storage.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `class7-practice-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.");
  } catch (err) {
    console.error(err);
    showToast("Couldn't export data. Please try again.");
  }
}

async function importDataFlow(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (err) {
    return showToast("That file couldn't be read. Please choose a valid backup JSON file.");
  }

  const ok = await confirmDialog({
    title: "Import backup?",
    message: "This will replace all progress currently stored on this device with the data in this backup file. This can't be undone.",
    okLabel: "Import",
    okVariant: "ok",
  });
  if (!ok) return;

  try {
    await storage.importData(parsed);
    showToast("Data imported successfully.");
    navigate("#/home");
  } catch (err) {
    showToast(err.message || "Couldn't import this backup file.");
  }
}

async function resetDataFlow() {
  const ok = await confirmDialog({
    title: "Reset all progress?",
    message: "This permanently deletes every test result and progress record on this device. This can't be undone. Consider exporting a backup first.",
    okLabel: "Delete Everything",
  });
  if (!ok) return;
  await storage.resetAllData();
  showToast("All progress has been reset.");
  navigate("#/home");
}

/* =================================== SHARED EMPTY STATES ============================= */

function emptyState(emoji, title, desc) {
  return `<div class="screen">${emptyStateInline(emoji, title, desc)}</div>`;
}
function emptyStateInline(emoji, title, desc) {
  return `<div class="empty-state"><div class="emoji">${emoji}</div><div class="title">${escapeHtml(title)}</div><div class="desc">${escapeHtml(desc)}</div></div>`;
}

/* ===================================== INIT ======================================== */

async function init() {
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    appEl.innerHTML = `
      <div class="screen">
        <div class="empty-state">
          <div class="emoji">⚠️</div>
          <div class="title">Couldn't load app data</div>
          <div class="desc">Make sure this app is running from a local server or GitHub Pages (opening index.html directly from disk can block data loading in some browsers). See the README for how to run it locally.</div>
        </div>
      </div>`;
    window.__APP_READY = true; // a real message is on screen; no watchdog needed
    return;
  }

  await loadStudent();

  if (!location.hash) location.hash = onboarded ? "#/home" : "#/welcome";
  window.addEventListener("hashchange", renderRoute);
  await renderRoute();

  // Tell the boot watchdog in index.html that we got here.
  window.__APP_READY = true;

  registerServiceWorker();
}

/** Local dev servers, where caching an old copy of the app only gets in the way. */
function isLocalhost() {
  return ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
}

/**
 * Register the offline worker - but never on localhost.
 *
 * The app is plain ES modules, so while you are editing them a service worker
 * is actively unhelpful: it serves the copy it saved earlier, and a browser
 * left holding a stale module gives you a blank "Loading..." screen rather
 * than your latest edit. Offline support matters on the deployed site, not on
 * a dev server, so it is simply switched off here. Any worker registered by an
 * earlier version is torn down too, so a machine that already has one recovers
 * by itself on the next load.
 *
 * To exercise offline behaviour locally, run the app from your machine's LAN
 * IP instead of localhost - that path still registers normally.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (isLocalhost()) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then((cleared) => {
        if (cleared.length) console.info("[dev] Removed the offline worker on localhost so edits show up immediately.");
      })
      .catch(() => {});
    return;
  }

  // updateViaCache:"none" stops the browser serving service-worker.js itself
  // out of its HTTP cache, and the explicit update() asks for a fresh copy on
  // every load. Together they mean a published fix reaches the device on the
  // next visit rather than whenever the browser feels like revalidating.
  navigator.serviceWorker
    .register("service-worker.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {
      /* offline support is a bonus, not a hard requirement */
    });
}

// Anything that goes wrong from here on must end up on screen rather than
// leaving the student staring at the loading placeholder.
init().catch((err) => {
  console.error(err);
  renderCrashState(err);
  window.__APP_READY = true;
});
