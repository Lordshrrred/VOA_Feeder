#!/usr/bin/env node
/* ================================================
   Frequency Rising ~ generate-post.js
   Usage: node scripts/generate-post.js \
            --keyword "feel stuck in life" \
            --title "Why You Feel Stuck in Life" \
            --category "Breaking Out"

   Triggered by GitHub Actions. Do not run manually
   unless you have ANTHROPIC_API_KEY and
   GITHUB_TOKEN in your environment.
   ================================================ */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/* ---- Parse CLI args ---- */
const args = parseArgs(process.argv.slice(2));
const keyword  = args['keyword']  || '';
const title    = args['title']    || '';
const category = args['category'] || 'Breaking Out';
const voaUrl   = args['voa_post_url']   || null;
const voaTitle = args['voa_post_title'] || null;

if (!keyword || !title) {
  console.error('Error: --keyword and --title are required.');
  process.exit(1);
}

/* ---- Derived values ---- */
const slug      = slugify(title);
const date      = new Date().toISOString().split('T')[0];
const postUrl   = `blog/${slug}.html`;
const outputFile = path.join(process.cwd(), postUrl);
const postsFile  = path.join(process.cwd(), 'blog', 'posts.json');
const sitemapFile = path.join(process.cwd(), 'sitemap.xml');

/* ---- Build the Claude prompt ---- */
const voaInstruction = voaUrl
  ? `\nThis article should also link naturally to ${voaUrl} (titled "${voaTitle}") once ~ make it feel organic, not forced. The angle should be related but distinct from that article.`
  : '\nLink to vibrationofawesome.com once naturally ~ make it feel organic not forced.';

const userPrompt = [
  `Keyword: ${keyword}`,
  `Title: ${title}`,
  `Category: ${category}`,
  `Write a 900-1200 word SEO-optimized article for Frequency Rising.`,
  voaInstruction
].join('\n');

const systemPrompt = [
  'You are a writer for Frequency Rising, a personal development blog.',
  'Write SEO-optimized genuinely helpful long-form articles for people who are stuck, waking up, or reinventing their lives.',
  'Voice: real, direct, zero fluff, no corporate language, no em dashes ~ use tildes.',
  'Short punchy paragraphs. H2 and H3 subheadings.',
  'First line must be: META: [under 160 chars]',
  'End with genuine takeaway not a sales pitch.',
  '900-1200 words. Return clean HTML body only ~ no html/head/body wrapper tags.'
].join(' ');

/* ---- Call Claude API ---- */
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

callClaude(systemPrompt, userPrompt)
  .then(function (rawContent) {
    /* Strip META line and capture it */
    const lines = rawContent.split('\n');
    let metaDescription = '';
    let bodyLines = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('META:')) {
        metaDescription = lines[i].replace('META:', '').trim().slice(0, 160);
      } else {
        bodyLines.push(lines[i]);
      }
    }

    const bodyHtml = bodyLines.join('\n').trim();

    /* Build full page HTML */
    const pageHtml = buildPage({
      title,
      slug,
      category,
      date,
      metaDescription,
      bodyHtml,
      voaUrl,
      voaTitle
    });

    /* Write blog post file */
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, pageHtml, 'utf8');
    console.log('Written:', outputFile);

    /* Update posts.json */
    const posts = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
    posts.unshift({
      slug,
      title,
      description: metaDescription,
      category,
      date,
      url: postUrl
    });
    fs.writeFileSync(postsFile, JSON.stringify(posts, null, 2), 'utf8');
    console.log('Updated: blog/posts.json');

    /* Update sitemap.xml */
    updateSitemap(sitemapFile, slug, date);
    console.log('Updated: sitemap.xml');

    /* Git commit and push */
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      gitPush(slug, title);
    } else {
      console.log('GITHUB_TOKEN not set ~ skipping git push.');
    }
  })
  .catch(function (err) {
    console.error('Claude API error:', err.message);
    process.exit(1);
  });

/* ================================================
   Helper functions
   ================================================ */

function callClaude(system, user) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2048,
      system: system,
      messages: [{ role: 'user', content: user }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, function (res) {
      let data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            return reject(new Error(parsed.error.message));
          }
          const text = parsed.content && parsed.content[0] && parsed.content[0].text;
          if (!text) return reject(new Error('No content in API response'));
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse API response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPage({ title, slug, category, date, metaDescription, bodyHtml }) {
  const canonical = `https://lordshrrred.github.io/VOA_GithubPages/blog/${slug}.html`;
  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const yr = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} ~ Frequency Rising</title>
  <meta name="description" content="${escHtml(metaDescription)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escHtml(title)} ~ Frequency Rising">
  <meta property="og:description" content="${escHtml(metaDescription)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Frequency Rising">
  <meta property="article:published_time" content="${date}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0f0a; --bg2: #0e140e; --border: #1a271a;
      --lime: #39FF14; --lime-dim: #2dcc10;
      --cyan: #00FFFF; --cyan-dim: #00cccc;
      --text: #d8e8d8; --muted: #6a8a6a; --max: 1080px; --r: 6px;
    }
    html { scroll-behavior: smooth; }
    body {
      background: var(--bg); color: var(--text);
      font-family: 'Source Serif 4', Georgia, serif;
      font-size: 1.05rem; line-height: 1.75;
      min-height: 100vh; display: flex; flex-direction: column;
    }
    a { color: var(--cyan); text-decoration: none; transition: color .2s; }
    a:hover { color: var(--cyan-dim); text-decoration: underline; }
    h1, h2, h3, h4 { font-family: 'Inter', sans-serif; font-weight: 800; line-height: 1.25; color: #fff; }
    .wrap { width: 100%; max-width: var(--max); margin: 0 auto; padding: 0 1.5rem; }
    main { flex: 1; }

    .nav {
      position: sticky; top: 0; z-index: 99;
      background: rgba(10,15,10,.93);
      border-bottom: 1px solid var(--border);
      backdrop-filter: blur(10px);
    }
    .nav-inner {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.5rem; max-width: var(--max); margin: 0 auto;
    }
    .nav-logo {
      font-family: 'Inter', sans-serif; font-weight: 800; font-size: 1rem;
      letter-spacing: .12em; text-transform: uppercase; color: var(--lime);
    }
    .nav-logo:hover { color: var(--lime-dim); text-decoration: none; }
    .nav-links { display: flex; gap: 2rem; list-style: none; }
    .nav-links a {
      font-family: 'Inter', sans-serif; font-size: .85rem; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
    }
    .nav-links a:hover, .nav-links a.active { color: var(--lime); text-decoration: none; }

    .post-wrap { max-width: 720px; padding: 3.5rem 0 5rem; }
    .section-label {
      display: inline-block; font-family: 'Inter', sans-serif;
      font-size: .7rem; font-weight: 700; letter-spacing: .15em;
      text-transform: uppercase; color: var(--lime); margin-bottom: .75rem;
    }
    .post-wrap h1 { font-size: clamp(1.75rem, 4vw, 2.75rem); margin-bottom: .75rem; }
    .post-meta {
      font-family: 'Inter', sans-serif; font-size: .82rem; color: var(--muted);
      margin-bottom: 2.5rem; display: flex; align-items: center; gap: 1rem;
    }
    .post-meta .cat { color: var(--lime); font-weight: 700; }
    .post-divider { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

    .post-body h2 { font-size: 1.45rem; margin: 2.5rem 0 .9rem; }
    .post-body h3 { font-size: 1.15rem; color: var(--lime); margin: 2rem 0 .7rem; }
    .post-body p  { margin-bottom: 1.3rem; }
    .post-body ul, .post-body ol { margin: 0 0 1.3rem 1.5rem; }
    .post-body li { margin-bottom: .4rem; }
    .post-body strong { color: #fff; font-weight: 600; }
    .post-body a { color: var(--cyan); }

    .footer { border-top: 1px solid var(--border); padding: 2.5rem 0; margin-top: auto; }
    .footer-inner { max-width: var(--max); margin: 0 auto; padding: 0 1.5rem; text-align: center; }
    .footer-brand {
      font-family: 'Inter', sans-serif; font-weight: 800; font-size: .9rem;
      letter-spacing: .1em; text-transform: uppercase; color: var(--lime);
      display: block; margin-bottom: .5rem;
    }
    .footer p { font-size: .85rem; color: var(--muted); line-height: 1.6; }
    .footer a { color: var(--cyan); }

    @media (max-width: 600px) {
      .nav-inner { flex-direction: column; gap: .75rem; }
      .nav-links { gap: 1.25rem; }
    }
  </style>
</head>
<body>

  <nav class="nav" aria-label="Main navigation">
    <div class="nav-inner">
      <a href="../index.html" class="nav-logo">Frequency Rising</a>
      <ul class="nav-links">
        <li><a href="index.html" class="active">Blog</a></li>
        <li><a href="../about.html">About</a></li>
      </ul>
    </div>
  </nav>

  <main>
    <article class="wrap">
      <div class="post-wrap">
        <span class="section-label">${escHtml(category)}</span>
        <h1>${escHtml(title)}</h1>
        <div class="post-meta">
          <span class="cat">${escHtml(category)}</span>
          <time datetime="${date}">${displayDate}</time>
        </div>
        <hr class="post-divider">
        <div class="post-body">
          ${bodyHtml}
        </div>
      </div>
    </article>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <span class="footer-brand">Frequency Rising</span>
      <p>Independent signal for people breaking out and leveling up.</p>
      <p>A <a href="https://vibrationofawesome.com" target="_blank" rel="noopener">Vibration of Awesome</a> affiliate site.</p>
    </div>
  </footer>

</body>
</html>`;
}

function updateSitemap(sitemapFile, slug, date) {
  let xml = fs.readFileSync(sitemapFile, 'utf8');
  const newUrl = [
    '  <url>',
    `    <loc>https://lordshrrred.github.io/VOA_GithubPages/blog/${slug}.html</loc>`,
    `    <lastmod>${date}</lastmod>`,
    '    <changefreq>monthly</changefreq>',
    '    <priority>0.7</priority>',
    '  </url>'
  ].join('\n');
  xml = xml.replace('</urlset>', newUrl + '\n</urlset>');
  fs.writeFileSync(sitemapFile, xml, 'utf8');
}

function gitPush(slug, title) {
  try {
    execSync('git config user.email "actions@github.com"', { stdio: 'inherit' });
    execSync('git config user.name "GitHub Actions"', { stdio: 'inherit' });
    execSync(`git add blog/${slug}.html blog/posts.json sitemap.xml`, { stdio: 'inherit' });
    execSync(`git commit -m "Add post: ${title.replace(/"/g, "'")}"`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });
    console.log('Pushed to GitHub.');
  } catch (err) {
    console.error('Git push failed:', err.message);
    process.exit(1);
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      result[key] = val;
    }
  }
  return result;
}
