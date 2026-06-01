// Debug toggle: widens the table to make landing easy so the bonus-shot
// mechanic and game-over flow can be exercised quickly. Set back to false
// before committing.
var CHEAT_MODE = false;

function gameStart() {
  var TABLE_CENTER_X = 750;
  var TABLETOP_WIDTH = CHEAT_MODE ? 700 : 532;
  var LEG_INSET = 45;  // distance from tabletop edge to leg center

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
    MouseConstraint = Matter.MouseConstraint,
    Events = Matter.Events;

  var engine = Engine.create();

  var render = Render.create({
    element: document.body,
    engine: engine,
    options: {
      width: 1050,
      wireframes: CHEAT_MODE ? true : false,
      background: "url('assets/dinerandscore.png') center / cover no-repeat"
    }
  });

  // var backgroundImg = new Image();
  // backgroundImg.src = 'assets/dinerandscore.png';
  // Events.on(render, 'beforeRender', function() {
  //   if (!backgroundImg.complete || !backgroundImg.naturalWidth) return;
  //   render.context.drawImage(backgroundImg, 0, 0, 1050, 602);
  // });

  var runner = Runner.create();
    Runner.run(runner, engine);

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

  // True at boot until the title-screen click starts level 1, and again on
  // game-complete-restart. While true the engine tick early-returns.
  var pickingNew = true;

  // Level-intro splash: full-screen overlay that animates in, holds, then
  // fades out — calls onDone after the fade completes.
  var levelIntroElement    = document.getElementById('level-intro');
  var levelIntroTitle = levelIntroElement.querySelector('.level-intro-title');
  var levelIntroLabel = levelIntroElement.querySelector('.level-intro-label');
  var levelIntroImg   = levelIntroElement.querySelector('.level-intro-img');
  var levelIntroScore = levelIntroElement.querySelector('.level-intro-score');
  // `preReveal` runs while the overlay is still fully opaque, just before the
  // fade starts. That's where the caller should clear/spawn for the next level,
  // so the new state is already in place by the time the overlay fades out
  // (no flash of the previous level under a fading overlay).
  function showLevelIntro(levelIdx, scoreLine, preReveal) {
    var L = levels[levelIdx];
    levelIntroTitle.innerText = L.name;
    levelIntroLabel.innerText = L.label;
    levelIntroImg.src = L.img;
    levelIntroImg.alt = L.label;
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

  // Set up level N's state and drop the player into it. Same reset shape as
  // the game-over restart handlers, plus the per-throwable tuning seam.
  function startLevel(idx) {
    currentLevel = idx;
    var L = levels[idx];
    selectedThrowable = throwables[L.throwableKey];
    applyThrowableTuning(selectedThrowable);

    World.clear(engine.world, false);
    shotCount = 5;
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

  // Round-end branches call this with the level's contribution to total. Routes
  // to the next-level intro or to the game-complete splash after a brief hold.
  function endLevel(thisLevelScore) {
    totalScore += thisLevelScore;
    if (totalScore > window.sessionHighScore) {
      window.sessionHighScore = totalScore;
    }
    pickingNew = true;  // freeze the engine tick during the transition
    if (currentLevel < levels.length - 1) {
      setTimeout(function() {
        showLevelIntro(
          currentLevel + 1,
          'Total Score: ' + totalScore,
          function() { startLevel(currentLevel + 1); }
        );
      }, 800);
    } else {
      setTimeout(showGameComplete, 800);
    }
  }

  // Rewrite the ending-screen DOM in place for the final splash. Reuses the
  // existing restart click/touchend handlers attached to #ending-screen.
  function showGameComplete() {
    document.querySelector('.game-over-text').innerText = 'Game Complete!';
    document.querySelector('.ending-score-text').innerHTML =
      'Your score was: <div class="score-number">' + totalScore + '</div>';
    highScoreText[0].innerText = window.sessionHighScore;
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


  Engine.run(engine);
  Render.run(render);

  //
  //game functionality
  //

  //pulls back whacker on space bar press
  document.onkeydown = function (keys) {
    if (keys.keyCode !== 32) return;
    keys.preventDefault();
    if (keys.repeat) return;
    pullHeld = true;
  };
  document.onkeyup = function (keys) {
    if (keys.keyCode !== 32) return;
    keys.preventDefault();
    pullHeld = false;
  };

  var shotCount = 5;
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
    gameOverScreen.style.display = 'none';
    document.querySelector('.game-over-text').innerText = 'Game Over!';
    document.querySelector('.ending-score-text').innerHTML =
      'Your score was: <div class="score-number">0</div>';

    totalScore = 0;
    currentLevel = 0;
    showLevelIntro(0, '', function() { startLevel(0); });
  }
  gameOverScreen.addEventListener('click', restartFromGameComplete);
  gameOverScreen.addEventListener('touchend', function(e) {
    e.preventDefault();
    restartFromGameComplete();
  }, { passive: false });

  var scoreBounds = Matter.Bounds.create([
    { x: TABLE_CENTER_X - TABLETOP_WIDTH / 2, y: 0 },
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

  var lastShotTime = null;
  // null when not in bonus mode; otherwise the count of hammos that must
  // remain on-screen for the run to continue. If the count drops below this,
  // a scoring object fell off and the game ends immediately.
  var bonusPeakOnScreen = null;

  // Draw a single sprite at the parent centroid for compound (concave) hammos.
  Events.on(render, 'afterRender', function() {
    var ctx = render.context;
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
  });

  //releases hammo after reaching a specified point
  Events.on(engine, "afterUpdate", function() {
    if (gameOver) return;
    if (pickingNew) return;

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
    // For shots 1–4 we spawn the next hammo immediately.
    // For shot 5 (and bonus shots) we mark `lastShotTime`
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

    // Round-end resolution: wait at least 2.5s after the last shot landed and
    // all hammos are at rest, so `calcScore()` (speed < 2) sees the final
    // settled state. Then either award a bonus shot (if score === shotsTaken,
    // meaning nothing missed and nothing got knocked off) or end the round.
    // During bonus mode, if any hammo that was previously on the table has
    // fallen off the bottom or right of the canvas, end the game immediately
    // with the current score — don't wait for things to settle.
    if (bonusPeakOnScreen !== null) {
      var stillOnScreen = 0;
      for (var hi = 0; hi < hammos.length; hi++) {
        var hh = hammos[hi];
        if (hh.position.y <= 700 && hh.position.x <= 1050) stillOnScreen += 1;
      }
      if (stillOnScreen < bonusPeakOnScreen) {
        var liveScore = calcScore();
        gameOver = true;
        scoreNumberText[0].innerText = totalScore + liveScore;
        scoreNumberText[1].innerText = totalScore + liveScore;
        hideBonusTimer();
        endLevel(liveScore);
        return;
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
            if (ph.position.y <= 700 && ph.position.x <= 1050) bonusPeakOnScreen += 1;
          }
        }
      } else if ((Date.now() - lastShotTime > 2500) && areAllHammosDone()) {
        // First round-end evaluation: wait for everything to settle, then
        // either enter bonus mode (perfect run) or end the game.
        var settledScore = calcScore();
        if (settledScore === shotsTaken) {
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
            if (ph2.position.y <= 700 && ph2.position.x <= 1050) bonusPeakOnScreen += 1;
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

  function checkEnd() {
  }

  (function applyMobileScale() {
    var wrapper = document.getElementById('canvas-wrapper');
    var header = document.getElementById('info-nav');
    if (!wrapper) return;
    wrapper.appendChild(render.canvas);
    function scale() {
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
