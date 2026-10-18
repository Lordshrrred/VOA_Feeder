#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const execute = process.argv.includes('--execute');
const index = path.join(root, 'blog/posts.json');
const posts = JSON.parse(fs.readFileSync(index));
const groups = new Map(), redirects = {};
for (const post of posts) {
  const key = String(post.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const group = groups.get(key) || []; group.push(post); groups.set(key, group);
}
for (const group of groups.values()) {
  group.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  for (const post of group.slice(1)) redirects[post.slug] = group[0].slug;
}
console.log(JSON.stringify({ execute, original: posts.length, retained: posts.length - Object.keys(redirects).length, redirects }, null, 2));
if (!execute) process.exit(0);
const archive = path.join(root, '.cache/article-consolidation', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(archive, { recursive: true });
for (const [slug, target] of Object.entries(redirects)) {
  const file = path.join(root, 'blog', slug + '.html');
  fs.copyFileSync(file, path.join(archive, slug + '.html'));
  const destination = 'https://lordshrrred.github.io/VOA_Feeder/blog/' + target + '.html';
  fs.writeFileSync(file, '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,follow"><link rel="canonical" href="' + destination + '"><meta http-equiv="refresh" content="0;url=' + destination + '"><title>Article moved</title></head><body><p>This article has moved. <a href="' + destination + '">Continue reading</a>.</p></body></html>\n');
}
fs.writeFileSync(index, JSON.stringify(posts.filter(post => !redirects[post.slug]), null, 2) + '\n');
const sitemap = path.join(root, 'sitemap.xml');
fs.writeFileSync(sitemap, fs.readFileSync(sitemap, 'utf8').replace(/\s*<url>[\s\S]*?<\/url>/g, block => Object.keys(redirects).some(slug => block.includes('/blog/' + slug + '.html</loc>')) ? '' : block));
const voaFile = path.resolve(root, '../VibrationofAwesome/static/_data/article-redirects.json');
if (!fs.existsSync(voaFile)) throw new Error('VOA consolidation map required for canonical updates');
const voa = JSON.parse(fs.readFileSync(voaFile));
for (const filename of fs.readdirSync(path.join(root, 'blog')).filter(file => file.endsWith('.html'))) {
  const file = path.join(root, 'blog', filename), html = fs.readFileSync(file, 'utf8');
  const updated = html.replace(/(https:\/\/vibrationofawesome\.com\/blog\/boom\/posts\/)([a-z0-9-]+)(\.html)?(?=["'#?<\s/]|$)/g, (all, prefix, slug) => voa[slug] ? prefix + voa[slug] : all)
    .replace(/(\/VOA_Feeder\/blog\/)([a-z0-9-]+)\.html/g, (all, prefix, slug) => redirects[slug] ? prefix + redirects[slug] + '.html' : all);
  if (updated !== html) fs.writeFileSync(file, updated);
}
