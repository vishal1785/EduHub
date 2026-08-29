# Learn Splash

A mobile-first, offline-capable practice app for Grade 7 CBSE - Maths, Science, SST,
English, Hindi, German and ICT. Vanilla HTML/CSS/JS, no build step, no backend, no
login. All progress is stored locally in the browser (IndexedDB).

### Books this is built against

The syllabus configuration in `data/syllabus.json` follows the mid-term
syllabus for these prescribed Grade 7 (2026-27) books:

| Subject | Book | Publisher |
| --- | --- | --- |
| English | Poorvi | NCERT |
| English (grammar) | Burlington Everyday Grammar 7 | Burlington |
| SST | Exploring Society: India and Beyond, Parts 1 & 2 | NCERT |
| Maths | Ganita Prakash, Parts I & II | NCERT |
| Maths (reference) | R.D. Sharma Mathematics 7 | R.D. Sharma |
| Science | Curiosity | NCERT |
| Science (reference) | Lakhmir Singh's Science 7 | S. Chand |
| Hindi | Malhar | NCERT |
| Hindi | Saptarshi | Saraswati |
| ICT | Terabytes | Cambridge |
| German | Hallo Deutsch 2 / Hallo Deutsch plus Neu A2 | Goyal |
| Skills | Kaushal Bodh | NCERT |

Questions are written to the **topics** of these chapters. Apart from the nine
chapters in section 6c, they are original practice questions - they are not
copied from, and do not reproduce the exercises of, any of these books.

---

## 1. Running it locally

Browsers block `fetch()` of local JSON files when you open `index.html` straight
from disk (`file://...`), so run a tiny local server instead - no installation
beyond Python (already on most machines) is needed:

```bash
cd learn-splash
python serve.py
```

Then open **http://localhost:8000**. `serve.py` also prints your machine's LAN
address, which is how to open the app on a phone on the same Wi-Fi.

> **Use `serve.py`, not `python -m http.server`.** `http.server` sends a
> `Last-Modified` header but no `Cache-Control`, so the browser applies
> "heuristic freshness" and reuses files without asking whether they changed.
> On an app of plain ES modules that bites hard: you edit `css/style.css`,
> reload, and get the stylesheet from ten minutes ago rendering your new
> markup unstyled - or a mix of old and new modules, where one missing export
> stops the whole app loading. `serve.py` sends `Cache-Control: no-store`, so
> what you see is always what is on disk.

Alternatives if you don't have Python: `npx serve` (needs Node.js), or the
"Live Server" extension in VS Code.

> **The offline service worker is deliberately switched off on localhost.**
> While you are editing plain ES modules, a service worker only gets in the
> way: it serves the copy it saved earlier, so you see a stale app - or, if it
> hands back a module that no longer matches the others, a blank "Loading…"
> screen instead of your edit. Any worker left over from an earlier version is
> torn down automatically on the next localhost load. To exercise offline
> behaviour locally, serve the app from your machine's LAN IP rather than
> `localhost`; that path registers normally, as does GitHub Pages.

> Opening `index.html` directly by double-clicking it will show a "Couldn't
> load app data" message in most browsers - this is expected and is explained
> on-screen. Always use a local server for local testing. **GitHub Pages
> always works correctly** because it serves files over `https://`.

---

## 2. Project structure

```
learn-splash/
├── index.html            # App shell + bottom navigation
├── serve.py              # Local dev server with caching disabled
├── manifest.json         # PWA metadata (installable on phone)
├── service-worker.js     # Offline caching
├── css/
│   └── style.css         # Entire design system
├── js/
│   ├── app.js             # Routing + all screen rendering ("glue")
│   ├── storage.js         # IndexedDB abstraction (the only file that touches IndexedDB)
│   ├── quiz.js             # Quiz engine: building quizzes, shuffling, scoring
│   ├── generators.js      # Dynamic question generators for computable chapters
│   ├── progress.js        # Turns stored attempts into accuracy/streak/weak-area stats
│   └── ui.js               # Small render helpers (progress rings, toasts, dialogs)
├── data/
│   ├── subjects.json       # The 7 subjects (id, name, icon, color)
│   ├── syllabus.json       # Chapter list per subject - edit this to add/remove chapters
│   ├── questions.json      # The question bank - edit this to add questions
│   └── config.json         # Tunable thresholds & mock-test question counts
├── vercel.json           # Static hosting + cache headers for Vercel
├── icons/
│   ├── icon.svg            # Source of truth for the app icon
│   ├── icon-192.png        # Rasterised from icon.svg - do not edit directly
│   └── icon-512.png
├── tests/
│   ├── run.py              # Runs every suite in headless Chrome - `python tests/run.py`
│   ├── verify.html         # Unit suite: bank, generators, quiz engine
│   ├── storage.html        # IndexedDB: attempt history, resumable quizzes
│   └── smoke.html          # Drives the real app in a browser
└── README.md
```

---

## 3. How storage works

Everything is stored in **IndexedDB** (not `localStorage`, per the brief) inside
`js/storage.js`, which is the *only* file that talks to IndexedDB directly.
Three object stores:

- **`attempts`** - one record per completed quiz (score, answers, timestamps).
  This is the single source of truth; nothing else duplicates this data.
- **`activeQuiz`** - **one in-progress quiz per quiz type** (chapter practice,
  Quick 10, Mid-Term Mock, Needs Practice), each under the key
  `active:<type>`. Every time your son answers a question, the answer is saved
  immediately, so closing the browser mid-quiz never loses progress. Resuming
  shows the *exact* question order and position he left off at (the quiz is
  never re-shuffled on resume).

  Keeping a slot per type is what stops a half-finished 47-question Mid-Term
  Mock being wiped out by a stray tap on Quick 10. Home lists every quiz that
  is still in progress under "Continue Learning", and the Mid-Term Mock button
  changes to "Resume Mock" while one is unfinished. Starting a *second* quiz of
  the same type asks first, and dismissing that dialog resumes rather than
  discarding.

  Each record wraps the quiz as `{ id, quizType, savedAt, quiz }`. That
  matters: an earlier version stored the quiz directly, so the store's key
  (`"current"`) overwrote the quiz's own id - and since the finished quiz is
  saved to `attempts` under that id, **every completed test overwrote the
  previous one and the whole history held exactly one record**. `tests/storage.html`
  now fails if that regresses.
- **`settings`** - small key/value flags: the student's name (`studentName`),
  whether the welcome screen has been dealt with (`onboarded`), and a progress
  cache.

  On first run the app opens on a **welcome screen** asking for the student's
  name, which is then used to greet them on Home ("Hi, Aarav! 👋"). Skipping is
  allowed - the name is a nicety, not a login - and skipping still marks
  onboarding done so the screen is not shown again. The name can be changed
  any time from **More → Your Name**. Note that **Reset Progress deletes
  attempts, not the name**: resetting progress is not the same as forgetting
  who is using the app.

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
neither questions in `questions.json` nor a generator in `js/generators.js`
automatically shows "Content coming soon" in the app instead of breaking or
being hidden - you never need to touch UI code.

**To make a chapter generate questions dynamically**, give it a `generators`
field naming one or more of the families built into `js/generators.js`:

```json
{ "id": "maths-ch6", "number": 6, "name": "Working With Fractions",
  "description": "Operations on fractions.",
  "generators": ["fractions"] }
```

Available families: `hcf-lcm-factors`, `integer-operations`,
`arithmetic-expressions`, `fractions`, `decimals`, `lines-and-angles`,
`excel-formulas`. A chapter may list several, and the same family may be used
by more than one chapter. Remove the field and the chapter falls back to the
static bank.

> **Adding, removing, renaming or renumbering a chapter never requires a code
> change.** Chapter ids, names and subjects are read from `data/syllabus.json`
> at runtime - nothing in `js/` holds a list of chapters. If you mistype a
> family name the app logs a clear warning in the browser console and
> `tests/verify.html` fails, rather than the chapter silently going quiet.

> Note: for a chapter that generates, adding entries to `questions.json` has no
> visible effect - the generated output is used instead. Their handful of static
> entries are kept only as a fallback if generation ever fails.

**To add a subject**, add an entry to `data/subjects.json` and a matching key
in `data/syllabus.json`.

---

## 6. Where questions come from

There are two sources, chosen per chapter.

### 6a. Generated questions (fresh every time)

Seven chapters produce **brand-new randomised questions on every quiz**, rather
than replaying a fixed list. These are the chapters where the correct answer can
be *computed*, so it can be guaranteed correct without a textbook:

| Chapter | Family (in `syllabus.json`) | What is generated |
| --- | --- | --- |
| Maths 3 - Finding Common Grounds | `hcf-lcm-factors` | HCF, LCM, factors, factor counts |
| Maths 4 - Operation With Integers | `integer-operations` | +, -, x, / with negatives, number line |
| Maths 5 - Arithmetic Expression | `arithmetic-expressions` | BODMAS, brackets, multi-step expressions |
| Maths 6 - Working With Fractions | `fractions` | +, -, x, /, comparing, fraction of a quantity |
| Maths 7 - A Peak Beyond The Point | `decimals` | decimal arithmetic, place value, comparing |
| Maths 10 - Parallel and Intersecting Lines | `lines-and-angles` | complements, linear pairs, transversal angles |
| ICT 2 - Calculations in Excel 2016 | `excel-formulas` | SUM / AVERAGE / MAX / MIN / COUNT, cell references |

Which chapters appear in this table is decided entirely by
`data/syllabus.json`, not by any list inside `js/`.

This is what fixed the "same four questions every time" problem: forty rebuilds
of a single chapter produce **300-400 distinct questions**, and two quizzes taken
back to back typically share none at all.

All arithmetic in `generators.js` is done on **integers** - decimals are carried
as scaled integers and only turned into text at the last moment - so
floating-point error can never make a generated answer wrong.

Every other subject stays on the hand-written bank on purpose. A generator can
compute `17 x 4`, but it cannot invent a verifiable fact about a Hindi poem, so
inventing one would be worse than having no question at all.

### 6b. The hand-written bank

`data/questions.json` holds **551 questions**. 522 of them back the 35 chapters
that have no generator; the remaining 29 sit in generated chapters as a fallback
that is only used if generation ever fails. Every bank-backed chapter has at
least 12 questions, so a 10-question quiz is never simply the whole bank in a
different order.

These are original questions written for practice - **not** copied from any
textbook.

### 6c. The two chapters that are still empty

Seven of the original nine gaps were filled once the ONE-MENTOR Class 7
question banks for English, Hindi and Maths became available: they gave enough
of each chapter's actual content — characters, plot, poet, key terms — to write
grounded questions. Those questions are original MCQs derived from that
content, not copies of the banks' own (short-answer) questions.

Two English chapters remain **"Content coming soon"**, because the question
bank hedges on them ("the family pets (dog/cat)", "burnt dish or inappropriate
item", "laboratory or workshop"), which shows its author did not have the text
either. Inventing chapter-specific "facts" for them would
produce questions that look right and teach the wrong thing:

- English: *Say The Right Thing*, *My Brother's Great Invention*

SST **Map Work** was previously on this list and has now been filled in: it is a
*skill* chapter (scale, direction, symbols, latitude and longitude, contours,
map types) rather than a set text, so it needs no textbook to write accurately.

Share the actual textbook pages or PDFs for the nine remaining chapters and they
can be filled in accurately and dropped straight into `questions.json` - no other
change needed.

---

## 7. Deploying

### Vercel (primary)

The repo is a plain static site with no build step, so Vercel serves it as-is.
`vercel.json` sets the cache headers that matter: `js/`, `css/`, `data/`,
`index.html`, `manifest.json` and `service-worker.js` are all sent with
`max-age=0, must-revalidate`.

That is deliberate rather than fussy. The app is plain ES modules, so if a
browser is allowed to reuse an old `js/ui.js` next to a new `js/app.js` the
module graph fails to link and the app does not start at all. Revalidating
means the browser always gets one consistent set; the service worker still
provides offline support from its own atomic snapshot.

Pushing to the connected branch deploys automatically.

**To rename the Vercel project** (the app is now Learn Splash, so the old
`eduhub` deployment name no longer fits):

1. Vercel dashboard → the project → **Settings → General**.
2. Change **Project Name** to `learn-splash` and save.
3. The production URL becomes `https://learn-splash.vercel.app`. Vercel keeps
   serving the previous domain for a short while, but update any bookmark or
   home-screen shortcut, since a renamed project's old URL is eventually
   released and could be claimed by someone else.
4. If the phone already has the app installed, remove the shortcut and re-add
   it from the new URL - an installed PWA is tied to the origin it came from,
   so it will not follow the rename.

### GitHub Pages (alternative)

1. Create a new **public** GitHub repository, e.g. `learn-splash`.
2. From inside the `class7-practice` folder:
   ```bash
   git init
   git add .
   git commit -m "Initial version of Learn Splash"
   git branch -M main
   git remote add origin https://github.com/<your-username>/learn-splash.git
   git push -u origin main
   ```
3. On GitHub: go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
5. After a minute, your app will be live at:
   `https://<your-username>.github.io/learn-splash/`

Any time you edit `data/questions.json` or `data/syllabus.json`, just commit
and push - GitHub Pages redeploys automatically within a minute or two.

To install it like an app on your son's phone: open the GitHub Pages link in
Chrome/Safari, then use "Add to Home Screen" (this works because of
`manifest.json` + `service-worker.js`).

### Updating a device that is already installed

`service-worker.js` caches the app so it works offline. **Bump `CACHE_NAME`
whenever any cached file changes** - that is what tells installed devices to
fetch the new set.

The cache is only ever written as a whole, by `cache.addAll()` during install,
and never per request. That matters more than it sounds: the app is plain ES
modules with no build step, so `js/app.js` and `js/storage.js` must always be
served as one matching set. An earlier version refreshed each file
individually in the background, and those refreshes race - a device could end
up holding a **new `app.js` next to an old `storage.js`**, which broke the app
with `storage.getActiveQuizzes is not a function`. Writing the cache
atomically makes that impossible: whatever is cached is always one consistent
snapshot.

If a device ever does get stuck on a stale version, **More → Update App**
clears the offline cache, drops the service worker and reloads. It does not
touch saved progress, which lives in IndexedDB.

**The boot watchdog.** There is one failure that More → Update App cannot help
with: if a stale cached module is missing an export that `js/app.js` imports,
the module graph fails to *link*, so none of the app's JavaScript runs at all -
no error screen, no working navigation, just "Loading your practice app…"
for ever. `index.html` therefore carries a small inline classic script (no
imports, so it always runs) that waits 8 seconds for `window.__APP_READY` and,
if it never arrives, replaces the placeholder with a **Clear cache & reload**
button. `tests/run.py`'s pre-flight fails if that watchdog is removed.

---

## 8. The app icon

`icons/icon.svg` is the source of truth: a droplet for the *splash*, an open
book cut into it for the *learn*, and the app's own palette - deep forest-teal
ground, paper-cream mark, coral accent - so the icon and the UI read as one
thing. Everything sits inside the central 80% of the canvas so it survives
being cropped to a circle or squircle as a maskable icon.

`icon-192.png` and `icon-512.png` are rasterised from it. **Edit the SVG and
re-render; never edit the PNGs directly.** To re-render, open the SVG in a
browser and export at 192 and 512, or use any SVG-to-PNG tool.

## 9. Backup & restore

Since there's no server/database, **all progress lives only in the browser
that was used**. Use **More → Export Data** regularly (especially before
clearing browser data, switching browsers, or moving to a new device) to
download a JSON backup. **More → Import Data** restores it - after a
confirmation prompt, since it overwrites what's currently stored.

---

## 10. Tests

There is no build step and no Node runtime in this project, so the tests run
**in a real browser against the real ES modules** - the same code path the app
itself uses. One command runs everything:

```bash
python tests/run.py
```

It runs a static pre-flight, then starts a local server and drives headless
Chrome (or Edge) through three browser suites, printing the results; the exit
code is 0 only if everything passed.

**Pre-flight (no browser needed).** Four static checks, each added after a real
failure. It verifies that the boot watchdog above is still present and wired
up, that every `storage.x()` / `quizEngine.x()` /
`progressEngine.x()` call in `js/` resolves to something that module actually
exports, that every `import { … } from "./x.js"` names a real export - both of
which catch an "is not a function" crash in the source rather than in the
browser - and that `service-worker.js` precaches every app file, since a module
missing from that list is what let two versions drift apart in the first place.
(`storage.html` and `smoke.html` need the runner's server, which holds each
page's load event open until it reports back - without that, headless Chrome
dumps the DOM while the app is still waiting on IndexedDB.)

**`tests/verify.html` - 134 checks.**

- `data/questions.json` is valid JSON with unique ids, four distinct options
  per question, an in-range answer index, a non-empty explanation, and a
  `chapterId` / `subject` / `chapter` that agree with `data/syllabus.json`.
- The correct answer is evenly spread across positions A-D, so a student
  cannot score by always picking the same letter.
- The generator wiring really is data-driven: the suite invents a chapter that
  exists nowhere in `js/`, gives it a family, and checks that it generates -
  which is the guarantee that you can add a chapter without touching code.
- **Every generated question is independently recomputed.** The suite parses
  the question back out of its own printed text and recalculates the answer
  using exact rational arithmetic, rather than trusting `generators.js`. On the
  last run, **14,000 generated questions were checked this way and 100% were
  correct** - a generator that starts producing wrong answers fails here rather
  than in front of a student.
- Freshness: back-to-back quizzes on a generated chapter share at most 3 of 10
  questions, and 40 rebuilds yield 300+ distinct questions per chapter.
- Quiz building for all 44 chapters, Quick 10 per subject, the Mid-Term Mock
  (per-subject counts honoured) and weak-area quizzes.
- Scoring at 100% / 0% / 50%, review pairing, resume across a save/load round
  trip, and backwards compatibility with attempts saved before questions were
  embedded.

**`tests/storage.html` - 31 checks.** Exercises `js/storage.js` against real
IndexedDB, and exists mainly to guard two regressions that both shipped once:
that finishing several quizzes leaves several attempts in history (not one), and
that an in-progress Mid-Term Mock survives starting a Quick 10, a chapter
practice and a weak-area quiz - keeping its answers, its id and its exact
question order. Also covers per-type clearing and an export/import round trip.

**`tests/smoke.html` - 59 checks.** Drives the actual app inside an iframe.
Three of those checks read *computed* style rather than text, because a stale
or missing stylesheet renders correct markup with no styling at all - which
looks broken to a human but passes every text-based assertion. It covers
onboarding (a first run is sent to the welcome screen even when the URL asks
for `#/home`, Get Started stays disabled until a name is typed, and Home then
greets by that name), renaming from More, and:
every screen renders, an empty chapter shows "Content coming soon" with no
Practise button, and a full 10-question quiz on a *generated* chapter is played
through to its result and review screens. That last one matters most - a
generated question exists only inside the saved attempt, so if the app ever went
back to looking questions up by id in the static bank, every review entry would
read "no longer available" and this suite would fail.

It also walks through the mock-versus-Quick-10 case in the real UI: answer three
questions of the 47-question mock, leave, start a Quick 10, and check that Home
still offers the mock and that resuming it lands back on question 4.

### Not covered

- Real-device testing on your son's phone, and the PWA install flow. Worth a
  quick manual pass once it is deployed.
- Visual/layout checking. The suites assert that screens render and contain the
  right content, not that they look right.

If anything looks or behaves unexpectedly once you try it, tell me what you
see and I'll fix it.
