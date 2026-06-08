# Insight Hub MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, usable MVP for uploading weekly/monthly insight files, auto-generating titles, browsing the latest issue, searching history, and reading uploaded files.

**Architecture:** Create a zero-dependency single-page app with focused browser-side modules for data, file persistence, issue metadata, and UI rendering. Use IndexedDB for uploaded file blobs and `localStorage` for issue metadata so the MVP works locally without backend setup.

**Tech Stack:** HTML, CSS, vanilla JavaScript, IndexedDB, localStorage, a tiny Node static server for local verification.

---

## File Structure

- `index.html`: Vite HTML entry.
- `src/app.js`: app state, generated title logic, metadata persistence, IndexedDB file storage, upload workflow, archive/search, latest issue, and reader rendering.
- `src/styles.css`: full responsive product UI.
- `server.js`: dependency-free local static server.

## Tasks

### Task 1: Scaffold Static App

**Files:**
- Create: `index.html`
- Create: `server.js`

- [ ] **Step 1: Create static HTML shell**

Create `index.html` with topbar, latest band, archive/search controls, upload form, and reader panel.

- [ ] **Step 2: Create local server**

Create `server.js` using Node's built-in `http`, `fs`, and `path` modules.

### Task 2: Implement Data Model and Persistence

**Files:**
- Create: `src/app.js`

- [ ] **Step 1: Define types**

Define issue objects matching the PRD, including `insightType`, generated `title`, `issueDate`, `category`, `summary`, `tags`, `fileName`, `fileType`, `fileSize`, `status`, `createdAt`, `updatedAt`, and `isLatest`.

- [ ] **Step 2: Implement generated titles**

Implement `generateIssueTitle(date, insightType)` so weekly titles use `YYYY-MM-DD Weekly Insights` and monthly titles use `YYYY-MM Monthly Insights`.

- [ ] **Step 3: Implement metadata storage**

Implement `loadIssues`, `saveIssues`, `upsertIssue`, and `markLatestIssue` using localStorage.

- [ ] **Step 4: Implement IndexedDB file storage**

Implement `saveIssueFile`, `getIssueFile`, and `deleteIssueFile` with an object store named `files`.

- [ ] **Step 5: Seed demo issues**

Create three sample issues so the app has historical content before the first upload.

### Task 3: Build Core UI and Workflows

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Create: `src/styles.css`

- [ ] **Step 1: Build app shell**

Implement a two-column dashboard: left side for latest issue and archive/search, right side for upload and selected issue reader.

- [ ] **Step 2: Build upload form**

Support `.ppt`, `.pptx`, and `.pdf`, require insight type/date/category, make summary optional, generate title automatically, save metadata and file blob, and allow setting the new upload as latest.

- [ ] **Step 3: Build latest/history/search**

Show latest issue, archive sorted by date, filters for type/category, and search across title, summary, category, tags, and extracted placeholder text.

- [ ] **Step 4: Build reader**

For PDF files, render an embedded preview from the stored blob. For PPT/PPTX files, show a conversion-status reading surface with original file download fallback.

- [ ] **Step 5: Style responsive UI**

Create a dense but polished internal tool UI that works on desktop and mobile without overlapping text.

### Task 4: Verify MVP

**Files:**
- Modify as needed based on verification.

- [ ] **Step 1: Run build**

Run: `/Users/wayne/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check src/app.js`

Expected: JavaScript syntax check passes.

- [ ] **Step 2: Start dev server**

Run: `/Users/wayne/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js`

Expected: app available at `http://127.0.0.1:4173`.

- [ ] **Step 3: Browser verify**

Open the app, upload a sample PDF/PPT record if available, verify auto-generated title, latest selection, archive search, type filter, category filter, and reader fallback.

- [ ] **Step 4: Final check**

Run: `git status --short` and report changed files.
