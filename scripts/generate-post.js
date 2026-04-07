#!/usr/bin/env node
/* ================================================
   Frequency Rising ~ generate-post.js

   Manual usage:
     node scripts/generate-post.js \
       --keyword "feel stuck in life" \
       --title "Why You Feel Stuck in Life" \
       --category "Breaking Out"

   VOA-triggered usage:
     node scripts/generate-post.js \
       --keyword "paradigm of abundance" \
       --category "Breaking Out" \
       --voa_post_url "https://vibrationofawesome.com/blog/matt/posts/paradigm-of-abundance/" \
       --voa_post_title "The Paradigm of Abundance" \
       --voa_post_slug "paradigm-of-abundance"

   Triggered by GitHub Actions. Source-triggered runs create
   a deterministic feeder slug, a unique generated title, and
   enforce a backlink to the original VOA post.
   ================================================ */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const SITE_BASE = 'https://lordshrrred.github.io/VOA_Feeder';
const SUFFIXES = ['-signal', '-shift', '-insight', '-guide'];

const args = parseArgs(process.argv.slice(2));
const keyword = String(args['keyword'] || '').trim();
const manualTitle = String(args['title'] || '').trim();
const category = String(args['category'] || 'Breaking Out').trim();
const voaUrl = String(args['voa_post_url'] || '').trim() || null;
const voaTitle = String(args['voa_post_title'] || '').trim() || null;
const providedSourceSlug = String(args['voa_post_slug'] || '').trim();
const voaLane = String(args['voa_post_lane'] || '').trim();
const voaExcerpt = String(args['voa_post_excerpt'] || '').trim();
const voaTags = String(args['voa_post_tags'] || '').trim();
const voaSourceText = String(args['voa_post_source_text'] || '').trim();

if (!manualTitle && !voaUrl) {
  console.error('Error: provide --title for manual runs or --voa_post_url for source-triggered runs.');
  process.exit(1);
}

const postsFile = path.join(process.cwd(), 'blog', 'posts.json');
const sitemapFile = path.join(process.cwd(), 'sitemap.xml');
const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
  process.exit(1);
}

main().catch(function (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
});

async function main() {
  const sourceSlug = providedSourceSlug || extractSourceSlug(voaUrl) || '';
  const sourceContext = voaUrl
    ? await fetchSourceContext(voaUrl, voaTitle, { excerpt: voaExcerpt, sourceText: voaSourceText, tags: voaTags, lane: voaLane })
    : null;
  const generation = await generateArticle({
    keyword,
    manualTitle,
    category,
    voaUrl,
    voaTitle,
    voaLane,
    voaExcerpt,
    voaTags,
    sourceSlug,
    sourceContext,
  });

  const finalTitle = ensureUniqueTitle(generation.title, voaTitle, keyword, sourceSlug);
  const targetSlug = sourceSlug
    ? buildVariationSlug(sourceSlug)
    : slugify(finalTitle);
  const outputFile = path.join(process.cwd(), 'blog', targetSlug + '.html');

  if (sourceSlug && fs.existsSync(outputFile)) {
    console.log('Existing feeder variation already present:', outputFile);
    console.log('Skipping duplicate trigger for source slug:', sourceSlug);
    process.exit(0);
  }

  const date = new Date().toISOString().split('T')[0];
  const htmlBody = ensureBacklink(generation.bodyHtml, voaUrl, voaTitle);
  const pageHtml = buildPage({
    title: finalTitle,
    slug: targetSlug,
    category,
    date,
    metaDescription: generation.metaDescription,
    bodyHtml: htmlBody,
  });

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, pageHtml, 'utf8');
  console.log('Written:', outputFile);

  updatePostsJson(postsFile, {
    slug: targetSlug,
    title: finalTitle,
    description: generation.metaDescription,
    category,
    date,
    url: `blog/${targetSlug}.html`,
  });
  console.log('Updated: blog/posts.json');

  updateSitemap(sitemapFile, targetSlug, date);
  console.log('Updated: sitemap.xml');

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    gitPush(targetSlug, finalTitle);
  } else {
    console.log('GITHUB_TOKEN not set ~ skipping git push.');
  }
}

async function generateArticle(context) {
  const systemPrompt = buildSystemPrompt(context);
  const userPrompt = buildUserPrompt(context);
  const rawContent = await callClaude(systemPrompt, userPrompt);
  return parseClaudeResponse(rawContent, context);
}

function buildSystemPrompt(context) {
  const backlinkInstruction = context.voaUrl
    ? `Include one natural backlink to ${context.voaUrl} using the anchor text "${context.voaTitle || 'Vibration of Awesome'}".`
    : 'Include one natural backlink to https://vibrationofawesome.com once in the article.';

  return [
    'You are a writer for Frequency Rising, a feeder site that supports Vibration of Awesome.',
    'Write a genuinely distinct article inspired by the source material, not a rewrite and not duplicate content.',
    'Use a fresh opening, fresh structure, fresh subheadings, and a different framing than the source article.',
    'Voice: real, direct, grounded, slightly eccentric, zero corporate fluff.',
    'Never use em dashes. Use tildes, commas, hyphens, or restructure the sentence.',
    backlinkInstruction,
    'Return EXACTLY this format with no code fences:',
    'TITLE: [unique feeder title]',
    'META: [meta description under 160 chars]',
    'BODY:',
    '[valid HTML using only <p>, <h2>, <h3>, <blockquote>, <strong>, <em>, <ul>, <ol>, <li>, <a>]',
  ].join(' ');
}

function buildUserPrompt(context) {
  const lines = [
    `Keyword: ${context.keyword || '(derive from source)'}`,
    `Category: ${context.category}`,
  ];

  if (context.manualTitle) {
    lines.push(`Preferred manual title: ${context.manualTitle}`);
  }

  if (context.voaUrl) {
    lines.push(`Source URL: ${context.voaUrl}`);
  }
  if (context.voaTitle) {
    lines.push(`Source title: ${context.voaTitle}`);
  }
  if (context.voaLane) {
    lines.push(`Source lane: ${context.voaLane}`);
  }
  if (context.voaTags) {
    lines.push(`Source tags: ${context.voaTags}`);
  }
  if (context.voaExcerpt) {
    lines.push(`Source excerpt: ${context.voaExcerpt}`);
  }
  if (context.sourceSlug) {
    lines.push(`Source slug: ${context.sourceSlug}`);
  }

  if (context.sourceContext) {
    lines.push('');
    lines.push('Source article excerpt for inspiration:');
    lines.push(context.sourceContext);
  } else if (context.manualTitle) {
    lines.push('');
    lines.push('Write a fresh long-form article for Frequency Rising based on the manual title and keyword.');
  }

  lines.push('');
  lines.push('Requirements: 900-1200 words, clear H2/H3 structure, genuinely useful, and distinct from the source article.');
  return lines.join('\n');
}

function callClaude(system, user) {
  return new Promise(function (resolve, reject) {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2600,
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
          if (parsed.error) return reject(new Error(parsed.error.message));
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

function parseClaudeResponse(raw, context) {
  const clean = stripCodeFences(raw).trim();
  const titleMatch = clean.match(/^TITLE:\s*(.+)$/mi);
  const metaMatch = clean.match(/^META:\s*(.+)$/mi);
  const bodyMatch = clean.match(/^BODY:\s*([\s\S]+)$/mi);

  const title = titleMatch
    ? titleMatch[1].trim()
    : (context.manualTitle || `A Different Angle on ${context.keyword || 'This Shift'}`);
  const metaDescription = (metaMatch ? metaMatch[1].trim() : firstSentence(stripHtml(clean))).slice(0, 160);
  const bodyHtml = bodyMatch
    ? bodyMatch[1].trim()
    : clean
        .replace(/^TITLE:\s*.+$/mi, '')
        .replace(/^META:\s*.+$/mi, '')
        .trim();

  return { title, metaDescription, bodyHtml };
}

async function fetchSourceContext(url, fallbackTitle, provided = {}) {
  const providedContext = [
    fallbackTitle ? `TITLE: ${fallbackTitle}` : '',
    provided.excerpt ? `EXCERPT: ${provided.excerpt}` : '',
    provided.tags ? `TAGS: ${provided.tags}` : '',
    provided.lane ? `LANE: ${provided.lane}` : '',
    provided.sourceText ? `BODY: ${provided.sourceText}` : '',
  ].filter(Boolean).join('\n');

  if (provided.sourceText) {
    return providedContext;
  }

  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const article = extractMainArticle(html);
    const sourceTitle = extractTitle(html) || fallbackTitle || '';
    const excerpt = stripHtml(article).replace(/\s+/g, ' ').trim().slice(0, 5000);
    return [
      sourceTitle ? `TITLE: ${sourceTitle}` : '',
      provided.excerpt ? `EXCERPT: ${provided.excerpt}` : '',
      provided.tags ? `TAGS: ${provided.tags}` : '',
      provided.lane ? `LANE: ${provided.lane}` : '',
      excerpt ? `BODY: ${excerpt}` : '',
    ].filter(Boolean).join('\n');
  } catch (err) {
    console.warn('Warning: could not fetch source article context:', err.message);
    return providedContext || (fallbackTitle ? `TITLE: ${fallbackTitle}` : '');
  }
}

function extractMainArticle(html) {
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const raw = articleMatch ? articleMatch[1] : (bodyMatch ? bodyMatch[1] : html);
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
}

function extractTitle(html) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]).trim() : '';
}

function ensureUniqueTitle(title, sourceTitle, keyword, sourceSlug) {
  const cleaned = String(title || '').trim();
  if (!cleaned) return fallbackVariationTitle(keyword, sourceTitle, sourceSlug);
  if (!sourceTitle) return cleaned;
  if (normalizeTitle(cleaned) === normalizeTitle(sourceTitle)) {
    return fallbackVariationTitle(keyword, sourceTitle, sourceSlug);
  }
  return cleaned;
}

function fallbackVariationTitle(keyword, sourceTitle, sourceSlug) {
  const topic = toTitleCase(keyword || sourceTitle || sourceSlug || 'This Shift');
  const prefixes = [
    'A Different Way to See',
    'The Hidden Side of',
    'What Changes When You Rethink',
    'The Signal Beneath'
  ];
  const hashSeed = sourceSlug || keyword || sourceTitle || topic;
  const idx = hashSeed
    ? parseInt(crypto.createHash('md5').update(hashSeed).digest('hex').slice(0, 8), 16) % prefixes.length
    : 0;
  return `${prefixes[idx]} ${topic}`;
}

function buildVariationSlug(sourceSlug) {
  return `${sourceSlug}${pickSuffix(sourceSlug)}`;
}

function pickSuffix(sourceSlug) {
  const idx = parseInt(crypto.createHash('md5').update(sourceSlug).digest('hex').slice(0, 8), 16) % SUFFIXES.length;
  return SUFFIXES[idx];
}

function extractSourceSlug(url) {
  if (!url) return '';
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '');
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    const last = parts[parts.length - 1];
    return last.replace(/\.html$/i, '');
  } catch (_) {
    return '';
  }
}

function ensureBacklink(bodyHtml, voaUrl, voaTitle) {
  if (!bodyHtml) return bodyHtml;
  if (!voaUrl) return bodyHtml;
  if (bodyHtml.includes(voaUrl)) return bodyHtml;
  const anchor = escHtml(voaTitle || 'the original Vibration of Awesome post');
  const backlink = `<p>For the full original piece, read <a href="${escAttr(voaUrl)}">${anchor}</a> on Vibration of Awesome.</p>`;
  return bodyHtml.replace(/\s+$/, '') + '\n\n' + backlink;
}

function buildPage(context) {
  const canonical = `${SITE_BASE}/blog/${context.slug}.html`;
  const displayDate = new Date(context.date + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const yr = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(context.title)} ~ Frequency Rising</title>
  <meta name="description" content="${escHtml(context.metaDescription)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escHtml(context.title)} ~ Frequency Rising">
  <meta property="og:description" content="${escHtml(context.metaDescription)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Frequency Rising">
  <meta property="article:published_time" content="${context.date}">
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
        <span class="section-label">${escHtml(context.category)}</span>
        <h1>${escHtml(context.title)}</h1>
        <div class="post-meta">
          <span class="cat">${escHtml(context.category)}</span>
          <time datetime="${context.date}">${displayDate}</time>
        </div>
        <hr class="post-divider">
        <div class="post-body">
          ${context.bodyHtml}
        </div>
      </div>
    </article>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <span class="footer-brand">Frequency Rising</span>
      <p>Independent signal for people breaking out and leveling up.</p>
      <p>A <a href="https://vibrationofawesome.com" target="_blank" rel="noopener">Vibration of Awesome</a> affiliate site.</p>
      <p>&copy; ${yr} Frequency Rising. All rights reserved.</p>
    </div>
  </footer>

</body>
</html>`;
}

function updatePostsJson(postsPath, entry) {
  const posts = fs.existsSync(postsPath)
    ? JSON.parse(fs.readFileSync(postsPath, 'utf8'))
    : [];
  const safePosts = Array.isArray(posts) ? posts : [];
  const idx = safePosts.findIndex(function (post) { return post.slug === entry.slug; });
  if (idx >= 0) safePosts[idx] = entry;
  else safePosts.unshift(entry);
  fs.writeFileSync(postsPath, JSON.stringify(safePosts, null, 2), 'utf8');
}

function updateSitemap(sitemapPath, slug, date) {
  let xml = fs.readFileSync(sitemapPath, 'utf8');
  const canonical = `${SITE_BASE}/blog/${slug}.html`;
  if (xml.includes(canonical)) return;
  const newUrl = [
    '  <url>',
    `    <loc>${canonical}</loc>`,
    `    <lastmod>${date}</lastmod>`,
    '    <changefreq>monthly</changefreq>',
    '    <priority>0.7</priority>',
    '  </url>'
  ].join('\n');
  xml = xml.replace('</urlset>', newUrl + '\n</urlset>');
  fs.writeFileSync(sitemapPath, xml, 'utf8');
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

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(text) {
  const sentence = String(text || '').match(/.+?[.!?](?:\s|$)/);
  return sentence ? sentence[0].trim() : String(text || '').trim();
}

function normalizeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function toTitleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
    .join(' ');
}

function slugify(text) {
  return String(text || '')
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

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
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
