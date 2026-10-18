const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

for (const cached of [true, false]) test(cached ? 'existing companion skips generation and all network' : 'retired source skips generation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feeder-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'blog'));
  const slug = 'source-article';
  const suffix = ['-signal', '-shift', '-insight', '-guide'][parseInt(crypto.createHash('md5').update(slug).digest('hex').slice(0, 8), 16) % 4];
  if (cached) fs.writeFileSync(path.join(root, 'blog', slug + suffix + '.html'), '<p>Existing article https://vibrationofawesome.com/blog/boom/posts/source-article</p>');
  const preload = path.join(root, 'deny-network.cjs');
  fs.writeFileSync(preload, "require('node:https').request=()=>{throw Error('Paid API call must not happen')};global.fetch=" + (cached ? "()=>{throw Error('Network must not happen')}" : "async()=>({ok:true,json:async()=>({'source-article':'original'})})") + ';');
  const run = spawnSync(process.execPath, ['--require', preload, path.join(__dirname, 'generate-post.js'), '--voa_post_url', 'https://vibrationofawesome.com/blog/boom/posts/' + slug, '--voa_post_slug', slug, '--voa_post_lane', 'boom'], { cwd: root, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: 'offline-test', VOA_FEEDER_TRIGGER_TOKEN: '' } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, cached ? /Existing feeder variation/ : /Retired source article/);
});
