# Home Land Homes — marketing site (homelandhomes.ca)

The public marketing/brand site for the housing-management platform. **Completely
separate from the app**: static files only, no shared code, cookies, or sessions —
it just links out to the app login (`https://fnhub.app`).

Plain HTML + CSS + a small progressive-enhancement JS file. No framework, no build
step, no dependencies, no trackers, no cookies.

> This folder lives in the app repo for review convenience only. It is designed to
> be lifted verbatim into its own repository — nothing in it references anything
> outside this folder.

## Run locally

Any static server from this folder:

```sh
cd marketing-site
python -m http.server 8080
# or: npx serve .
```

Open http://localhost:8080.

## Deploy to Cloudflare Pages

**Dashboard:** Cloudflare → Workers & Pages → Create → Pages → connect the repo
(or direct upload). Build command: *none*. Build output directory: this folder
(`marketing-site`, or `/` once it's in its own repo).

**CLI:**

```sh
npx wrangler pages deploy marketing-site --project-name homelandhomes
```

`_headers` is picked up automatically by Pages and sets the CSP, HSTS,
`X-Content-Type-Options`, referrer and permissions policies. `404.html` is served
for unknown routes automatically.

After the first deploy, attach the real custom domain in the Pages project and
enable "Always Use HTTPS".

## ✅ What I need from you (placeholders to fill)

Nothing on the site is invented — these are the deliberately-open slots:

| # | Item | Where |
|---|------|-------|
| 1 | ~~Final product name~~ ✅ **Home Land Homes** (applied everywhere) | — |
| 2 | **Logo** (replaces the placeholder house mark + favicon) | `.brand` SVGs in `index.html`, `assets/img/favicon.svg` |
| 3 | **Brand colors** | The `:root` (and dark-scheme) variables at the top of `assets/css/styles.css` — every color routes through them |
| 4 | ~~Production domain~~ ✅ **homelandhomes.ca** (applied to canonical/OG, `robots.txt`, `sitemap.xml`) | — |
| 5 | **Contact email** | `SITE_CONFIG.contactEmail` in `assets/js/main.js` (footer + mailto form fallback pick it up automatically) |
| 6 | **Form endpoint** (optional — a URL accepting a JSON POST; a tiny Cloudflare Worker works well) | `SITE_CONFIG.formEndpoint` in `assets/js/main.js`; if it's on another origin, also add it to `connect-src` in `_headers` |
| 7 | **App login URL** (currently `https://fnhub.app`) | `SITE_CONFIG.appLoginUrl` + the two "Sign in" links in `index.html` |
| 8 | **About / founding story** copy | `#about` section placeholder in `index.html` |
| 9 | **Pricing sign-off** — a full `#pricing` section is on the page with a market-researched schedule: tiers by homes managed, one-time setup (scoped per tier: data migration + 2/4/6 live training sessions, **waived on a two-year agreement**), AI add-on. Monthly billing = annual rate +10%; **50% off the first year** on a one-year term paid up front (renewals at the regular annual rate — change the footnote wording if the discount is meant to recur). Benchmarked against Yardi Breeze (~$1–2/unit/mo), Buildium ($62–400/mo flat), AppFolio onboarding ($400–$5,000), enterprise implementations ($25k+); FN-sector vendors are mostly quote-only. Setup scope + messy-data handling is promised "in writing after a scoping call" — make sure the sales process actually does that. Adjust freely — plain HTML in one section | `#pricing` section in `index.html` |
| 10 | **Land acknowledgement** wording | Footer placeholder in `index.html` |
| 11 | **Legal entity name** for the © line | Footer in `index.html` |
| 12 | **OG/social image** — 1200×630 PNG at `assets/img/og-image.png` (referenced but not shipped) | `og:image` in `index.html` |
| 13 | **Authentic artwork/photography** (optional) — the hero illustration is a neutral placeholder SVG with a marked swap slot | `.hero-art` in `index.html` |

## ⚠️ Claims that need your confirmation before launch

These statements are on the site because the product brief asserts them; please
verify each is accurate **as worded** before going live:

- **"Hosted in Canada / data stays in Canada"** — confirm the hosting region of
  each nation's database and storage actually guarantees this.
- **"Never sold, shared, or used to train anything"** — confirm this matches your
  actual data-handling and AI-provider agreements.
- **"You can export everything / your records go with you if you leave"** —
  confirm an export path exists and you're happy committing to it publicly.
- **"QR-code maintenance requests with photos"** and the **tenant portal /
  magic-link** features — confirm they're live (not roadmap) before advertising.
- **OCAP® wording** — the site says "designed in alignment with OCAP® principles"
  and carries the FNIGC trademark attribution + non-affiliation note in two
  places. Have it reviewed; never imply certification or endorsement.
- No testimonials, client names, statistics, or certifications appear anywhere —
  keep it that way until you have written permission to name someone.

## Accessibility & performance notes

- Semantic landmarks, skip link, one `h1`, labelled form fields, `aria-expanded`
  nav toggle, visible focus styles, WCAG-AA-checked palette in both schemes.
- Honors `prefers-color-scheme` (light/dark) and `prefers-reduced-motion`
  (scroll animations disabled; content never hidden without JS).
- System font stack (zero font downloads), one CSS file, one deferred JS file,
  inline SVG only — no external requests at all, which also makes the strict CSP
  (`default-src 'none'`) possible.
