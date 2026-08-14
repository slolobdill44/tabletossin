// Debug toggle: widens the table to make landing easy so the bonus-shot
// mechanic and game-over flow can be exercised quickly. Set back to false
// before committing.
var CHEAT_MODE = false;

// Main gameplay speed multiplier. 1 = real time, 2 = the classic shipped
// feel (the engine has always been double-stepped per frame), higher =
// faster; fractional values like 2.5 work. Values below 1 are not supported
// (the runner always simulates 1x on its own). Physics AND whacker-pull
// pacing scale with this — the game loop runs once per engine step — but
// wall-clock timers (bonus shot timer, settle waits, screen transitions)
// do not.
var GAME_SPEED = 1.6;

function gameStart() {
  var TABLE_CENTER_X = 750;
  var TABLETOP_WIDTH = CHEAT_MODE ? 700 : 532;
  var LEG_INSET = 45;  // distance from tabletop edge to leg center
  var SHOTS_PER_LEVEL = 7;
  // Scoring objects that must be on the table when the tosses run out to
  // enter bonus mode (no longer requires a perfect round).
  var BONUS_THRESHOLD = 5;

  // --- Failure reporting -----------------------------------------------------
  // Several subsystems are deliberately best-effort (localStorage may be
  // blocked, the leaderboard API may be unreachable). They still degrade
  // gracefully, but every fallback is logged so a broken deploy or a corrupt
  // stored value is diagnosable instead of invisible.
  function warn(message, err) {
    if (window.console && window.console.warn) {
      window.console.warn('[Table Tossin\'] ' + message, err || '');
    }
  }
  var warnedKeys = {};
  function warnOnce(key, message, err) {
    if (warnedKeys[key]) return;
    warnedKeys[key] = true;
    warn(message, err);
  }

  // localStorage access throws outright in some privacy modes, so every read
  // and write goes through these. Writes report whether they landed; reads
  // return null both for "absent" and "unreachable".
  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      warnOnce('storage-read',
        'localStorage is unavailable — saved scores and names cannot be read', e);
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      warnOnce('storage-write',
        'localStorage write failed (' + key + ') — values live for this page load only', e);
      return false;
    }
  }
  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {
      warn('could not remove stored value ' + key, e);
    }
  }
  // Reads JSON written by a previous session. A value that is corrupt or of
  // the wrong shape is reported and dropped rather than being handed to code
  // that assumes an object/array and would fail somewhere far from the cause.
  function storageGetJson(key, isValid) {
    var raw = storageGet(key);
    if (raw === null) return null;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      warn('discarding corrupt stored value ' + key, e);
      storageRemove(key);
      return null;
    }
    if (!isValid(parsed)) {
      warn('discarding stored value ' + key + ' of unexpected shape');
      storageRemove(key);
      return null;
    }
    return parsed;
  }

  var Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Constraint = Matter.Constraint,
    Events = Matter.Events;

  var engine = Engine.create();

  // Keep the canvas background transparent so the diner artwork (and the
  // flat freeze color) can live on sibling DOM elements behind the canvas.
  // That decouples backdrop swapping from Matter's internal render plumbing.
  var render = Render.create({
    element: document.body,
    engine: engine,
    options: {
      width: 1050,
      wireframes: CHEAT_MODE ? true : false,
      background: 'transparent'
    }
  });

  var runner = Runner.create();
    Runner.run(runner, engine);

  // Step the engine extra times per frame so physics runs at GAME_SPEED x
  // wall-clock. The extra simulated time is chunked into steps no larger
  // than the runner's own delta, so integration accuracy is the same at any
  // speed (one big 3x step would behave differently from three 1x steps).
  // Everything is based on runner.delta — not a fixed 16.67ms — so the feel
  // is identical across refresh rates: on iOS (rAF at 30fps) the runner
  // simulates 33ms and the extra steps match it, where a fixed-size step
  // would run at ~75% speed.
  // The freeze gate (`fallingHammo !== null`) skips the extra steps during
  // the bonus-end zoom, complementing the Runner.stop call there.
  Events.on(runner, 'afterUpdate', function() {
    if (fallingHammo !== null) return;
    var extra = runner.delta * (GAME_SPEED - 1);
    while (extra > 0.001) {
      var step = Math.min(extra, runner.delta);
      Engine.update(engine, step);
      extra -= step;
    }
  });

  // Bonus-mode camera zoom. When the settled stack's top climbs above
  // ZOOM_START_Y, the render bounds expand — anchored at the floor and
  // horizontally centered — so the whole stack stays in frame. The diner
  // backdrop is a DOM sibling of the (transparent) canvas, so it gets a
  // matching CSS transform to stay in register with the world.
  var BASE_VIEW_W = render.options.width;
  var BASE_VIEW_H = render.options.height;
  var ZOOM_START_Y = 130;  // stack-top world y at which zoom-out begins
  var ZOOM_MAX = 2.2;
  var zoomLevel = 1;
  var bgDinerEl = document.querySelector('.canvas-bg-diner');

  function applyZoom(z) {
    zoomLevel = z;
    if (z === 1) {
      render.options.hasBounds = false;
      render.bounds.min.x = 0;
      render.bounds.min.y = 0;
      render.bounds.max.x = BASE_VIEW_W;
      render.bounds.max.y = BASE_VIEW_H;
      bgDinerEl.style.transform = '';
      return;
    }
    var viewW = BASE_VIEW_W * z;
    var viewH = BASE_VIEW_H * z;
    render.options.hasBounds = true;
    render.bounds.min.x = BASE_VIEW_W / 2 - viewW / 2;
    render.bounds.max.x = BASE_VIEW_W / 2 + viewW / 2;
    render.bounds.min.y = BASE_VIEW_H - viewH;  // keep the floor anchored
    render.bounds.max.y = BASE_VIEW_H;
    bgDinerEl.style.transformOrigin = '0 0';
    bgDinerEl.style.transform =
      'scale(' + (1 / z) + ') translate(' +
      (-render.bounds.min.x) + 'px, ' + (-render.bounds.min.y) + 'px)';
  }

  // Matter 0.11.1 resets the canvas transform before firing 'afterRender',
  // so custom overlay drawing must re-apply the view transform itself to
  // draw in world coordinates while zoomed.
  function startViewTransform(ctx) {
    ctx.save();
    if (!render.options.hasBounds) return;
    var bw = render.bounds.max.x - render.bounds.min.x;
    var bh = render.bounds.max.y - render.bounds.min.y;
    ctx.scale(BASE_VIEW_W / bw, BASE_VIEW_H / bh);
    ctx.translate(-render.bounds.min.x, -render.bounds.min.y);
  }
  function endViewTransform(ctx) {
    ctx.restore();
  }

  var throwables = {
    // ham: {
    //   label: 'Ham',
    //   width: 30,
    //   height: 90,
    //   density: 0.001,
    //   friction: 0.1,
    //   restitution: 0.1,
    //   sprite: 'assets/ham.png'
    // },
    burger: {
      label: 'Burger',
      width: 70,
      height: 55,
      density: 0.001,
      friction: 0.1,
      restitution: 0.1,
      sprite: 'assets/hamburger.png',
      // y position of whackerRestAnchor that keeps the whacker level when one
      // of these is resting on it. Heavier objects need a smaller y (anchor
      // pulled higher) to compensate for the downward sag they cause.
      restAnchorY: 321,
      // Friction applied once the shot leaves the launch area, so pieces grip
      // the table and each other for stacking. `friction` above still governs
      // the launch (the whacker only ever touches the object before then), so
      // the throw feel is untouched — tune the two independently.
      stackFriction: 0.9,
      vertices: [
        { x: -12.8, y: -27.5 }, // Top curve left
        { x:   0.0, y: -27.5 }, // Top center apex
        { x:  12.8, y: -27.5 }, // Top curve right
        { x:  26.0, y: -19.8 }, // Upper bun upper-right edge
        { x:  33.0, y:  -8.4 }, // Upper bun lower-right edge
        { x:  35.0, y:   3.8 }, // Lettuce flare right edge
        { x:  33.4, y:  11.1 }, // Lower patty right edge
        { x:  30.3, y:  24.1 }, // Bottom bun lower-right corner
        { x: -30.3, y:  24.1 }, // Bottom bun lower-left corner
        { x: -33.4, y:  11.1 }, // Lower patty left edge
        { x: -11.3, y:  11.1 }, // Tip of the melting cheese drip (center-left)
        { x: -35.0, y:   3.8 }, // Lettuce flare left edge
        { x: -33.0, y:  -8.4 }, // Upper bun lower-left edge
        { x: -26.0, y: -19.8 }  // Upper bun upper-left edge
      ]
    },
    // bowlingBall: {
    //   label: 'Bowling Ball',
    //   width: 70,
    //   height: 70,
    //   chamfer: 35,
    //   density: 0.01,
    //   friction: 0.05,
    //   restitution: 0.2,
    //   sprite: 'assets/bowling-ball.png'
    // },
    fish: {
      label: 'Fish',
      width: 90,
      height: 60,
      density: 0.0005,
      friction: 0.4,
      restitution: 0.05,
      sprite: 'assets/fish.png',
      restAnchorY: 322,
      stackFriction: 0.9,
      vertices: [
        { x:  -5.6, y: -21.1 },
        { x:   4.3, y: -21.3 },
        { x:  15.0, y: -17.6 },
        { x:  33.0, y:  -7.3 },
        { x:  41.3, y:  -6.8 },
        { x:  44.8, y:  -4.1 },
        { x:  45.0, y:   3.1 },
        { x:  41.8, y:   7.6 },
        { x:  32.1, y:   8.7 },
        { x:  15.0, y:  18.3 },
        { x:   6.6, y:  21.3 },
        { x: -12.4, y:  21.3 },
        { x: -34.0, y:  14.0 },
        { x: -45.0, y:   4.9 },
        { x: -44.5, y:  -1.4 },
        { x: -24.2, y: -16.0 }
      ]
    },
    rubberDuck: {
      label: 'Rubber Duck',
      width: 55,
      height: 55,
      density: 0.0002,
      friction: 0.05,
      restitution: 0.15,
      sprite: 'assets/rubber-duck.png',
      restAnchorY: 322,
      // A touch lower than the foods — ducks staying slightly slippery when
      // stacked keeps some of their character.
      stackFriction: 0.7,
      vertices: [
        { x:  -5.8, y: -27.5 },
        { x:   2.9, y: -26.1 },
        { x:  10.4, y: -17.8 },
        { x:  10.6, y:  -9.4 },
        { x:  21.1, y:  -7.5 },
        { x:  27.5, y:   0.2 },
        { x:  26.0, y:  19.1 },
        { x:  12.0, y:  27.5 },
        { x: -10.1, y:  27.5 },
        { x: -24.4, y:  18.1 },
        { x: -24.6, y:   9.4 },
        { x: -21.3, y:   3.7 },
        { x: -27.5, y: -10.4 },
        { x: -16.0, y: -24.5 }
      ]
    }
  };

  var selectedThrowable = throwables.burger;

  function spawnHammo() {
    var t = selectedThrowable;
    var opts = {
      angle: 0,
      density: t.density,
      friction: t.friction,
      restitution: t.restitution,
      render: { sprite: { texture: t.sprite } }
    };
    if (t.vertices) {
      var body = Bodies.fromVertices(210, 20, [t.vertices], opts);
      // Matter draws the sprite per sub-part when a concave part of a body exists.
      // Suppress that and draw the sprite once at the parent below.
      if (body.parts.length > 1) {
        body.customSprite = t.sprite;
        for (var i = 1; i < body.parts.length; i++) {
          body.parts[i].render.visible = false;
        }
      }
      return body;
    }
    if (t.chamfer) {
      opts.chamfer = { radius: t.chamfer };
    }
    return Bodies.rectangle(210, 20, t.width, t.height, opts);
  }

  var spriteCache = {};
  function getSpriteImg(src) {
    if (!spriteCache[src]) {
      var img = new Image();
      // A failed sprite load otherwise shows up only as an invisible object:
      // the custom-sprite draw skips images that never completed.
      img.onerror = function() {
        warn('sprite failed to load: ' + src + ' — its object will render blank');
      };
      img.src = src;
      spriteCache[src] = img;
    }
    return spriteCache[src];
  }

  // Warm the browser cache for all gameplay art while the player sits on the
  // title screen, so the first toss (and level transitions) don't show
  // sprite pop-in on slow connections. Matter loads its own textures, but
  // they hit the HTTP cache these primed.
  (function preloadArt() {
    var urls = ['assets/spatula.png', 'assets/tabletop.png', 'assets/tableleg.png'];
    for (var key in throwables) {
      if (throwables[key].sprite) urls.push(throwables[key].sprite);
    }
    for (var i = 0; i < urls.length; i++) {
      getSpriteImg(urls[i]);
    }
  })();

  var titleScreen = document.getElementById('title-screen');
  var shotsText = document.getElementsByClassName('shots-text');
  var scoreText = document.getElementsByClassName('score-text');

  function celebrateBonus() {
    var bonusEl = shotsText[0].querySelector('.bonus-text');
    if (!bonusEl) return;
    var bonusLabel = bonusEl.querySelector('.bonus-label');
    bonusEl.classList.remove('celebrate');
    // Force reflow so re-adding the class restarts the keyframes.
    void bonusEl.offsetWidth;
    bonusEl.classList.add('celebrate');

    // Strip .celebrate once the label animation ends so the static green
    // color rule re-asserts — otherwise the gradient/transparent fill stays.
    if (bonusLabel) {
      var onLabelDone = function(e) {
        if (e.animationName !== 'bonusRainbow') return;
        bonusEl.classList.remove('celebrate');
        bonusLabel.removeEventListener('animationend', onLabelDone);
      };
      bonusLabel.addEventListener('animationend', onLabelDone);
    }

    for (var i = 0; i < 10; i++) {
      var spark = document.createElement('span');
      spark.className = 'spark';
      var angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.3;
      var dist = 60 + Math.random() * 40;
      spark.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      spark.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      bonusEl.appendChild(spark);
      spark.addEventListener('animationend', function() { this.remove(); });
    }
  }

  // Apply a throwable's whacker tuning to the live state. Right now this only
  // touches `whackerRestAnchor.y`, but it's the single place where per-throwable
  // (and later, per-level) tuning is wired into the runtime — add new tuned
  // fields here so future levels can override them without other plumbing.
  function applyThrowableTuning(t) {
    if (typeof t.restAnchorY === 'number') {
      whackerRestAnchor.y = t.restAnchorY;
    }
  }

  // Linear progression of levels. Adding a fourth level is one entry here plus
  // a matching `throwables` entry — no other code changes.
  var levels = [
    { name: 'Level 1', label: 'Hamburger',   throwableKey: 'burger',
      img: 'assets/hamburger.png' },
    { name: 'Level 2', label: 'Fish',        throwableKey: 'fish',
      img: 'assets/fish.png' },
    { name: 'Level 3', label: 'Duck', throwableKey: 'rubberDuck',
      img: 'assets/rubber-duck.png' }
  ];
  var currentLevel = 0;
  var totalScore = 0;

  // Per-object score tracking for the game-complete breakdown. `runScores`
  // holds this run's level scores keyed by throwableKey; `bestScores` is the
  // all-time best per object, persisted to localStorage when available (falls
  // back to in-memory only, e.g. in private browsing).
  var BEST_SCORES_KEY = 'tableTossinBestScores';
  var runScores = {};
  var bestScores = storageGetJson(BEST_SCORES_KEY, function(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }) || {};
  function recordLevelScore(levelIdx, score) {
    var key = levels[levelIdx].throwableKey;
    runScores[key] = score;
    if (!(key in bestScores) || score > bestScores[key]) {
      bestScores[key] = score;
      storageSet(BEST_SCORES_KEY, JSON.stringify(bestScores));
    }
  }

  // Bonus-end state. When a hammo crosses below the table top in bonus mode:
  //   1. Stop the Runner, draw red circle, swap render background to flat color,
  //      hide HUD so the bonus-end text is easy to read against the scene.
  //   2. After 500ms: show the bonus-end overlay text.
  //   3. Wait for user input (click/tap/spacebar) to advance to next level.
  var fallingHammo = null;
  var canvasWrapper = document.getElementById('canvas-wrapper');

  // True at boot until the title-screen click starts level 1, and again on
  // game-complete-restart. While true the engine tick early-returns.
  var pickingNew = true;

  // Level-intro splash: full-screen overlay that animates in, holds, then
  // fades out — calls onDone after the fade completes.
  var levelIntroElement    = document.getElementById('level-intro');
  var levelIntroTitle      = levelIntroElement.querySelector('.level-intro-title');
  var levelIntroLabel      = levelIntroElement.querySelector('.level-intro-label');
  var levelIntroImg        = levelIntroElement.querySelector('.level-intro-img');
  var levelIntroLastScore  = levelIntroElement.querySelector('.level-intro-last-score');
  var levelIntroScore      = levelIntroElement.querySelector('.level-intro-score');
  // `preReveal` runs while the overlay is still fully opaque, just before the
  // fade starts. That's where the caller should clear/spawn for the next level,
  // so the new state is already in place by the time the overlay fades out
  // (no flash of the previous level under a fading overlay).
  function showLevelIntro(levelIdx, scoreLine, preReveal, lastLevelScore) {
    var L = levels[levelIdx];
    levelIntroTitle.innerText = L.name;
    levelIntroLabel.innerText = L.label;
    levelIntroImg.src = L.img;
    levelIntroImg.alt = L.label;
    levelIntroImg.style.display = '';
    // Between-level feedback: last level's score and the running total.
    // Both empty on the level-1 intro (no scores yet).
    levelIntroLastScore.innerText =
      (typeof lastLevelScore === 'number') ? 'Level score: ' + lastLevelScore : '';
    levelIntroScore.innerText = scoreLine || '';
    levelIntroElement.classList.remove('fading');
    // Force reflow so re-adding .active restarts the staggered text-reveal
    // keyframes (matches the celebrateBonus pattern).
    void levelIntroElement.offsetWidth;
    levelIntroElement.classList.add('active');
    setTimeout(function() {
      if (preReveal) preReveal();
      levelIntroElement.classList.add('fading');
      setTimeout(function() {
        levelIntroElement.classList.remove('active');
        levelIntroElement.classList.remove('fading');
      }, 500);
    }, 1800);
  }

  // Bonus-ended splash: reuses the level-intro overlay with swapped content.
  // Hides the image slot. Calls onDone after the fade completes.
  // Bonus-ended splash: separate overlay element from level-intro so they can
  // layer cleanly. Stays fully visible until `hideOnDone` is called from the
  // caller (it has no auto-fade) — that way the next-level intro can fade in
  // underneath while this splash is still covering, and the splash fades out
  // after the level-intro has taken over.
  var bonusEndElement = document.getElementById('bonus-end-screen');
  var bonusEndScoreEl = bonusEndElement.querySelector('.bonus-end-score');
  var bonusEndTotalEl = bonusEndElement.querySelector('.bonus-end-total');
  var roundEndElement = document.getElementById('round-end-screen');
  var roundEndScoreEl = roundEndElement.querySelector('.bonus-end-score');
  var roundEndTotalEl = roundEndElement.querySelector('.bonus-end-total');

  // True while the bonus-end overlay is up and waiting for the user to advance.
  // Used by the input handlers below to know whether a click/tap/space should
  // advance to the next level instead of doing its normal action.
  var awaitingBonusEndContinue = false;

  // Called the moment a falling hammo is detected. Shows the bonus-end
  // overlay immediately (with the zoom happening behind it), and waits for
  // the user to click/tap/press space anywhere on the screen to advance.
  function startBonusEndSequence(fh) {
    Runner.stop(runner);
    canvasWrapper.classList.add('frozen');
    // Hide HUD overlays. These have inline display:block set by startLevel, so
    // CSS rules can't override them — clear them imperatively and restore in
    // advanceFromBonusEnd.
    shotsText[0].style.display = 'none';
    scoreText[0].style.display = 'none';
    // The diner backdrop and the flat freeze color are sibling DOM elements
    // behind the (transparent) canvas. .frozen toggles which is visible via
    // CSS — no Matter render-state fighting required.
    Render.world(render);  // one final render so the red circle is drawn

    // Lock in the level score immediately (calcScore on this frame catches
    // any borderline-settled hammos correctly).
    var liveScore = calcScore();
    gameOver = true;
    scoreNumberText[0].innerText = totalScore + liveScore;
    scoreNumberText[1].innerText = totalScore + liveScore;
    hideBonusTimer();
    bonusEndPendingScore = liveScore;
    recordLevelScore(currentLevel, liveScore);

    setTimeout(function() {
      bonusEndScoreEl.innerText = 'Level score: ' + liveScore;
      bonusEndTotalEl.innerText = 'Total Score: ' + (totalScore + liveScore);
      void bonusEndElement.offsetWidth;
      bonusEndElement.classList.add('active');
      awaitingBonusEndContinue = true;
    }, 500);
  }

  // Called when the user clicks/taps/presses space while the bonus-end overlay
  // is up. Cleans up the zoom, clears the world, hides the overlay, and starts
  // the next-level intro (or game-complete if this was the last level).
  var bonusEndPendingScore = 0;
  function advanceFromBonusEnd() {
    if (!awaitingBonusEndContinue) return;
    awaitingBonusEndContinue = false;
    var liveScore = bonusEndPendingScore;

    // Hide the overlay snap-cut (no fade — user picked instant transition).
    bonusEndElement.classList.remove('active');

    fallingHammo = null;
    canvasWrapper.classList.remove('frozen');
    applyZoom(1);
    // Restore HUD overlays — startLevel will re-set display:block on the next
    // level start, but the level-intro animates over the canvas first so we
    // hide them rather than restore now to avoid a flash.
    shotsText[0].style.display = 'none';
    scoreText[0].style.display = 'none';

    // Wipe the world and resume the Runner so the next-level intro's preReveal
    // can spawn fresh state.
    World.clear(engine.world, false);
    hammos = [];
    Runner.run(runner, engine);

    totalScore += liveScore;
    updateHighScore();
    pickingNew = true;

    if (currentLevel < levels.length - 1) {
      showLevelIntro(
        currentLevel + 1,
        'Total Score: ' + totalScore,
        function() { startLevel(currentLevel + 1); },
        liveScore
      );
    } else {
      showGameComplete();
    }
  }

  // Round-end (non-bonus) overlay. Shown when a level ends without entering
  // bonus mode. Same content shape as the bonus-end overlay but fully opaque,
  // so it covers the play field instead of leaving objects visible. Like the
  // bonus-end overlay, it waits for user input to advance.
  var awaitingRoundEndContinue = false;
  var roundEndPendingScore = 0;
  function startRoundEndSequence(levelScore) {
    roundEndPendingScore = levelScore;
    roundEndScoreEl.innerText = 'Level score: ' + levelScore;
    roundEndTotalEl.innerText = 'Total Score: ' + (totalScore + levelScore);
    void roundEndElement.offsetWidth;
    roundEndElement.classList.add('active');
    awaitingRoundEndContinue = true;
  }
  
  function advanceFromRoundEnd() {
    if (!awaitingRoundEndContinue) return;
    awaitingRoundEndContinue = false;
    var liveScore = roundEndPendingScore;
    roundEndElement.classList.remove('active');

    // Same post-advance plumbing as advanceFromBonusEnd, minus the freeze
    // cleanup (this path never froze the runner).
    shotsText[0].style.display = 'none';
    scoreText[0].style.display = 'none';
    World.clear(engine.world, false);
    hammos = [];

    totalScore += liveScore;
    updateHighScore();
    pickingNew = true;

    if (currentLevel < levels.length - 1) {
      showLevelIntro(
        currentLevel + 1,
        'Total Score: ' + totalScore,
        function() { startLevel(currentLevel + 1); },
        liveScore
      );
    } else {
      showGameComplete();
    }
  }

  // Global input listeners. Any of the two end-of-round overlays advance on
  // click/tap/keypress. Spacebar is no longer required — any key works.
  function advancePending() {
    if (awaitingBonusEndContinue) advanceFromBonusEnd();
    else if (awaitingRoundEndContinue) advanceFromRoundEnd();
  }
  bonusEndElement.addEventListener('click', advancePending);
  bonusEndElement.addEventListener('touchend', function(e) {
    e.preventDefault();
    advancePending();
  }, { passive: false });
  roundEndElement.addEventListener('click', advancePending);
  roundEndElement.addEventListener('touchend', function(e) {
    e.preventDefault();
    advancePending();
  }, { passive: false });
  document.addEventListener('keydown', function(e) {
    if (e.repeat) return;
    // Let browser shortcuts (cmd/ctrl/alt combos) through untouched.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Typing in the leaderboard name field (its own keydown handler also
    // stops propagation — this is a backstop).
    if (e.target && e.target.tagName === 'INPUT') return;
    if (awaitingBonusEndContinue || awaitingRoundEndContinue) {
      // Swallow the key so the spacebar doesn't ALSO trigger a whacker
      // pullback when the next level begins.
      e.preventDefault();
      advancePending();
    }
    // The game-complete screen has no key handling: it's driven by the
    // Play Again / Main Menu buttons.
  });

  // Set up level N's state and drop the player into it. Same reset shape as
  // the game-over restart handlers, plus the per-throwable tuning seam.
  function startLevel(idx) {
    currentLevel = idx;
    var L = levels[idx];
    selectedThrowable = throwables[L.throwableKey];
    applyThrowableTuning(selectedThrowable);

    World.clear(engine.world, false);
    applyZoom(1);
    scorePops = [];
    shotCount = SHOTS_PER_LEVEL;
    shotCountText[0].innerText = shotCount;
    shotsText[0].classList.remove('bonus');
    gameOver = false;
    lastShotTime = null;
    bonusPeakOnScreen = null;
    hideBonusTimer();

    // HUD shows the running total across all levels.
    scoreNumberText[0].innerText = totalScore;
    scoreNumberText[1].innerText = totalScore;

    hammo = spawnHammo();
    hammos = [hammo];
    World.add(engine.world, [whacker, whackerPivot, whackerReturn, hammo, landingPad]);
    pullHeld = false;
    whackerReturnAnchor.x = whackerRestAnchor.x;
    whackerReturnAnchor.y = whackerRestAnchor.y;

    titleScreen.style.display = 'none';
    shotsText[0].style.display = 'block';
    scoreText[0].style.display = 'block';
    pickingNew = false;
  }

  // Round-end (non-bonus) path. For non-final levels this routes through the
  // round-end overlay, which waits for the player to press a key / tap before
  // continuing (the overlay owns the totalScore update and next-level route).
  // The FINAL level skips the round summary and goes straight to the
  // game-complete screen.
  function endLevel(thisLevelScore) {
    pickingNew = true;  // freeze the engine tick during the transition
    recordLevelScore(currentLevel, thisLevelScore);
    var isLastLevel = currentLevel >= levels.length - 1;
    setTimeout(function() {
      if (!isLastLevel) {
        startRoundEndSequence(thisLevelScore);
        return;
      }
      // Same post-level plumbing the round-end overlay would have done.
      totalScore += thisLevelScore;
      updateHighScore();
      shotsText[0].style.display = 'none';
      scoreText[0].style.display = 'none';
      World.clear(engine.world, false);
      hammos = [];
      showGameComplete();
    }, 800);
  }

  // Rewrite the ending-screen DOM in place for the final splash. Reuses the
  // existing restart click/touchend handlers attached to #ending-screen.
  function showGameComplete() {
    document.querySelector('.game-over-text').innerText = 'Game Complete!';
    document.querySelector('.ending-score-text').innerHTML =
      'Your final score was: <div class="score-number">' + totalScore + '</div>';

    // Per-object breakdown: this run's score and the all-time best for each
    // throwable, one card per level.
    var cards = '';
    for (var i = 0; i < levels.length; i++) {
      var L = levels[i];
      var run = (L.throwableKey in runScores) ? runScores[L.throwableKey] : 0;
      var best = (L.throwableKey in bestScores) ? bestScores[L.throwableKey] : 0;
      cards +=
        '<div class="breakdown-card">' +
          '<img class="breakdown-img" src="' + L.img + '" alt="' + L.label + '">' +
          '<div class="breakdown-object">' + L.label + '</div>' +
          '<div class="breakdown-run">' + run + '</div>' +
          '<div class="breakdown-best">Best: ' + best + '</div>' +
        '</div>';
    }
    document.querySelector('.ending-breakdown').innerHTML = cards;

    highScoreText[0].innerText = window.sessionHighScore;
    setUpLeaderboardPanel();
    gameOverScreen.style.display = 'flex';
  }

  // Start-game button on the title artwork: hide the title, run the level-1
  // intro, then start. The title is hidden immediately so it doesn't sit
  // visible underneath during the intro animation.
  function startGameFromTitle() {
    titleScreen.style.display = 'none';
    requestSessionToken();
    showLevelIntro(0, '', function() { startLevel(0); });
  }
  var startGameBtn = document.getElementById('start-game-btn');
  startGameBtn.addEventListener('click', startGameFromTitle);
  startGameBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    startGameFromTitle();
  }, { passive: false });

  var ground = Bodies.rectangle(400, 610, 810, 60, {
                              isStatic: true,
                            });

  // The pad's friction is high on purpose: Matter resolves a contact's
  // friction as min(bodyA, bodyB), so with the old default (0.1) the table
  // capped every landing at 0.1 no matter what the object had. At 1.0 the
  // pair is always governed by the object's own stackFriction.
  var tableTop = Matter.Bodies.rectangle(TABLE_CENTER_X, 500, TABLETOP_WIDTH, 33, {
                        friction: 1,
                        chamfer: { radius: [20, 20, 20, 20] },
                        render: { sprite: { texture: 'assets/tabletop.png', xScale: 1.5, yScale: 0.75}, lineWidth: 0 }
                    });
  var leftLeg = Matter.Bodies.rectangle(TABLE_CENTER_X - TABLETOP_WIDTH / 2 + LEG_INSET, 572, 20, 110, {
                        friction: 1,
                        render: { sprite: { texture: 'assets/tableleg.png'}, lineWidth: 0 }
                    });
  var rightLeg = Matter.Bodies.rectangle(TABLE_CENTER_X + TABLETOP_WIDTH / 2 - LEG_INSET, 572, 20, 130, {
                        friction: 1,
                        render: { sprite: { texture: 'assets/tableleg.png'}, lineWidth: 0 }
                    });
  var landingPad = Matter.Body.create({
                        parts: [tableTop, leftLeg, rightLeg],
                        isStatic: true
                    });

  var whacker = Matter.Bodies.rectangle(200, 380, 190, 40, {
                        render: {
                          sprite: {
                            texture: 'assets/spatula.png',
                            xScale: 1.2,
                            yScale: 1.2,
                            yOffset: 0.12,
                            xOffset: 0.14
                          },
                          lineWidth: 0
                        }
                    });

  var whackerAnchor = { x: 125, y: 385 };
  var whackerPivot = Constraint.create({
    pointA: whackerAnchor,
    bodyB: whacker,
    pointB: { x: -75, y: 5 },
    stiffness: 1
  });
  // Whacker is driven by a single damped spring: at rest the anchor sits at
  // whackerRestAnchor; while input is held the anchor lerps toward
  // whackerPulledAnchor. No constraints get added/removed at runtime.
  var whackerRestAnchor = { x: 325, y: 324 };
  var whackerPulledAnchor = { x: 120, y: 490 };
  var whackerReturnAnchor = { x: whackerRestAnchor.x, y: whackerRestAnchor.y };
  var whackerReturn = Constraint.create({
    pointA: whackerReturnAnchor,
    bodyB: whacker,
    pointB: { x: 75, y: 5 },
    stiffness: 0.15,
    damping: 0.02,
    length: 0,
    render: {
      lineWidth: 0.01,
      strokeStyle: '#dfa417'
    }
  });

  var hammo = spawnHammo();
  var hammos = [hammo];

  World.add(engine.world, [
    whacker,
    whackerPivot,
    whackerReturn,
    landingPad
  ]);

  var pullHeld = false;


  Render.run(render);

  //
  //game functionality
  //

  //pulls back whacker on space bar press
  document.onkeydown = function (keys) {
    if (keys.keyCode !== 32) return;
    keys.preventDefault();
    if (keys.repeat) return;
    // While an overlay owns the keyboard (round/bonus end, game complete,
    // level transitions), spacebar advances the overlay via the listener
    // above — it must not also start winding the whacker.
    if (gameOver || pickingNew ||
        awaitingBonusEndContinue || awaitingRoundEndContinue) return;
    pullHeld = true;
  };
  document.onkeyup = function (keys) {
    if (keys.keyCode !== 32) return;
    keys.preventDefault();
    pullHeld = false;
  };

  var shotCount = SHOTS_PER_LEVEL;
  var gameOver = false;
  var shotCountText = document.getElementsByClassName('shots-number');

  var scoreNumberText = document.getElementsByClassName('score-number');

  var highScoreText = document.getElementsByClassName('high-score-number');

  var bonusTimerEl = document.querySelector('.bonus-timer');
  var bonusTimerValueEl = document.querySelector('.bonus-timer-value');
  var BONUS_DELAY_MS = 2500;
  function hideBonusTimer() {
    if (bonusTimerEl) bonusTimerEl.classList.remove('active');
  }
  
  // All-time total high score, persisted like the per-object bests (falls
  // back to per-page-load only when localStorage is unavailable).
  var HIGH_SCORE_KEY = 'tableTossinHighScore';
  if (typeof window.sessionHighScore === 'undefined') {
    window.sessionHighScore = (function() {
      var raw = storageGet(HIGH_SCORE_KEY);
      if (raw === null) return 0;
      var stored = parseInt(raw, 10);
      if (!isFinite(stored) || stored < 0) {
        warn('ignoring invalid stored high score: ' + raw);
        return 0;
      }
      return stored;
    })();
  }
  function updateHighScore() {
    if (totalScore <= window.sessionHighScore) return;
    window.sessionHighScore = totalScore;
    storageSet(HIGH_SCORE_KEY, String(totalScore));
  }

  var gameOverScreen = document.getElementById('ending-screen');

  // "Play Again" on the game-complete screen: reset cumulative state and
  // route straight back to the level-1 intro.
  function restartFromGameComplete() {
    // While the leaderboard name form is up the buttons are hidden; this
    // guard is a backstop.
    if (awaitingNameEntry) return;
    gameOverScreen.style.display = 'none';

    totalScore = 0;
    currentLevel = 0;
    runScores = {};
    requestSessionToken();
    showLevelIntro(0, '', function() { startLevel(0); });
  }

  // "Main Menu": reset cumulative state and return to the title screen.
  // The world was already cleared by whichever path showed this screen, and
  // pickingNew stays true until Start Game runs startLevel(0).
  function returnToMainMenu() {
    if (awaitingNameEntry) return;
    gameOverScreen.style.display = 'none';
    totalScore = 0;
    currentLevel = 0;
    runScores = {};
    pickingNew = true;
    titleScreen.style.display = 'block';
  }

  var playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.addEventListener('click', restartFromGameComplete);
  playAgainBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    restartFromGameComplete();
  }, { passive: false });
  var mainMenuBtn = document.getElementById('main-menu-btn');
  mainMenuBtn.addEventListener('click', returnToMainMenu);
  mainMenuBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    returnToMainMenu();
  }, { passive: false });

  // --- Leaderboard -----------------------------------------------------------
  // Server-backed via the api/ serverless functions, with the original
  // localStorage leaderboard kept as the fallback whenever the API is
  // unreachable (offline, file:// local dev, backend down). The UI above only
  // ever talks to leaderboardLoad/leaderboardSubmit, both Promise-returning.
  var LEADERBOARD_KEY = 'tableTossinLeaderboard';
  var PLAYER_NAME_KEY = 'tableTossinPlayerName';
  var LEADERBOARD_SIZE = 10;
  var SCORES_API = '/api/scores';
  var SESSION_API = '/api/session';

  // Set whenever the displayed standings did not come from the server, so the
  // player is told their score only lives on this device instead of being
  // shown a local list that looks like the global one.
  var LOCAL_ONLY_NOTICE = 'Leaderboard offline — showing scores saved on this device';
  var SUBMIT_FAILED_NOTICE = 'Couldn\'t reach the leaderboard — score saved on this device only';
  var leaderboardNotice = '';

  // Rejects with a message that includes the endpoint, the HTTP status and the
  // server's own error text, so a failed leaderboard call can be diagnosed
  // from the console instead of surfacing as an anonymous fallback.
  function fetchJson(url, options) {
    return fetch(url, options).then(function(r) {
      return r.text().then(function(text) {
        var data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch (e) {
            if (r.ok) throw new Error(url + ': response was not JSON: ' + text.slice(0, 120));
          }
        }
        if (!r.ok) {
          throw new Error(url + ': HTTP ' + r.status + ' ' +
            ((data && data.error) || r.statusText || 'no error message'));
        }
        return data;
      });
    });
  }

  // One-time session token, requested at each game start and consumed by the
  // score POST. The server compares the token's age against the score for the
  // duration-vs-score bound, so it must be fetched when play begins — not at
  // submit time.
  var sessionToken = null;
  function requestSessionToken() {
    sessionToken = null;
    if (!window.fetch) {
      warnOnce('no-fetch', 'fetch() is unavailable — the leaderboard stays local-only');
      return;
    }
    fetchJson(SESSION_API, { method: 'POST' })
      .then(function(data) {
        sessionToken = (data && data.token) || null;
        if (!sessionToken) {
          warn('session endpoint returned no token — scores will only be saved locally');
        }
      })
      .catch(function(err) {
        sessionToken = null;
        warn('could not start a leaderboard session — scores will only be saved locally', err);
      });
  }

  var localEntries = storageGetJson(LEADERBOARD_KEY, Array.isArray) || [];

  function localLeaderboardSubmit(entry) {
    localEntries.push(entry);
    localEntries.sort(function(a, b) { return b.score - a.score; });
    localEntries = localEntries.slice(0, LEADERBOARD_SIZE);
    storageSet(LEADERBOARD_KEY, JSON.stringify(localEntries));
    return localEntries;
  }

  function leaderboardLoad() {
    if (!window.fetch) {
      leaderboardNotice = LOCAL_ONLY_NOTICE;
      return Promise.resolve(localEntries);
    }
    return fetchJson(SCORES_API)
      .then(function(data) {
        var entries = data && data.entries;
        if (!Array.isArray(entries)) {
          throw new Error(SCORES_API + ': response had no entries array');
        }
        leaderboardNotice = '';
        return entries;
      })
      .catch(function(err) {
        warn('could not load the leaderboard — showing local scores', err);
        leaderboardNotice = LOCAL_ONLY_NOTICE;
        return localEntries;
      });
  }

  function leaderboardSubmit(entry) {
    // Always keep the local copy current — it's what the fallback view shows.
    localLeaderboardSubmit(entry);
    if (!window.fetch || !sessionToken) {
      warn('no leaderboard session available — score saved locally only');
      leaderboardNotice = SUBMIT_FAILED_NOTICE;
      return Promise.resolve(localEntries);
    }
    var token = sessionToken;
    sessionToken = null;  // single-use; server rejects a replay anyway
    return fetchJson(SCORES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, name: entry.name, score: entry.score })
    })
      .then(function(data) {
        var entries = data && data.entries;
        if (!Array.isArray(entries)) {
          throw new Error(SCORES_API + ': submit response had no entries array');
        }
        // Swap the caller's entry object into its server row so the UI's
        // reference-equality highlight keeps working.
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].id === data.you) {
            entries[i] = entry;
            break;
          }
        }
        leaderboardNotice = '';
        return entries;
      })
      .catch(function(err) {
        warn('leaderboard submission failed — score saved locally only', err);
        leaderboardNotice = SUBMIT_FAILED_NOTICE;
        return localEntries;
      });
  }

  // Scoped to #ending-screen: the title-screen overlay has its own
  // .leaderboard-panel / .leaderboard-list earlier in the document, so an
  // unscoped selector matches that one instead.
  var leaderboardPanelEl = document.querySelector('#ending-screen .leaderboard-panel');
  var leaderboardListEl = document.querySelector('#ending-screen .leaderboard-list');
  var leaderboardFormEl = document.querySelector('.leaderboard-entry-form');
  var leaderboardNameInput = document.getElementById('leaderboard-name');
  var endingButtonsEl = document.querySelector('.ending-buttons');

  // True while the name-entry form is up on the game-complete screen. While
  // set, the Play Again / Main Menu buttons are hidden so the player
  // finishes (or skips) the entry first.
  var awaitingNameEntry = false;

  function renderLeaderboard(entries, highlightEntry, listEl) {
    listEl = listEl || leaderboardListEl;
    listEl.innerHTML = '';
    if (!entries.length) {
      var empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No scores yet — be the first!';
      listEl.appendChild(empty);
      appendLeaderboardNotice(listEl);
      return;
    }
    for (var i = 0; i < entries.length; i++) {
      var li = document.createElement('li');
      if (entries[i] === highlightEntry) li.className = 'leaderboard-you';
      var rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = i + 1;
      var name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = entries[i].name;
      var score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = entries[i].score;
      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      listEl.appendChild(li);
    }
    appendLeaderboardNotice(listEl);
  }

  function appendLeaderboardNotice(listEl) {
    if (!leaderboardNotice) return;
    var note = document.createElement('li');
    note.className = 'leaderboard-note';
    note.textContent = leaderboardNotice;
    listEl.appendChild(note);
  }

  function scoreQualifies(entries, score) {
    if (score <= 0) return false;
    if (entries.length < LEADERBOARD_SIZE) return true;
    return score > entries[entries.length - 1].score;
  }

  function closeNameEntry() {
    awaitingNameEntry = false;
    leaderboardFormEl.style.display = 'none';
    endingButtonsEl.style.visibility = 'visible';
    leaderboardNameInput.blur();
  }

  function submitLeaderboardName() {
    if (!awaitingNameEntry) return;
    // Arcade-style initials: letters/digits only, uppercased, max 3.
    // The server applies the same normalization plus a denylist.
    var name = leaderboardNameInput.value
      .replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3) || 'AAA';
    storageSet(PLAYER_NAME_KEY, name);
    var entry = { name: name, score: totalScore, date: new Date().toISOString() };
    // Close synchronously BEFORE the async submit: a double-click on Save or
    // a held Enter must not run this twice (the server is token-safe, but the
    // local fallback list would get duplicate rows).
    closeNameEntry();
    leaderboardSubmit(entry).then(function(entries) {
      renderLeaderboard(entries, entry);
    }).catch(function(err) {
      // leaderboardSubmit resolves even when the API fails, so getting here
      // means rendering itself broke — never let that vanish.
      warn('could not render the leaderboard after submitting', err);
    });
  }

  // Called from showGameComplete: render the current standings and, if this
  // run's total makes the cut, show the name-entry form.
  function setUpLeaderboardPanel() {
    leaderboardLoad().then(function(entries) {
      renderLeaderboard(entries, null);
      var qualifies = scoreQualifies(entries, totalScore);
      awaitingNameEntry = qualifies;
      leaderboardFormEl.style.display = qualifies ? 'block' : 'none';
      // Hide (not remove) the buttons during entry so the layout is stable.
      endingButtonsEl.style.visibility = qualifies ? 'hidden' : 'visible';
      if (qualifies) {
        leaderboardNameInput.value = storageGet(PLAYER_NAME_KEY) || '';
        // Auto-focus on desktop only — on mobile it would pop the keyboard
        // over the results.
        if (!window.matchMedia('(pointer: coarse)').matches) {
          setTimeout(function() { leaderboardNameInput.focus(); }, 50);
        }
      }
    }).catch(function(err) {
      // The Play Again / Main Menu buttons are hidden while name entry is up,
      // so a failure here would otherwise strand the player on a dead screen.
      warn('leaderboard panel setup failed — skipping name entry', err);
      awaitingNameEntry = false;
      leaderboardFormEl.style.display = 'none';
      endingButtonsEl.style.visibility = 'visible';
    });
  }

  // Clicks/taps inside the panel must not bubble to the ending screen's
  // restart handlers (touchend deliberately does NOT preventDefault, so the
  // browser still synthesizes clicks for the input focus and the buttons).
  leaderboardPanelEl.addEventListener('click', function(e) { e.stopPropagation(); });
  leaderboardPanelEl.addEventListener('touchend', function(e) { e.stopPropagation(); });
  document.getElementById('leaderboard-save').addEventListener('click', submitLeaderboardName);
  document.getElementById('leaderboard-skip').addEventListener('click', closeNameEntry);
  leaderboardNameInput.addEventListener('keydown', function(e) {
    // Keep typing away from the document-level "any key" handlers.
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Enter') submitLeaderboardName();
  });

  // Title-screen leaderboard viewer: same renderer and leaderboardLoad() as
  // the ending-screen panel, in its own overlay on top of the title art.
  var titleLbOverlay = document.getElementById('title-leaderboard');
  var titleLbList = document.getElementById('title-leaderboard-list');
  function openTitleLeaderboard() {
    titleLbOverlay.classList.add('active');
    leaderboardLoad().then(function(entries) {
      renderLeaderboard(entries, null, titleLbList);
    }).catch(function(err) {
      warn('could not render the title-screen leaderboard', err);
    });
  }
  function closeTitleLeaderboard() {
    titleLbOverlay.classList.remove('active');
  }
  var titleLbBtn = document.getElementById('title-leaderboard-btn');
  titleLbBtn.addEventListener('click', openTitleLeaderboard);
  titleLbBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    openTitleLeaderboard();
  }, { passive: false });
  var titleLbClose = document.getElementById('title-leaderboard-close');
  titleLbClose.addEventListener('click', closeTitleLeaderboard);
  titleLbClose.addEventListener('touchend', function(e) {
    e.preventDefault();
    closeTitleLeaderboard();
  }, { passive: false });
  // Clicking the dimmed backdrop (but not the panel) also closes.
  titleLbOverlay.addEventListener('click', function(e) {
    if (e.target === titleLbOverlay) closeTitleLeaderboard();
  });

  // Extends well above the canvas top (y < 0) so a bonus stack tall enough
  // to climb past the visible area — now reachable with the zoom-out — still
  // counts every object.
  var scoreBounds = Matter.Bounds.create([
    { x: TABLE_CENTER_X - TABLETOP_WIDTH / 2, y: -1200 },
    { x: TABLE_CENTER_X + TABLETOP_WIDTH / 2, y: 480 }
  ]);

  // Uses the same speed threshold as `calcScore()` so the two functions agree:
  // when `areAllHammosDone()` is true, `calcScore()` is guaranteed to count
  // every hammo currently inside `scoreBounds`. Tighter thresholds (< 0.01)
  // were never satisfied in practice because stacked bodies micro-jitter.
  function areAllHammosDone() {
    return hammos.every(function(h) {
      var offScreen = h.position.x > 1050 || h.position.y > 700;
      var settled = h.speed < 2 && h.angularSpeed < 0.2;
      return offScreen || settled;
    });
  }

  function calcScore() {
    var inBounds = Matter.Query.region(hammos, scoreBounds, false);
    return inBounds.filter(function(h) {
      return h.position.y <= 700 && h.speed < 2;
    }).length;
  }

  // Swap a shot to its throwable's stacking friction the moment it leaves
  // the launch area (nothing can reach the table without crossing that
  // line, and the whacker can no longer touch it). frictionStatic gets a
  // bump too so resting pieces resist starting to slide. Compound bodies
  // collide via their parts, so every part gets the new values.
  function applyStackFriction(h) {
    var f = selectedThrowable.stackFriction;
    if (typeof f !== 'number') return;
    for (var i = 0; i < h.parts.length; i++) {
      h.parts[i].friction = f;
      h.parts[i].frictionStatic = 1;
    }
  }

  // Highest point (smallest y) of the settled stack in the table column, or
  // null if nothing qualifies. Fast-moving hammos are excluded so an in-flight
  // toss arcing overhead doesn't yank the camera out.
  function getStackTopY() {
    var top = null;
    for (var i = 0; i < hammos.length; i++) {
      var h = hammos[i];
      if (h.position.y > 700 || h.position.x > 1050) continue;
      if (h.position.x < scoreBounds.min.x || h.position.x > scoreBounds.max.x) continue;
      if (h.speed >= 2.5) continue;
      if (top === null || h.bounds.min.y < top) top = h.bounds.min.y;
    }
    return top;
  }

  var lastShotTime = null;
  // null when not in bonus mode; otherwise the count of pieces locked into
  // the bonus baseline. Kept as the bonus-mode flag; the per-piece
  // `_countedInBonus` tags drive the fall detection.
  var bonusPeakOnScreen = null;

  // (Re)lock the bonus baseline: tag every piece that is actually ON the
  // table — inside the score column AND above the tabletop (y < 500). Floor
  // debris from pre-bonus missed shots (resting at y ≈ 545-565, inside the
  // falling band, with jittering velocity) stays untagged so it can't trip
  // the fall detector. Bonus shots are tagged `_bonusShot` at spawn instead:
  // a tagged piece falling off OR a bonus shot missing the table ends the
  // bonus.
  function lockBonusBaseline() {
    bonusPeakOnScreen = 0;
    for (var i = 0; i < hammos.length; i++) {
      var h = hammos[i];
      if (h.position.y < 500 &&
          h.position.x >= scoreBounds.min.x &&
          h.position.x <= scoreBounds.max.x) {
        bonusPeakOnScreen += 1;
        h._countedInBonus = true;
      }
    }
  }

  // Draw a single sprite at the parent centroid for compound (concave) hammos.
  // Wrapped in the view transform so sprites stay glued to their bodies while
  // the bonus zoom-out is active.
  Events.on(render, 'afterRender', function() {
    var ctx = render.context;
    startViewTransform(ctx);
    for (var i = 0; i < hammos.length; i++) {
      var h = hammos[i];
      if (!h.customSprite) continue;
      var img = getSpriteImg(h.customSprite);
      if (!img.complete || !img.naturalWidth) continue;
      ctx.save();
      ctx.translate(h.position.x, h.position.y);
      ctx.rotate(h.angle);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    }
    endViewTransform(ctx);
  });

  // Floating score pops: a light green +1 when a piece settles in the score
  // column, a light red -1 when a previously-scoring piece falls off the
  // table. Drawn on the canvas in world coordinates so they track the bonus
  // zoom, and aged by wall clock so they keep animating during the bonus-end
  // freeze (the render loop keeps running while the engine stops).
  var scorePops = [];
  var SCORE_POP_LIFE_MS = 1100;
  var SCORE_POP_MAX_ALPHA = 0.75;  // "slightly opaque" by design
  var SCORE_POP_SETTLE_TICKS = 30; // consecutive settled ticks before +1 fires
  function spawnScorePop(x, y, text, fill, stroke) {
    scorePops.push({ x: x, y: y, text: text, fill: fill, stroke: stroke, born: Date.now() });
  }
  Events.on(render, 'afterRender', function() {
    if (!scorePops.length) return;
    var now = Date.now();
    var ctx = render.context;
    startViewTransform(ctx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '36px "Bungee Inline", cursive';
    for (var i = scorePops.length - 1; i >= 0; i--) {
      var p = scorePops[i];
      var t = (now - p.born) / SCORE_POP_LIFE_MS;
      if (t >= 1) {
        scorePops.splice(i, 1);
        continue;
      }
      // Gradient in over the first 20%, hold, gradient out over the last 40%.
      var alpha = SCORE_POP_MAX_ALPHA *
        (t < 0.2 ? t / 0.2 : t > 0.6 ? (1 - t) / 0.4 : 1);
      var rise = 46 * (1 - Math.pow(1 - t, 2));  // ease-out float upward
      // Squash-pop on entry: swells to ~1.25x then settles back to 1.
      var scale = t < 1 / 3 ? 1 + 0.25 * Math.sin(t * 3 * Math.PI) : 1;
      ctx.save();
      ctx.translate(p.x, p.y - rise);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 5;
      ctx.strokeStyle = p.stroke;
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.fill;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
    endViewTransform(ctx);
  });

  // Red circle around the falling hammo during the bonus-end freeze.
  Events.on(render, 'afterRender', function() {
    if (!fallingHammo) return;
    var ctx = render.context;
    startViewTransform(ctx);
    var b = fallingHammo.bounds;
    var hw = (b.max.x - b.min.x) / 2;
    var hh = (b.max.y - b.min.y) / 2;
    var r = Math.max(hw, hh) * 1.5;
    ctx.strokeStyle = '#FF2A2A';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(fallingHammo.position.x, fallingHammo.position.y, r, 0, Math.PI * 2);
    ctx.stroke();
    endViewTransform(ctx);
  });


  //releases hammo after reaching a specified point
  Events.on(engine, "afterUpdate", function() {
    if (gameOver) return;
    if (pickingNew) return;

    // The bonus-end freeze sequence (zoom + circle + splash) runs entirely
    // via setTimeouts kicked off when the falling hammo is detected. While
    // fallingHammo is non-null the Runner is stopped, so this afterUpdate
    // event doesn't even fire — this check is here only as a safety guard.
    if (fallingHammo !== null) return;

    // Drive the single whacker spring's anchor.
    // NOTE: tweak these values to change the "feel" of the whacker pull and release.
    if (pullHeld) {
      whackerReturnAnchor.x += (whackerPulledAnchor.x - whackerReturnAnchor.x) * 0.017;
      whackerReturnAnchor.y += (whackerPulledAnchor.y - whackerReturnAnchor.y) * 0.017;
    } else {
      whackerReturnAnchor.x = whackerRestAnchor.x;
      whackerReturnAnchor.y = whackerRestAnchor.y;
    }

    // Clamp the whacker's upward rotation. Without this, a strong fire can
    // carry the body past level into an equilibrium where the spring is too
    // weak to pull it back, leaving it stuck angled up. Two-stage:
    //  - Within `softZone` of the cap: bleed angular velocity so the body
    //    decelerates before hitting the cap (no visible "tick" at the wall).
    //  - At/past the cap: hard-stop position and zero upward velocity.
    var maxUpAngle = -0.21;     // ~-12°, the hard ceiling
    var softZone   = 0.08;      // ~4.5°: start braking this far before the cap
    if (whacker.angle < maxUpAngle + softZone && whacker.angularVelocity < 0) {
      Matter.Body.setAngularVelocity(whacker, whacker.angularVelocity * 0.5);
    }
    if (whacker.angle < maxUpAngle) {
      Matter.Body.setAngle(whacker, maxUpAngle);
      if (whacker.angularVelocity < 0) {
        Matter.Body.setAngularVelocity(whacker, 0);
      }
    }

    var hammoX = hammo.position.x;
    var hammoY = hammo.position.y;

    // Count each shot the moment its hammo crosses out of the launch area.
    // For all but the final shot we spawn the next hammo immediately.
    // For the last shot (and bonus shots) we mark `lastShotTime`
    // and let the deferred "everything settled" branch below decide whether
    // to award a bonus shot or end the round, once the stack has stopped
    // wobbling enough for `calcScore()` to give a stable read.
    var leftLaunchArea = hammoX > 400 || hammoY > 500;
    if (leftLaunchArea && hammo._counted !== true) {
      hammo._counted = true;
      applyStackFriction(hammo);
      shotCount -= 1;
      shotCountText[0].innerText = shotCount;

      if (shotCount > 0) {
        hammo = spawnHammo();
        hammos.push(hammo);
        World.add(engine.world, hammo);
      } else {
        lastShotTime = Date.now();
      }
    }

    var score = calcScore();
    scoreNumberText[0].innerText = totalScore + score;
    scoreNumberText[1].innerText = totalScore + score;

    // Score pops. +1 fires once a piece has met the scoring criteria (same
    // test as calcScore) for SCORE_POP_SETTLE_TICKS consecutive ticks, so a
    // bounce that momentarily dips under the speed threshold doesn't pop.
    // -1 fires when a piece that scored drops below the tabletop (y > 520 is
    // unreachable while legitimately on the table) — position-based, so a
    // piece merely wobbling fast doesn't flicker between states. A fallen
    // piece can re-earn its +1 only by getting back into the column, which
    // keeps the pops net-consistent with the live score.
    for (var si = 0; si < hammos.length; si++) {
      var sh = hammos[si];
      if (!sh._scored) {
        var scoring = sh.position.y <= 700 && sh.speed < 2 &&
          Matter.Bounds.overlaps(sh.bounds, scoreBounds);
        if (scoring) {
          sh._scoreTicks = (sh._scoreTicks || 0) + 1;
          if (sh._scoreTicks >= SCORE_POP_SETTLE_TICKS) {
            sh._scored = true;
            spawnScorePop(sh.position.x, sh.bounds.min.y - 12, '+1', '#9CF29C', '#1f7a33');
          }
        } else {
          sh._scoreTicks = 0;
        }
      } else if (sh.position.y > 520) {
        sh._scored = false;
        sh._scoreTicks = 0;
        spawnScorePop(sh.position.x, sh.position.y - 30, '-1', '#FFA5A0', '#7e1f1c');
      }
    }

    // Bonus-mode zoom-out: ease the camera toward whatever zoom keeps the
    // stack top in frame (with ZOOM_START_Y px of headroom above it).
    var targetZoom = 1;
    if (bonusPeakOnScreen !== null) {
      var stackTop = getStackTopY();
      if (stackTop !== null) {
        targetZoom = Math.min(ZOOM_MAX,
          Math.max(1, (BASE_VIEW_H - stackTop + ZOOM_START_Y) / BASE_VIEW_H));
      }
    }
    if (targetZoom !== zoomLevel) {
      var z = zoomLevel + (targetZoom - zoomLevel) * 0.08;
      if (Math.abs(z - targetZoom) < 0.002) z = targetZoom;
      applyZoom(z);
    }

    // Round-end resolution: wait at least 2.5s after the last shot landed and
    // all hammos are at rest, so `calcScore()` (speed < 2) sees the final
    // settled state. Then either enter bonus mode (score >= BONUS_THRESHOLD)
    // or end the level.
    // Detect a hammo crossing below the table top — that's the "falling off"
    // trigger that initiates the bonus-end freeze sequence. Two ways in:
    // a previously-on-table piece (_countedInBonus) getting knocked off, or
    // a bonus shot (_bonusShot) missing the table. Pre-bonus floor debris
    // carries neither tag, so it still can't trip the detector.
    if (bonusPeakOnScreen !== null) {
      for (var fi = 0; fi < hammos.length; fi++) {
        var fh = hammos[fi];
        // velocity.y > 1 (not > 0): resting bodies' velocities jitter around
        // zero every frame, and a piece genuinely falling from table height
        // is well past 1 by the time it enters the band. Bonus shots can only
        // reach the floor by falling through the band at speed, so they
        // trigger on the way down and never sit there jittering untripped.
        if ((fh._countedInBonus || fh._bonusShot) &&
            fh.position.y > 530 && fh.position.y < 602 &&
            fh.velocity.y > 1) {
          fallingHammo = fh;
          startBonusEndSequence(fh);
          return;
        }
      }
    }

    if (shotCount === 0 && lastShotTime) {
      if (bonusPeakOnScreen !== null) {
        // Already in bonus mode: award the next shot purely on a timer, so the
        // player has to shoot as fast as they can before any object falls off.
        var elapsed = Date.now() - lastShotTime;
        var remaining = Math.max(0, BONUS_DELAY_MS - elapsed) / 1000;
        if (bonusTimerEl && bonusTimerValueEl && elapsed >= 500) {
          bonusTimerValueEl.innerText = remaining.toFixed(2);
          bonusTimerEl.classList.add('active');
        }
        if (elapsed >= BONUS_DELAY_MS) {
          shotCount = 1;
          lastShotTime = null;
          hammo = spawnHammo();
          hammo._bonusShot = true;
          hammos.push(hammo);
          World.add(engine.world, hammo);
          shotCountText[0].innerText = shotCount;
          celebrateBonus();
          hideBonusTimer();
          // Re-lock so pieces that landed since the last award are covered.
          lockBonusBaseline();
        }
      } else if ((Date.now() - lastShotTime > 2500) && areAllHammosDone()) {
        // First round-end evaluation: wait for everything to settle, then
        // either enter bonus mode (BONUS_THRESHOLD+ objects scoring) or end
        // the level.
        var settledScore = calcScore();
        if (settledScore >= BONUS_THRESHOLD) {
          shotCount = 1;
          lastShotTime = null;
          hammo = spawnHammo();
          hammo._bonusShot = true;
          hammos.push(hammo);
          World.add(engine.world, hammo);
          shotCountText[0].innerText = shotCount;
          shotsText[0].classList.add('bonus');
          celebrateBonus();
          lockBonusBaseline();
        } else {
          gameOver = true;
          scoreNumberText[0].innerText = totalScore + settledScore;
          scoreNumberText[1].innerText = totalScore + settledScore;
          endLevel(settledScore);
        }
      }
    }
  });

  (function applyMobileScale() {
    var wrapper = document.getElementById('canvas-wrapper');
    var header = document.getElementById('info-nav');
    if (!wrapper) return;
    wrapper.appendChild(render.canvas);
    function scale() {
      // Don't clobber the freeze zoom transform if a freeze is currently active.
      if (fallingHammo) return;
      var headerH = (header && header.offsetHeight) || 0;
      var sW = window.innerWidth / 1050;
      var sH = (window.innerHeight - headerH) / 602;
      var s = Math.min(sW, sH, 1);
      wrapper.style.transform = 'scale(' + s + ')';
      wrapper.style.height = (602 * s) + 'px';
      if (s < 1) {
        var leftover = Math.max(window.innerWidth - 1050 * s, 0);
        wrapper.style.marginLeft = (leftover / 2) + 'px';
      } else {
        wrapper.style.marginLeft = '';
      }
    }
    scale();
    window.addEventListener('resize', scale);
    window.addEventListener('orientationchange', scale);

    // Add touch handlers to wrapper for mobile responsiveness
    if (window.matchMedia('(pointer: coarse)').matches) {
      wrapper.addEventListener('touchstart', function(e) {
        e.preventDefault();
        pullHeld = true;
      }, { passive: false });
      wrapper.addEventListener('touchend', function(e) {
        e.preventDefault();
        pullHeld = false;
      }, { passive: false });
    }
  })();

}
