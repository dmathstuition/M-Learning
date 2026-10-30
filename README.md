# M Learning App — Learn • Grow • Achieve

A school learning platform for students and teachers: lessons with worked examples, a quiz engine with instant or deferred feedback, score and progress tracking, a teacher dashboard, a question importer (CSV / JSON / pasted text / manual), and a **character system** that puts a student's own imported image behind the whole app.

> **Read this first: what kind of app this is.**
> This version is **local-first**. It runs entirely in the browser, with no server, and stores everything in that browser's IndexedDB on **one device**.
> - Accounts are real (salted PBKDF2-SHA256 password hashes, sessions, role checks), but they exist **only on that device**. Nothing syncs between devices.
> - Role checks stop students from reaching teacher pages and data through the app. They are **not a security boundary**: someone with access to the device's browser developer tools can read or change the stored data, including answer keys. The [backend section](#features-that-need-a-backend) below covers what's needed for real protection.
> - Good fits: one shared classroom computer, a tutor's laptop, a pilot, or a demo. Not a fit: high-stakes exams.

---

## 1. Quick start

You need a modern browser (Chrome, Edge, Firefox, Safari, or Android/iOS browsers). Serve the folder over `http://localhost`. Password hashing uses the Web Crypto API, which only works in a secure context.

```bash
cd M-Learning
```

```bash
python3 -m http.server 8080
```

Then open **http://localhost:8080**. (Any static server works, e.g. `npx serve .`.)

Hosting on the web: upload the folder to any static host (GitHub Pages, Netlify, Vercel). HTTPS works out of the box. Each visitor's data still lives only in their own browser.

### First run
1. The app opens **Set up M Learning** and asks you to create the first **teacher** account. (Only the first teacher can be created this way; later teachers are added by a signed-in teacher under *Students → Add account*.)
2. Students click **Create an account** on the login page, or a teacher adds them.
3. Built-in sample content loads automatically: 12 courses, 24 lessons, 60 questions, 3 published quizzes.

## 2. Project structure

```
index.html              App shell (strict Content-Security-Policy, loads the scripts below)
css/styles.css          Light + dark themes, layout, components, character layer
js/boot-theme.js        Applies saved theme before first paint
js/util.js              Escaping HTML templates, modals, toasts, downloads, safe "lite markup"
js/db.js                IndexedDB wrapper (atomic batch writes) + localStorage prefs with fallback
js/auth.js              Accounts, PBKDF2 hashing, sessions, lockout, teacher checks
js/questions.js         Question model, CSV/JSON/text parsing, validation, duplicates, marking, export
js/seed.js              Sample courses, lessons, Maths/English/Science/Computer question bank, quizzes
js/services.js          Settings, notifications, progress, courses, question bank, quiz engine core
js/character.js         Character import/validation/downscaling, library, background layer
js/quiz-player.js       Quiz player + results page
js/views-auth.js        Login, registration, first-run setup
js/views-student.js     Dashboard, courses, lessons, quizzes, progress, character studio, profile, settings, notifications
js/views-bank.js        Question bank management + import workflow
js/views-teacher.js     Teacher dashboard, course/lesson editor, quiz builder, results & marking, students
templates/              Sample CSV/JSON/TXT templates, sample Maths & English banks, an error-filled test file
tests/e2e.test.js       End-to-end browser test (Playwright)
```

No build step and no runtime dependencies. The only external request is the optional Google Font (Outfit); the app falls back to system fonts offline.

## 3. Features

| Area | What works |
|---|---|
| **Accounts** | Student registration with validation (name, username, email, password + confirm), login/logout, "keep me signed in", 5-attempt lockout, teacher role, change password, teacher-run password reset, delete account |
| **Student dashboard** | Greeting and avatar, Learning/Practicing tabs, class chips, subject tiles with progress, shortcuts to the Character and Question libraries, continue-learning, recent scores, stats (study hours, lessons, quizzes, average), notifications |
| **Subjects** | Mathematics, English, Basic Science (living things, cells, matter, energy, acids & bases, environment), Computer Studies. Each lesson has explanations, worked examples with hidden step-by-step solutions, and topic practice |
| **Course library** | Search (titles, topics, lesson text), filter by subject, class, difficulty |
| **Quiz engine** | MCQ (2–6 options), true/false, short answer, fill-in-the-blank. Question palette, Previous/Next, optional countdown with auto-submit, Restart, Submit (warns about unanswered questions), instant feedback **or** feedback after submission (teacher's choice), explanations, results page with accuracy % |
| **Score tracking** | Quiz name, date, total, correct, incorrect, awaiting marking, score, %, time taken and time limit |
| **Progress** | Lessons completed, quizzes attempted, average, per-subject bars, score-trend chart, recent activity, full history |
| **Characters** | Import PNG/JPG/JPEG/WebP, preview, Apply / Save / Cancel, library with thumbnails, rename, delete (with confirmation), active badge, Change Character, Remove Character (keeps the library), opacity / brightness / overlay / size / position controls, reset to default; persists across refreshes and pages; survives theme changes |
| **Themes** | Light and dark (navy/purple/blue), saved per user |
| **Teacher** | Dashboard (marking queue, latest results, students who need help), course and lesson CRUD with live preview and reordering, question bank (search, filters, edit, delete, export CSV/JSON), import, quiz builder (pick from bank, per-question marks, timer, feedback mode, shuffle, assign to all/class/students, due date, preview with hidden answer key, draft/publish/unpublish), results with filters and CSV export, manual marking of written answers, student list with progress drill-down, class change, password reset, add student/teacher accounts |
| **Notifications** | New lessons, assigned quizzes, deadlines (within 48 h), results, marking finished, study reminders. Mark read, mark all, clear all. Optional browser notifications (only after you turn them on **and** the browser grants permission) |
| **Responsive** | Sidebar on desktop; slide-out menu and bottom nav on phones; no horizontal scrolling at 390 px; 44 px+ touch targets |

## 4. Importing characters

1. Go to **My Character** (sidebar, or the 🎭 tile on the dashboard).
2. Tap the drop zone or drag an image onto it: **PNG, JPG, JPEG or WebP, up to 10 MB**. Transparent PNGs look best.
3. Check the **preview**, rename it if you like, then:
   - **Apply character** saves it and makes it your background straight away
   - **Save to library** keeps it for later
   - **Cancel** discards it
4. Adjust **opacity, brightness, readability overlay, size and position**. Changes show live.
5. **Change character** jumps to your library; press **Use** on any saved character to switch instantly.
6. **Remove character** goes back to the default background but keeps the library. **Delete** (🗑️) permanently removes one saved character after confirmation. **Reset to default background** also resets the sliders.

How the app protects itself: it checks the file extension, MIME type **and** the file's real signature bytes, so a renamed text file is rejected. It refuses images under 64 px or over 50 megapixels, and downscales everything to at most 1600 px before saving. Transparency is kept: PNG/WebP sources are stored as WebP (or PNG where WebP encoding isn't available). Each student can save up to 30 characters, and characters are private to the account that imported them.

## 5. Importing questions

**Teachers:** *Import Questions* adds to the shared school bank. **Students:** *Question Library → Import* adds to a private practice library.

1. Choose a source: **Upload file** (`.csv`, `.json`, `.txt`, max 2 MB / 1,000 questions), **Paste text**, or **Enter manually**.
2. The app parses and validates every row, then shows a **preview**: counts of ready / error / duplicate rows, and a colour-coded table listing each row's problems.
3. **Fix** a row in the editor, **untick** rows to exclude them, or **✕** to drop them. Duplicates (within the file or already in your bank) are unticked by default.
4. Choose the **destination**: subject / topic / class used for rows that leave them blank (or "apply to every row"), the bank name, and (teachers only) whether students may use these questions for topic practice. Leave that **off** for test questions, because practice reveals answers.
5. Click **Import N question(s)** and confirm. The save is **all-or-nothing**: if it fails, nothing is written and your existing bank is unchanged.
6. The summary shows **imported / skipped / rejected** with reasons. From there you can open the bank, create a quiz from the new questions, or download an error report.

### CSV format (`templates/questions-template.csv`)
```
type,question,option_a,option_b,option_c,option_d,option_e,option_f,answer,explanation,subject,level,topic,difficulty,marks,image,manual_marking
mcq,What is 7 × 8?,54,56,64,48,,,B,7 × 8 = 56.,Mathematics,Primary 5,Multiplication,easy,1,,
tf,A noun is a naming word.,,,,,,,true,...,English,Primary 4,Parts of Speech,easy,1,,
fill,Plants make food by ___.,,,,,,,photosynthesis,...,Basic Science,JSS 1,Living Things,medium,2,,
short,Solve 3x + 5 = 20,,,,,,,5|x=5|x = 5,...,Mathematics,JSS 1,Linear Equations,medium,2,,
short,Explain why computers help schools.,,,,,,,,...,Computer Studies,JSS 1,Intro,medium,3,,yes
```
- `type`: `mcq`, `tf`, `short`, `fill`. Common spellings like "multiple choice" or "true/false" are accepted. If blank, the app guesses and warns you.
- `answer`: MCQ takes a letter **A–F** or the exact option text. TF takes `true`/`false`. Short/fill take accepted answers separated by `|`; numbers match numerically (`1,000` = `1000`), and case and trailing punctuation are ignored.
- A short answer with no accepted answers (or `manual_marking=yes`) is **marked by the teacher**.
- `difficulty`: easy / medium / hard. `marks`: 0–100 (default 1). `image`: an `https://` URL or a file name like `diagram1.png`, which is shown to students as a reference.
- Column names are flexible (`question`/`text`, `correct`/`answer`, `class`/`grade`/`level`…). Semicolon-delimited CSVs and Excel's UTF-8 BOM are handled.
- **Excel / Google Sheets:** save or download as **CSV**. `.xlsx` files are detected and refused with instructions. Reading `.xlsx` directly needs a parsing library, which this version deliberately doesn't load.

### JSON format (`templates/questions-template.json`)
```json
{ "questions": [
  { "type": "mcq", "question": "What is 7 × 8?", "options": ["54","56","64","48"], "answer": "B",
    "explanation": "7 × 8 = 56.", "subject": "Mathematics", "level": "Primary 5", "topic": "Multiplication",
    "difficulty": "easy", "marks": 1 }
] }
```
A bare array of question objects also works. For short/fill, `answer` may be a string with `|` or an array.

### Pasted text format (`templates/questions-template.txt`)
```
Q: What is 7 × 8?
A) 54
B) 56
C) 64
D) 48
Answer: B
Explanation: 7 × 8 = 56.
Topic: Multiplication
Subject: Mathematics

Q: Water boils at ___ °C at sea level.
Type: fill
Answer: 100|100°C
Topic: Matter
Subject: Basic Science
```
Separate questions with a blank line. You can also paste CSV (with its header row) or JSON into the same box.

### Sample files
- `templates/sample-bank-mathematics.csv` / `.json`: 22 Maths questions
- `templates/sample-bank-english.csv` / `.json`: 19 English questions
- `templates/test-import-with-errors.csv`: deliberately broken rows (bad answer letter, invalid true/false, missing answer, missing topic, bad difficulty, a duplicate, and a `<script>` tag) to show the validator at work

## 6. Using imported questions in quizzes
*Quizzes → New quiz* (or select questions in the bank and press **Create quiz from selected**). Add questions with filters, set per-question marks, timer, feedback mode, shuffle, who it's assigned to and the due date. **Preview** shows the quiz with the answer key hidden by default, then **Publish**. Assigned students get a notification. The player only receives copies of questions with answers and explanations removed; answers are checked by the quiz service and explanations appear after answering or after submission, depending on the teacher's setting.

## 7. Security measures in this version
- Passwords: PBKDF2-SHA256, 150,000 iterations, 16-byte random salt, never stored in plain text; constant-time compare; 60-second lockout after 5 failures.
- Sessions: random 256-bit tokens with expiry (12 h, or 7 days with "keep me signed in").
- Rendering: every piece of user or imported text goes through an auto-escaping template. Lesson markup is a tiny whitelist (`##`, `-`, `>`), and no `innerHTML` receives raw data. A strict **Content-Security-Policy** (`script-src 'self'`) blocks any injected script even if escaping were bypassed.
- Imports: extension, size and content sniffing (binary/zip detection), control-character stripping, length limits, 1,000-question cap, and nothing from a file is ever executed. Exports guard against spreadsheet formula injection.
- Authorisation: routes are role-guarded, and every teacher write calls `requireTeacher()`. Students only read their own attempts, notifications, characters and practice questions.

## 8. Features that need a backend
These are **not** implemented here. Faking them would be misleading.

| Need | Why a server is required |
|---|---|
| Accounts across devices, cloud sync and backups | Browser storage is per device and per browser |
| Truly private answer keys and teacher data | Anything in the browser can be read by its user; the answer key has to stay on a server until submission |
| Tamper-proof scores and permissions | Server-side validation of every request |
| Email password recovery and verification | Needs an email service (e.g. Resend or SendGrid) and signed reset tokens |
| Push notifications when the app is closed | Needs a service worker plus a push service and server |
| `.xlsx` import | Feasible client-side with a library such as SheetJS; left out to keep the app dependency-free |
| AI assistant (like the "AI Owl" in the design reference) | Needs an LLM API key on a server; never put API keys in browser code |

A suggested production stack: Node.js (Express/Fastify) or Supabase with Postgres, Argon2id or bcrypt hashing, HTTP-only session cookies, row-level security (students → own rows; teachers → their classes), server-side answer checking, object storage for images with server-side re-encoding, and nightly backups. The modules in `js/services.js` are the seam: each function maps one-to-one to an API endpoint.

## 9. Testing
`tests/e2e.test.js` drives a real Chromium browser through 58 checks: setup, registration validation, password hashing, role redirects, character import / switch / reload / theme / remove / delete / invalid files, lesson practice, both quiz modes, timer, restart, palette navigation, score records, the error-filled CSV import, row fixing, destination defaults, XSS-as-text, `.xlsx` and malformed JSON rejection, paste import, quiz building / preview / publishing, teacher preview not saved, notifications, manual marking, CSV results export, password reset, and phone layout without horizontal scroll.

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

Screenshots are written to `tests/output/`.

**Not covered by automated tests:** Safari/iOS and Firefox (only Chromium was run), real browser-notification delivery, storage-quota-full handling, and very large imports near the 1,000-question limit.
