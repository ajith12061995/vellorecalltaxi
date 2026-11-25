/* Office on a phone whose browser has "Desktop site" switched on: the browser draws the page about 980 px wide and
   ignores the page's own width setting, so the Office came up in its laptop layout, tiny, and had to be pinched and
   dragged around. This puts it back to the phone layout: the width rules in the stylesheets are re-evaluated against
   the phone's real width, and the page is scaled so one CSS pixel is one phone pixel again.
   Does nothing on a normal phone, a tablet, or a real laptop. Exposes window.VCTFIT = {on, k, real} for tests. */
(function () {
  function real() {
    try {
      var c = [screen.width, screen.height, window.outerWidth].filter(function (x) { return x > 200; });
      var sw = Math.min.apply(null, c.slice(0, 2)), ow = window.outerWidth > 200 ? window.outerWidth : sw;
      return Math.min(sw, ow);
    } catch (e) { return 0; }
  }
  function need() {
    try {
      var r = real(), touch = navigator.maxTouchPoints > 0 || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
      return touch && r > 200 && r < 520 && window.innerWidth >= 700 && window.innerWidth >= r * 1.5 ? r : 0;
    } catch (e) { return 0; }
  }
  var W = /\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/g, saved = [];
  function flip(r) {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rules; try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; rules && j < rules.length; j++) {
        var m = rules[j]; if (!m.media || !m.media.mediaText || m.__vf) continue;
        var t = m.media.mediaText; W.lastIndex = 0; if (!W.test(t) || /print/.test(t)) continue;
        // only plain width rules are rewritten: every width condition in the rule must hold at the real width
        var ok = true, rest = t.replace(W, function (_, k, v) { if (k === 'max' ? r > +v : r < +v) ok = false; return ''; }).replace(/\band\b/g, '').replace(/screen|all/g, '').trim();
        if (rest) continue;                       // mixed with something else (dark mode, motion): leave alone
        saved.push([m, t]); m.__vf = 1; m.media.mediaText = ok ? 'all' : 'not all';
      }
    }
  }
  function undo() { saved.forEach(function (s) { try { s[0].media.mediaText = s[1]; s[0].__vf = 0; } catch (e) {} }); saved = []; document.documentElement.style.zoom = ''; window.VCTFIT = { on: false, k: 1, real: 0 }; }
  function apply() {
    var r = need();
    if (!r) { if (window.VCTFIT && window.VCTFIT.on) undo(); return; }
    var k = window.innerWidth / r; if (window.VCTFIT && window.VCTFIT.on) k = window.VCTFIT.k; // innerWidth shrinks once zoomed: keep the first factor
    flip(r); document.documentElement.style.zoom = k; window.VCTFIT = { on: true, k: k, real: r };
  }
  window.VCTFIT = { on: false, k: 1, real: 0 };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('load', apply);
})();
