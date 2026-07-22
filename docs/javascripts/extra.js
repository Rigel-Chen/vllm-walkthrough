// ============================================================
//  KV Cache Architecture — Interactive Flowchart Navigation
// ============================================================

(function() {
  // ==========================================================
  //  1. Smooth Scroll — click any .fc-card[href] scrolls to target
  // ==========================================================
  function initSmoothScroll() {
    document.addEventListener('click', function(e) {
      var card = e.target.closest('a.fc-card');
      if (!card) return;
      var href = card.getAttribute('href');
      if (!href || href.charAt(0) !== '#') return;

      var target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (history.pushState) {
        history.pushState(null, null, href);
      }
    });
  }

  // ==========================================================
  //  2. Scroll Spy — highlight active .fc-card based on viewport
  // ==========================================================
  function initScrollSpy() {
    if (!window.IntersectionObserver) return;

    // Collect all cards that have href="#" and their targets
    var cards = document.querySelectorAll('a.fc-card[href^="#"]');
    if (cards.length === 0) return;

    // Build map: href -> card element
    var cardMap = {};
    cards.forEach(function(card) {
      var href = card.getAttribute('href');
      if (href) cardMap[href] = card;
    });

    // Find targets
    var targets = [];
    Object.keys(cardMap).forEach(function(href) {
      var el = document.querySelector(href);
      if (el) targets.push(el);
    });
    if (targets.length === 0) return;

    var observer = new IntersectionObserver(function(entries) {
      var bestTarget = null;
      var bestRatio = 0;

      entries.forEach(function(entry) {
        if (entry.isIntersecting && entry.intersectionRatio > bestRatio) {
          bestRatio = entry.intersectionRatio;
          bestTarget = entry.target;
        }
      });

      // Remove active from all
      cards.forEach(function(c) { c.classList.remove('active'); });

      // Add active to the card pointing to best target
      if (bestTarget) {
        var href = '#' + bestTarget.id;
        if (cardMap[href]) {
          cardMap[href].classList.add('active');
        }
      }
    }, {
      threshold: [0, 0.25, 0.5, 0.75],
      rootMargin: '-80px 0px -40% 0px'
    });

    targets.forEach(function(t) { observer.observe(t); });
  }

  // ==========================================================
  //  3. Accessibility — ARIA semantics for flowcharts
  // ==========================================================
  function initAccessibility() {
    // 3a. Decorative arrows: add aria-hidden so screen readers skip them
    var arrows = document.querySelectorAll('.fc-arr-d, .fc-arr-r, .fc-arr-l');
    arrows.forEach(function(el) { el.setAttribute('aria-hidden', 'true'); });

    // 3b. Flowchart containers: add role="figure" + aria-label
    var flowcharts = document.querySelectorAll('.fc');
    flowcharts.forEach(function(fc, i) {
      if (fc.hasAttribute('role')) return; // already annotated
      fc.setAttribute('role', 'figure');
      // Derive a label from the closest preceding heading
      var label = '';
      var prev = fc.previousElementSibling;
      while (prev) {
        var h = prev.querySelector('h2, h3, h4');
        if (h) { label = h.textContent.trim(); break; }
        if (prev.tagName && /^H[2-4]$/.test(prev.tagName)) {
          label = prev.textContent.trim(); break;
        }
        prev = prev.previousElementSibling;
      }
      var section = fc.closest('[id]');
      if (!label && section) {
        // Try the nearest section heading
        var sh = section.querySelector('h2, h3, h4');
        if (sh) label = sh.textContent.trim();
      }
      fc.setAttribute('aria-label', label || ('流程图 ' + (i + 1)));
    });

    // 3c. Decision nodes: mark as complementary
    var decisions = document.querySelectorAll('.fc-decision');
    decisions.forEach(function(el) {
      el.setAttribute('role', 'note');
      el.setAttribute('aria-label', '决策节点: ' + (el.textContent || '').trim().slice(0, 40));
    });
  }

  // ==========================================================
  //  Bootstrap
  // ==========================================================
  function init() {
    initSmoothScroll();
    initScrollSpy();
    initAccessibility();
  }

  if (typeof document$ !== 'undefined' && document$.subscribe) {
    var done = false;
    document$.subscribe(function() {
      if (!done) { init(); done = true; }
    });
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
})();
