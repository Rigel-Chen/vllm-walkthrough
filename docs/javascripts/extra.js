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
  //  Bootstrap
  // ==========================================================
  function init() {
    initSmoothScroll();
    initScrollSpy();
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
