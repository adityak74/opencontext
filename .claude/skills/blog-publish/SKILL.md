---
name: blog-publish
description: Writes and publishes the next open-context.dev blog post — SEO+GEO checked static HTML, added to the blog index and sitemap, committed straight to main (which Cloudflare Pages auto-deploys), then submitted to Google Search Console. Use when asked to write/publish the next open-context blog post, or when running on the recurring every-2-days blog schedule.
---

# blog-publish

Publishes one new post to the open-context.dev blog. This is a **fully autonomous,
publish-directly-to-production** skill: it writes to `main`, which Cloudflare Pages
auto-deploys with no review step. Follow this document exactly — don't skip the
SEO/GEO checklist or the manifest bookkeeping, since there is no human review gate
to catch mistakes before they go live.

Runs on a schedule every 2 days. **Never submit to Hacker News as part of this
skill** — HN submission for open-context is a one-time, human-approved action
that already happened for the launch post. Repeat self-submission to HN reads as
spam and risks the domain's standing there.

## Repo layout this skill owns

```
ui/public/blog/
├── index.html              # blog listing page — prepend new posts here
├── manifest.json           # published posts + topic backlog, source of truth
└── <slug>/index.html       # one static, self-contained HTML file per post

ui/public/sitemap.xml       # add a <url> entry for every new post
ui/public/robots.txt        # references the sitemap — shouldn't normally need edits
```

Blog posts are **plain static HTML files**, not part of the React/Vite SPA. Vite
copies everything under `ui/public/` verbatim into `dist/`, so `ui/public/blog/foo/index.html`
is served at `https://open-context.dev/blog/foo/` with zero JS required to render —
this matters for both crawler SEO and AI-citation (GEO) readability. Do not try to
route blog posts through `ui/src/App.tsx` / React Router.

## Step-by-step

### 1. Read the manifest, pick the next topic

Read `ui/public/blog/manifest.json`. It has:

```json
{
  "posts": [
    { "slug": "migrate-chatgpt-to-claude", "title": "...", "publishedAt": "2026-08-08", "topicTag": "migration-guide" }
  ],
  "backlog": [
    { "topicTag": "mcp-persistent-memory", "workingTitle": "..." },
    ...
  ]
}
```

Pick the **first backlog entry not already present in `posts`** (match on `topicTag`).
If the backlog is exhausted, generate 5 new topic ideas in the same spirit (see
"Topic backlog" below for the seed list and the criteria for adding more) and
append them to `backlog` before picking one.

Never repeat a `topicTag` that already has a published post — check for near-duplicate
titles/keywords too, not just exact tag matches.

### 2. Research

- Ground product claims in the actual repo: `README.md`, `CLAUDE.md`, `src/`, `ui/src/`.
  Don't invent features that don't exist.
- For general claims (AI adoption stats, competitor tool comparisons, MCP ecosystem
  facts), use `WebSearch`/`WebFetch` and cite tier 1-3 sources (official docs, major
  publications, primary data) — never fabricate a statistic.
- Keep the target keyword intent concrete and searchable (e.g. "export chatgpt
  history to claude", "claude persistent memory mcp", "chatgpt data portability") —
  prefer long-tail, high-intent phrases over generic marketing language.

### 3. Write the post

Follow this structure (matches the 6-pillar dual-optimization approach used by the
`claude-blog` skill family — SEO for search engines, GEO for AI answer engines):

1. **Title** (H1): 50–60 chars, includes the primary keyword, no clickbait.
2. **Meta description**: 150–160 chars, includes the primary keyword, states the
   concrete outcome/answer.
3. **Answer-first opening paragraph**: directly answers the implied question in
   2-3 sentences before any preamble — this is what AI answer engines lift verbatim.
4. **Key Takeaways box**: 3-5 bullet points near the top, scannable, each one a
   complete standalone claim (citable in isolation — this is the single highest-leverage
   GEO element).
5. **Body**: proper H2/H3 hierarchy, one idea per section, short paragraphs
   (2-4 sentences), concrete examples over abstractions. Internal-link to the
   homepage (`/`) and at least one other published post where topically relevant.
6. **FAQ section** (H2 "FAQ" + 3-5 Q&A pairs as H3 questions): mirrors real search
   queries, each answer is 1-3 sentences and stands alone.
7. **Word count**: 900-1600 words. Don't pad — cut anything that doesn't serve the
   reader's task.
8. No fabricated stats, no fabricated customer quotes, no AI-detectable filler
   phrases ("in today's fast-paced world", "unlock the power of", etc).

### 4. Build the static HTML page

Copy the structure of an existing post under `ui/public/blog/*/index.html` (the
launch post `migrate-chatgpt-to-claude` is the canonical reference — match its
`<head>`, header, footer, and CSS exactly; only the `<main>` article content and
metadata change per post). Required in `<head>`:

- `<title>` — the post title, ~50-60 chars
- `<meta name="description">` — the meta description
- `<link rel="canonical" href="https://open-context.dev/blog/<slug>/">`
- Open Graph: `og:title`, `og:description`, `og:type=article`, `og:url`, `og:image`
  (use `/opencontext-logo.png` unless a post-specific image exists)
- Twitter card: `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`
- JSON-LD `<script type="application/ld+json">` with **both**:
  - a `BlogPosting` node (headline, description, datePublished, dateModified,
    author `Organization` "open-context", publisher, mainEntityOfPage)
  - a `FAQPage` node with `mainEntity` mirroring the FAQ section exactly (question
    text must match the visible H3s verbatim — mismatches hurt rich-result eligibility)

Visual/CSS: match the site's pitch-black theme exactly — reuse the inline `<style>`
block from the reference post (background `#000`, foreground near-white, Styrene A
font from `/styrene-font-family/`, same header/nav/footer markup as `ui/src/components/Landing.tsx`
so the blog feels like the same product, not a bolted-on afterthought). Keep it a
single self-contained file — no external CSS/JS build step exists for this path.

### 5. Update the blog index

Prepend a card for the new post to `ui/public/blog/index.html` (title, 1-sentence
excerpt, date, link). Keep newest-first order. Reuse the same header/footer/theme
as the post pages.

### 6. Update the sitemap

Add a `<url>` entry to `ui/public/sitemap.xml` for the new post
(`https://open-context.dev/blog/<slug>/`, `<lastmod>` = today, `<changefreq>monthly</changefreq>`).
If `ui/public/sitemap.xml` or `ui/public/robots.txt` don't exist yet, create them
(robots.txt should `Allow: /` and reference `Sitemap: https://open-context.dev/sitemap.xml`).

### 7. Update the manifest

Append the new post to `manifest.json`'s `posts` array (slug, title, publishedAt
ISO date, topicTag) and remove the corresponding entry from `backlog`.

### 8. Self-check before publishing (do not skip)

- [ ] Title 50-60 chars, meta description 150-160 chars
- [ ] Exactly one H1, logical H2/H3 nesting, no skipped levels
- [ ] JSON-LD validates as well-formed JSON and FAQ questions match visible text
- [ ] Canonical URL matches the actual deploy path
- [ ] Internal links resolve (homepage `/`, at least one other real post)
- [ ] No fabricated statistics or claims not grounded in the repo or a cited source
- [ ] `manifest.json`, `sitemap.xml`, and `blog/index.html` are all updated

### 9. Commit and push directly to main

```bash
git add ui/public/blog ui/public/sitemap.xml ui/public/robots.txt
git commit -m "feat(blog): publish \"<post title>\""
git push origin main
```

This is pre-authorized — push directly, don't open a PR, don't ask for confirmation.
Cloudflare Pages deploys automatically on push to `main`.

### 10. Submit to Google Search Console

Site property: `sc-domain:open-context.dev` (already verified, full access).

1. `mcp__gscServer__manage_sitemaps` — submit `https://open-context.dev/sitemap.xml`
   (safe to resubmit the same sitemap URL every run; GSC just re-crawls it).
2. `mcp__gscServer__inspect_url_enhanced` on the new post's full URL to confirm
   Google's current view of it and surface any indexing issues. Note the result in
   your final summary to the user/log — GSC has no public "force index now" API,
   so this step is diagnostic, not a guarantee of immediate indexing.

### 11. Report

Summarize what was published (title, URL, target keyword), confirm the deploy was
pushed, and report the GSC sitemap/inspection result. Do not submit to HN.

## Topic backlog (seed list — extend as needed)

Stored authoritatively in `ui/public/blog/manifest.json`; this list is the seed
used to populate it the first time. When generating more topics, keep them:
tightly scoped to a single search intent, grounded in something open-context
actually does, and not overlapping an already-published `topicTag`.

1. `mcp-persistent-memory` — "How Claude's MCP Persistent Memory Works (and How to Set It Up)"
2. `chatgpt-export-guide` — "How to Export Your Full ChatGPT Conversation History"
3. `claude-preferences-setup` — "Claude Preferences vs Memory: What's the Difference and How to Use Both"
4. `self-hosted-ai-context` — "Why Self-Hosting Your AI Context Matters for Privacy"
5. `docker-mcp-server-setup` — "Running an MCP Server in Docker: A Practical Guide"
6. `gemini-to-claude-migration` — "Migrating from Google Gemini to Claude: What Transfers and What Doesn't"
7. `ai-context-portability` — "AI Context Portability: Why Vendor Lock-In Is an Unsolved Problem"
8. `bubbles-project-workspaces` — "Organizing AI Context by Project with open-context Bubbles"
