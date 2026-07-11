// Debug toggle: widens the table to make landing easy so the bonus-shot
// mechanic and game-over flow can be exercised quickly. Set back to false
// before committing.
var CHEAT_MODE = false;

function gameStart() {
  var TABLE_CENTER_X = 750;
  var TABLETOP_WIDTH = CHEAT_MODE ? 700 : 532;
  var LEG_INSET = 45;  // distance from tabletop edge to leg center
  var SHOTS_PER_LEVEL = 7;
  // Scoring objects that must be on the table when the tosses run out to
  // enter bonus mode (no longer requires a perfect round).
  var BONUS_THRESHOLD = 5;

  var Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Bounds = Matter.Bounds,
    Composite = Matter.Composite,
    Composites = Matter.Composites,
    Vertices = Matter.Vertices,
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

  // Step the engine an extra time per frame so physics runs at the desired
  // "feel" (~2x). Pass the runner's current delta so the extra step matches
  // the wall-clock time the runner just simulated — without this, the extra
  // call defaults to 16.67ms regardless of platform, which makes iOS (rAF at
  // 30fps) run at ~75% speed: runner simulates 33ms then we add a fixed 16.67,
  // vs. desktop where runner simulates 16.67 then we add 16.67 (true 2x).
  // The freeze gate (`fallingHammo !== null`) skips the extra step during the
  // bonus-end zoom, complementing the Runner.stop call there.
  Events.on(runner, 'afterUpdate', function() {
    if (fallingHammo !== null) return;
    Engine.update(engine, runner.delta);
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
      img.src = src;
      spriteCache[src] = img;
    }
    return spriteCache[src];
  }

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
  var bestScores = (function() {
    try {
      return JSON.parse(window.localStorage.getItem(BEST_SCORES_KEY)) || {};
    } catch (e) {
      return {};
    }
  })();
  function recordLevelScore(levelIdx, score) {
    var key = levels[levelIdx].throwableKey;
    runScores[key] = score;
    if (!(key in bestScores) || score > bestScores[key]) {
      bestScores[key] = score;
      try {
        window.localStorage.setItem(BEST_SCORES_KEY, JSON.stringify(bestScores));
      } catch (e) {
        // localStorage unavailable — best scores live for this page load only.
      }
    }
  }

  // Bonus-end state. When a hammo crosses below the table top in bonus mode:
  //   1. Stop the Runner, draw red circle, swap render background to flat color,
  //      hide HUD so the bonus-end text is easy to read against the scene.
  //   2. After 500ms: show the bonus-end overlay text.
  //   3. Wait for user input (click/tap/spacebar) to advance to next level.
  var fallingHammo = null;
  var mobileScale = null;
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
    if (totalScore > window.sessionHighScore) {
      window.sessionHighScore = totalScore;
    }
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
    if (totalScore > window.sessionHighScore) {
      window.sessionHighScore = totalScore;
    }
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
      return;
    }
    if (awaitingNameEntry) return;
    // "Press any key to restart" on the game-complete screen. This screen
    // previously only listened for click/tap, so keys silently did nothing.
    if (gameOverScreen.style.display === 'flex') {
      e.preventDefault();
      restartFromGameComplete();
    }
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
    shotCount = SHOTS_PER_LEVEL;
    shotsTaken = 0;
    shotCountText[0].innerText = shotCount;
    shotsText[0].classList.remove('bonus');
    gameOver = false;
    allDone = false;
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
      if (totalScore > window.sessionHighScore) {
        window.sessionHighScore = totalScore;
      }
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

  // var basketVertices = Vertices.fromPath('35 7 19 17 14 38 14 58 25 79 45 85 65 84 65 66 46 67 34 59 30 44 33 29 45 23 66 23 66 7 53 7');
  //
  // var basket = Bodies.fromVertices(520, 230, basketVertices, { isStatic: true });

  var tableTop = Matter.Bodies.rectangle(TABLE_CENTER_X, 500, TABLETOP_WIDTH, 33, {
                        chamfer: { radius: [20, 20, 20, 20] },
                        render: { sprite: { texture: 'assets/tabletop.png', xScale: 1.5, yScale: 0.75}, lineWidth: 0 }
                    });
  var leftLeg = Matter.Bodies.rectangle(TABLE_CENTER_X - TABLETOP_WIDTH / 2 + LEG_INSET, 572, 20, 110, {
                        render: { sprite: { texture: 'assets/tableleg.png'}, lineWidth: 0 }
                    });
  var rightLeg = Matter.Bodies.rectangle(TABLE_CENTER_X + TABLETOP_WIDTH / 2 - LEG_INSET, 572, 20, 130, {
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

  // var horseShoe = Vertices.fromPath('100 0 75 50 100 100 25 100 0 50 25 0');
  //
  // var hammo = Bodies.fromVertices(220, 275, horseShoe);
  var hammo = spawnHammo();
  var hammos = [hammo];

  //attaches hammo to an anchor
  // var anchor = { x: 270, y: 275 };
  // var elastic = Constraint.create({
  //         pointA: anchor,
  //         bodyB: hammo,
  //         pointB: { x: 15, y: 15 },
  //         stiffness: 0.05,
  //         render: {
  //             lineWidth: 5,
  //             strokeStyle: '#dfa417'
  //         }
  //     });


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
  var shotsTaken = 0;
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
  
  // Session high score (persists until window is closed)
  if (typeof window.sessionHighScore === 'undefined') {
    window.sessionHighScore = 0;
  }

  var gameOverScreen = document.getElementById('ending-screen');

  // Restart from the game-complete screen: reset cumulative state and route
  // back to the level-1 intro. The existing ending-screen DOM is rewritten in
  // place by showGameComplete, so we restore the default game-over copy here
  // for any future use, though under the level flow this screen is only
  // shown as the game-complete splash.
  function restartFromGameComplete() {
    // While the leaderboard name form is up, clicks/keys must not restart —
    // the player finishes or skips the entry first.
    if (awaitingNameEntry) return;
    gameOverScreen.style.display = 'none';
    document.querySelector('.game-over-text').innerText = 'Game Over!';
    document.querySelector('.ending-score-text').innerHTML =
      'Your score was: <div class="score-number">0</div>';

    totalScore = 0;
    currentLevel = 0;
    runScores = {};
    showLevelIntro(0, '', function() { startLevel(0); });
  }
  gameOverScreen.addEventListener('click', restartFromGameComplete);
  gameOverScreen.addEventListener('touchend', function(e) {
    e.preventDefault();
    restartFromGameComplete();
  }, { passive: false });

  // --- Leaderboard -----------------------------------------------------------
  // The storage layer is isolated behind leaderboardLoad/leaderboardSubmit,
  // which are async (Promise-returning) even though today they only touch
  // localStorage — a hosted backend (e.g. a Vercel /api/scores function) can
  // replace their bodies with fetch() calls without changing any UI code.
  var LEADERBOARD_KEY = 'tableTossinLeaderboard';
  var PLAYER_NAME_KEY = 'tableTossinPlayerName';
  var LEADERBOARD_SIZE = 10;

  var leaderboardEntries = (function() {
    try {
      return JSON.parse(window.localStorage.getItem(LEADERBOARD_KEY)) || [];
    } catch (e) {
      return [];
    }
  })();

  function leaderboardLoad() {
    return Promise.resolve(leaderboardEntries);
  }

  function leaderboardSubmit(entry) {
    leaderboardEntries.push(entry);
    leaderboardEntries.sort(function(a, b) { return b.score - a.score; });
    leaderboardEntries = leaderboardEntries.slice(0, LEADERBOARD_SIZE);
    try {
      window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboardEntries));
    } catch (e) {
      // localStorage unavailable — leaderboard lives for this page load only.
    }
    return Promise.resolve(leaderboardEntries);
  }

  var leaderboardPanelEl = document.querySelector('.leaderboard-panel');
  var leaderboardListEl = document.querySelector('.leaderboard-list');
  var leaderboardFormEl = document.querySelector('.leaderboard-entry-form');
  var leaderboardNameInput = document.getElementById('leaderboard-name');
  var restartInstructionsEl = document.getElementById('restart-instructions');

  // True while the name-entry form is up on the game-complete screen. While
  // set, the "any key / tap to restart" paths are disabled so typing a name
  // (or tapping the input) can't restart the game.
  var awaitingNameEntry = false;

  function renderLeaderboard(entries, highlightEntry) {
    leaderboardListEl.innerHTML = '';
    if (!entries.length) {
      var empty = document.createElement('li');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No scores yet — be the first!';
      leaderboardListEl.appendChild(empty);
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
      leaderboardListEl.appendChild(li);
    }
  }

  function scoreQualifies(entries, score) {
    if (score <= 0) return false;
    if (entries.length < LEADERBOARD_SIZE) return true;
    return score > entries[entries.length - 1].score;
  }

  function closeNameEntry() {
    awaitingNameEntry = false;
    leaderboardFormEl.style.display = 'none';
    restartInstructionsEl.style.visibility = 'visible';
    leaderboardNameInput.blur();
  }

  function submitLeaderboardName() {
    if (!awaitingNameEntry) return;
    var name = leaderboardNameInput.value.replace(/\s+/g, ' ').trim().slice(0, 12) || 'ANON';
    try {
      window.localStorage.setItem(PLAYER_NAME_KEY, name);
    } catch (e) { /* prefill is best-effort */ }
    var entry = { name: name, score: totalScore, date: new Date().toISOString() };
    leaderboardSubmit(entry).then(function(entries) {
      renderLeaderboard(entries, entry);
      closeNameEntry();
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
      // Hide (not remove) the restart hint during entry so the layout is stable.
      restartInstructionsEl.style.visibility = qualifies ? 'hidden' : 'visible';
      if (qualifies) {
        try {
          leaderboardNameInput.value = window.localStorage.getItem(PLAYER_NAME_KEY) || '';
        } catch (e) { leaderboardNameInput.value = ''; }
        // Auto-focus on desktop only — on mobile it would pop the keyboard
        // over the results.
        if (!window.matchMedia('(pointer: coarse)').matches) {
          setTimeout(function() { leaderboardNameInput.focus(); }, 50);
        }
      }
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
    if (e.key === 'Enter') submitLeaderboardName();
  });

  // Extends well above the canvas top (y < 0) so a bonus stack tall enough
  // to climb past the visible area — now reachable with the zoom-out — still
  // counts every object.
  var scoreBounds = Matter.Bounds.create([
    { x: TABLE_CENTER_X - TABLETOP_WIDTH / 2, y: -1200 },
    { x: TABLE_CENTER_X + TABLETOP_WIDTH / 2, y: 480 }
  ]);

  // A hammo is "done" when it's either truly off the canvas (x > 1050 right
  // edge, or y > 700 below the floor) OR has come to rest. The earlier
  // x > 400 cutoff was wrong: it treated anything past the launcher as
  // off-screen, which made `areAllHammosDone()` return true while hammos were
  // still actively bouncing on the table — and `calcScore()` (which uses a
  // stricter speed threshold) would then undercount the stack.
  function isHammoDone(h) {
    var offScreen = h.position.x > 1050 || h.position.y > 700;
    var settled = h.speed < 0.25 && h.angularSpeed < 0.05;
    return offScreen || settled;
  }

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
  // null when not in bonus mode; otherwise the count of hammos that must
  // remain on-screen for the run to continue. If the count drops below this,
  // a scoring object fell off and the game ends immediately.
  var bonusPeakOnScreen = null;

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
      shotsTaken += 1;
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
    // settled state. Then either award a bonus shot (if score === shotsTaken,
    // meaning nothing missed and nothing got knocked off) or end the round.
    // Detect a previously-on-table hammo crossing below the table top while
    // still on the visible canvas — that's the "falling off" trigger that
    // initiates the bonus-end freeze sequence.
    if (bonusPeakOnScreen !== null) {
      for (var fi = 0; fi < hammos.length; fi++) {
        var fh = hammos[fi];
        if (fh._countedInBonus &&
            fh.position.y > 530 && fh.position.y < 602 &&
            fh.velocity.y > 0) {
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
          hammos.push(hammo);
          World.add(engine.world, hammo);
          shotCountText[0].innerText = shotCount;
          celebrateBonus();
          hideBonusTimer();
          // Re-lock the peak so the next-shot baseline includes the new hammo.
          bonusPeakOnScreen = 0;
          for (var pi = 0; pi < hammos.length; pi++) {
            var ph = hammos[pi];
            if (ph.position.y <= 700 && ph.position.x <= 1050) {
              bonusPeakOnScreen += 1;
              ph._countedInBonus = true;
            }
          }
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
          hammos.push(hammo);
          World.add(engine.world, hammo);
          shotCountText[0].innerText = shotCount;
          shotsText[0].classList.add('bonus');
          celebrateBonus();
          bonusPeakOnScreen = 0;
          for (var pi2 = 0; pi2 < hammos.length; pi2++) {
            var ph2 = hammos[pi2];
            if (ph2.position.y <= 700 && ph2.position.x <= 1050) {
              bonusPeakOnScreen += 1;
              ph2._countedInBonus = true;
            }
          }
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
      mobileScale = s;
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
