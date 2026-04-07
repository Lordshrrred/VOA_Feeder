# Frequency Rising

**Live site:** https://lordshrrred.github.io/VOA_Feeder/

An independent personal development blog and SEO feeder site for [vibrationofawesome.com](https://vibrationofawesome.com). Articles are AI-generated, SEO-optimized, and published automatically via GitHub Actions.

---

## What this site is

Frequency Rising covers identity shifts, breaking out of survival mode, creative freedom, inner work, and building a life that actually fits. Articles are written in a real, direct voice and link naturally to the main VOA brand.

---

## Publishing a post via GitHub Actions

1. Go to the **Actions** tab of this repo
2. Select **Generate Blog Post** from the left sidebar
3. Click **Run workflow**
4. Fill in:
   - **keyword** ~ the SEO phrase to target (e.g. `feel stuck in life`)
   - **title** ~ the article title (e.g. `Why You Feel Stuck in Life`)
   - **category** ~ choose from the dropdown
5. Click **Run workflow**

GitHub Actions will:
- Call the Claude API to generate a 900-1200 word article
- Save it to `blog/[slug].html`
- Update `blog/posts.json`
- Update `sitemap.xml`
- Commit and push ~ the post is live within seconds

---

## How the VOA trigger works

When vibrationofawesome.com publishes a new post, it can automatically trigger a supporting feeder article here via a `repository_dispatch` event.

**From VOA, after publishing:**

```bash
curl -X POST \
  -H "Authorization: token YOUR_GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/Lordshrrred/VOA_Feeder/dispatches \
  -d '{
    "event_type": "voa-post-published",
    "client_payload": {
      "voa_post_url": "https://vibrationofawesome.com/your-post-slug/",
      "voa_post_title": "Your VOA Post Title",
      "voa_post_keyword": "your keyword",
      "voa_post_slug": "your-post-slug"
    }
  }'
```

The workflow (`voa-trigger.yml`) now generates a related-but-distinct article with:
- a unique feeder title
- a deterministic feeder slug based on the VOA source slug
- an enforced backlink to the specific VOA post

**Note:** `YOUR_GITHUB_PAT` is a Personal Access Token with `repo` scope. Generate one at github.com/settings/tokens. This is different from `GITHUB_TOKEN` which is only available inside Actions runs.

---

## Required secrets

Add these in **Settings > Secrets and variables > Actions** at:
`github.com/Lordshrrred/VOA_Feeder/settings/secrets/actions`

| Secret | Description |
|--------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key ~ already in your `.env`, add it here |

**`GITHUB_TOKEN` is provided automatically by GitHub Actions ~ no setup needed.**

---

## File structure

```
index.html              ~ Homepage
about.html              ~ About page
blog/
  index.html            ~ Blog listing (reads posts.json dynamically)
  posts.json            ~ Post metadata array (updated by generator)
css/
  style.css             ~ All styles
js/
  main.js               ~ Dynamic post loading
scripts/
  generate-post.js      ~ Post generator (called by Actions, not manually)
.github/
  workflows/
    generate-post.yml   ~ Manual trigger workflow
    voa-trigger.yml     ~ Auto-trigger from VOA
sitemap.xml             ~ Grows as posts are added
robots.txt
```
