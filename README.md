# Class 7 Practice

A mobile-first, offline-capable practice app for Grade 7 CBSE - Maths, Science, SST,
English, Hindi, German and ICT. Vanilla HTML/CSS/JS, no build step, no backend, no
login. All progress is stored locally in the browser (IndexedDB).

---

## 1. Running it locally

Browsers block `fetch()` of local JSON files when you open `index.html` straight
from disk (`file://...`), so run a tiny local server instead - no installation
beyond Python (already on most machines) is needed:

```bash
cd class7-practice
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser (or your phone, if it's on
the same Wi-Fi - use your computer's local IP instead of `localhost`).

Alternatives if you don't have Python: `npx serve` (needs Node.js), or the
"Live Server" extension in VS Code.

> Opening `index.html` directly by double-clicking it will show a "Couldn't
> load app data" message in most browsers - this is expected and is explained
> on-screen. Always use a local server for local testing. **GitHub Pages
> always works correctly** because it serves files over `https://`.

---

## 2. Project structure

```
class7-practice/
├── index.html            # App shell + bottom navigation
├── manifest.json         # PWA metadata (installable on phone)
├── service-worker.js     # Offline caching
├── css/
│   └── style.css         # Entire design system
├── js/
│   ├── app.js             # Routing + all screen rendering ("glue")
│   ├── storage.js         # IndexedDB abstraction (the only file that touches IndexedDB)
│   ├── quiz.js             # Quiz engine: building quizzes, shuffling, scoring
│   ├── progress.js        # Turns stored attempts into accuracy/streak/weak-area stats
│   └── ui.js               # Small render helpers (progress rings, toasts, dialogs)
├── data/
│   ├── subjects.json       # The 7 subjects (id, name, icon, color)
│   ├── syllabus.json       # Chapter list per subject - edit this to add/remove chapters
│   ├── questions.json      # The question bank - edit this to add questions
│   └── config.json         # Tunable thresholds & mock-test question counts
├── icons/                  # PWA icons
└── README.md
```

---

## 3. How storage works

Everything is stored in **IndexedDB** (not `localStorage`, per the brief) inside
`js/storage.js`, which is the *only* file that talks to IndexedDB directly.
Three object stores:

- **`attempts`** - one record per completed quiz (score, answers, timestamps).
  This is the single source of truth; nothing else duplicates this data.
- **`activeQuiz`** - the one in-progress quiz, if any. Every time your son
  answers a question, the answer is saved immediately, so closing the browser
  mid-quiz never loses progress. Resuming shows the *exact* question order and
  position he left off at (the quiz is never re-shuffled on resume).
- **`settings`** - small key/value flags (currently just a progress cache).

Progress statistics (accuracy, streaks, weak chapters) are **derived on the fly**
from `attempts` by `js/progress.js` rather than stored separately, so there's
never a risk of the two going out of sync.

---

## 4. How progress tracking works

`progress.js` exposes pure functions that take the full list of attempts and compute:

- **Overall accuracy** - correct ÷ total across every completed test.
- **Subject-wise accuracy** - grouped by subject name.
- **Chapter-wise accuracy** - grouped by `chapterId`, also tracking "last practised" date.
- **Weak areas** - chapters below `weakThreshold` (default 60%, in `data/config.json`),
  requiring at least 3 attempted questions so one unlucky guess doesn't
  mislabel a chapter.
- **Streak** - consecutive days (including today) with at least one completed test.

Change `weakThreshold` / `strongThreshold` in `data/config.json` any time -
no code changes needed.

---

## 5. How to add questions / chapters

You should only ever need to touch files in `data/`:

**To add a question**, add an object to `data/questions.json`:

```json
{
  "id": "maths-ch4-q006",
  "subject": "Maths",
  "chapterId": "maths-ch4",
  "chapter": "Operation With Integers",
  "type": "mcq",
  "difficulty": "easy",
  "question": "What is (-5) + 9?",
  "options": ["-14", "-4", "4", "14"],
  "answer": 2,
  "explanation": "9 - 5 = 4. The positive number has the larger absolute value, so the result is positive.",
  "tags": ["integers", "addition"]
}
```

- `chapterId` **must** match an `id` in `data/syllabus.json` for that subject.
- `answer` is the zero-based index into `options` (so `2` = the 3rd option).
- Only `"type": "mcq"` is implemented today. The engine (`quiz.js`) is written
  generically so true/false, fill-in-the-blank, numerical, matching, etc. can
  be added later by teaching `gradeAnswer()` in `quiz.js` how to grade each
  new type - no other file needs to change.

**To add or rename a chapter**, edit `data/syllabus.json`. Any chapter with
zero matching questions in `questions.json` automatically shows "Content
coming soon" in the app instead of breaking or being hidden - you never need
to touch UI code.

**To add a subject**, add an entry to `data/subjects.json` and a matching key
in `data/syllabus.json`.

---

## 6. What's in the initial question bank (and what isn't)

This prototype ships with **138 original practice questions** across 34 of the
44 configured chapters. These are original questions written for practice -
**not** taken from any textbook.

Ten chapters are intentionally left as **"Content coming soon"** with zero
questions, because they reference specific textbook stories/units whose exact
content I could not verify against your son's actual books, and the brief was
explicit about not fabricating textbook-specific content:

- SST: Map Work
- English: *Animals, Birds and Dr Dolittle*, *A Funny Man* (poem), *Say The
  Right Thing*, *My Brother's Great Invention*
- Hindi: *माँ, कह एक कहानी*, *तीन बुद्धिमान*, *फूल और काँटा*, *पानी रे पानी*,
  *नहीं होना बीमार*

All other chapters (Maths, Science, general SST civics/history/geography,
English & Hindi grammar/writing, German vocabulary, ICT) have general
practice questions. When you share the actual textbooks/PDFs for the chapters
above, I can generate properly grounded questions for them and drop them
straight into `questions.json` - no other changes needed.

---

## 7. Deploying to GitHub Pages

1. Create a new **public** GitHub repository, e.g. `class7-practice`.
2. From inside the `class7-practice` folder:
   ```bash
   git init
   git add .
   git commit -m "Initial version of Class 7 Practice app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/class7-practice.git
   git push -u origin main
   ```
3. On GitHub: go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
5. After a minute, your app will be live at:
   `https://<your-username>.github.io/class7-practice/`

Any time you edit `data/questions.json` or `data/syllabus.json`, just commit
and push - GitHub Pages redeploys automatically within a minute or two.

To install it like an app on your son's phone: open the GitHub Pages link in
Chrome/Safari, then use "Add to Home Screen" (this works because of
`manifest.json` + `service-worker.js`).

---

## 8. Backup & restore

Since there's no server/database, **all progress lives only in the browser
that was used**. Use **More → Export Data** regularly (especially before
clearing browser data, switching browsers, or moving to a new device) to
download a JSON backup. **More → Import Data** restores it - after a
confirmation prompt, since it overwrites what's currently stored.

---

## 9. What was tested

- All `data/*.json` files validated as syntactically correct JSON.
- All `js/*.js` modules pass `node --check` (syntax validation).
- The quiz engine and progress engine were run against the real 138-question
  bank in Node.js: chapter quizzes build to the correct size, scoring works,
  the Mid-Term Mock respects the configured per-subject question counts, an
  empty question pool returns a 0-question quiz instead of crashing, and
  weak-area/accuracy/streak calculations were verified against known inputs.
- Full click-through testing (tapping through screens in an actual browser)
  should be done by you once deployed or run locally - this environment
  couldn't launch a live browser to click through, though the underlying data
  flow and logic have been verified directly.

If anything looks or behaves unexpectedly once you try it, tell me what you
see and I'll fix it.
