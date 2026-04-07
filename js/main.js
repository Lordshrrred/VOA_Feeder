/* ================================================
   Frequency Rising ~ main.js
   ================================================ */

(function () {
  'use strict';

  /* ---- Active nav link ---- */
  function setActiveNav() {
    const path = window.location.pathname;
    document.querySelectorAll('.nav-links a').forEach(function (link) {
      const href = link.getAttribute('href');
      if (!href) return;
      const normalized = href.replace(/^\.\.\//, '/VOA_Feeder/').replace(/^\.\//, '/VOA_Feeder/');
      if (path.endsWith(normalized) || (href === 'index.html' && (path === '/VOA_Feeder/' || path.endsWith('/index.html')))) {
        link.classList.add('active');
      }
    });
  }

  /* ---- Load recent posts on homepage ---- */
  function loadRecentPosts() {
    const container = document.getElementById('recent-posts-container');
    if (!container) return;

    fetch('blog/posts.json')
      .then(function (res) { return res.json(); })
      .then(function (posts) {
        if (!posts || posts.length === 0) {
          container.innerHTML = '<p class="signal-msg">Signal incoming. Check back soon.</p>';
          return;
        }
        const recent = posts.slice(0, 4);
        container.innerHTML = recent.map(postCard).join('');
      })
      .catch(function () {
        container.innerHTML = '<p class="signal-msg">Signal incoming. Check back soon.</p>';
      });
  }

  /* ---- Load all posts on blog index ---- */
  function loadBlogIndex() {
    const container = document.getElementById('blog-posts-container');
    if (!container) return;

    fetch('../blog/posts.json')
      .then(function (res) { return res.json(); })
      .then(function (posts) {
        if (!posts || posts.length === 0) {
          container.innerHTML = '<p class="signal-msg">Signal incoming. Check back soon.</p>';
          return;
        }
        container.innerHTML = posts.map(postCard).join('');
      })
      .catch(function () {
        container.innerHTML = '<p class="signal-msg">Signal incoming. Check back soon.</p>';
      });
  }

  /* ---- Post card template ---- */
  function postCard(post) {
    return [
      '<article class="post-item">',
      '  <div>',
      '    <span class="post-category">' + escHtml(post.category) + '</span>',
      '    <h3><a href="' + escHtml(post.url) + '">' + escHtml(post.title) + '</a></h3>',
      '    <p class="post-excerpt">' + escHtml(post.description) + '</p>',
      '  </div>',
      '  <time class="post-date" datetime="' + escHtml(post.date) + '">' + formatDate(post.date) + '</time>',
      '</article>'
    ].join('\n');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  /* ---- Init ---- */
  document.addEventListener('DOMContentLoaded', function () {
    setActiveNav();
    loadRecentPosts();
    loadBlogIndex();
  });
})();
