# THE MEN’S ARCHIVE — production SEO build

This package keeps the existing Supabase admin/auth architecture and adds build-time static generation for public pages.

## Critical auth rule (do not regress)
- Public read: `apikey` only.
- Authenticated admin: `apikey` + `Authorization: Bearer <session.access_token>`.
- Never place a Supabase `service_role`/secret key in browser files.

## Build output
Upload only the `site/` folder to Cloudflare Pages after running the build.

```bash
npm run build
```

The build calls `archive_read_public` using only the Supabase publishable key and generates **published articles only**.

Generated output includes:
- `/index.html`
- `/archive/`
- `/articles/{slug}/`
- `/topics/{topic}/`
- `/eras/{era}/`
- `sitemap.xml`
- `rss.xml`
- `feed.json`
- `llms.txt`
- `robots.txt`
- `admin.html` (noindex)

## SEO / structured data
Each article gets server-visible HTML plus:
- unique `<title>` and meta description
- canonical URL
- Open Graph and Twitter Card
- `BlogPosting` JSON-LD
- `BreadcrumbList` JSON-LD
- `WebPage`, `WebSite`, `Organization` graph
- `datePublished`, `dateModified`, `author`, `articleSection`, `keywords`, image when available

Collection pages get `CollectionPage` + `ItemList` JSON-LD.

## AI crawling
`robots.txt` explicitly allows `OAI-SearchBot` for ChatGPT Search discovery. `GPTBot` is disallowed by default because OpenAI documents it separately as a model-training crawler. Change that only if you intentionally want to opt into GPTBot crawling.

`llms.txt` is included as a machine-readable convenience layer, but is not treated as a ranking guarantee or a replacement for normal HTML, sitemaps, and structured data.

## Slug policy
Published article slugs must match:

`^[a-z0-9]+(?:-[a-z0-9]+)*$`

The build fails on a missing/unsafe/duplicate published slug. Keep a published slug stable. If a slug must change later, add a 301 redirect from the old URL.

## Before first real production release
Confirm in Supabase:
- `archive_read_public`
- `archive_read_admin`
- `archive_save`
- admin UID in `archive_private.editors`
- RLS/write permissions allow writes only to admins
- `archive-media` is Public if public article images are expected to render directly

Then validate a sample article with Google Rich Results Test and Search Console URL Inspection, submit `/sitemap.xml`, and confirm Cloudflare serves the generated HTML without login.

## Test without Supabase
```bash
npm run build:fixture
```
This fixture includes one published and one draft article. The draft must never appear in generated public output.
