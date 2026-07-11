# Table Tossin'

[Live App][live]

[live]: https://hamhuckin.vercel.app/

Table Tossin' (page title "Table Toss") is a browser-based physics game built with [Matter.js][matter]. Pick an object, wind up the spatula, and launch your projectile off the paddle — the goal is to land it on the table for points.

[matter]: http://brm.io/matter-js/

_[Screenshot placeholder — add gameplay image here]_

### Technologies

This game utilizes vanilla JS for all game logic and Matter.js for rendering and physics. There is no build system — the game runs by opening `index.html` directly in a browser.

## Playing

Choose a throwable — a burger, a fish, or a rubber duck — from the title screen. Each object has its own weight, friction, and bounciness, so they fly and settle differently.

To launch, pull back the spatula-shaped whacker and release:

- **Desktop:** hold the spacebar to wind the whacker back against a hidden spring, then release to fire.
- **Mobile:** tap and hold anywhere on the play area to pull back, then let go to fire.

The whacker is held, pulled back, and fired by a stack of Matter.js constraints — a fixed pivot at its left end, a soft return spring, a leveling constraint, a pullback constraint that builds tension while you hold input, and a freeze that locks it at rest between shots. Releasing removes the pullback constraint, and the stored spring tension whips the whacker forward to launch your object.

```
// when input is held, the pullback anchor is dragged left and down, building tension
document.onkeydown = function (keys) {
  if (keys.keyCode === 32 && whackerPullbackAnchor.x > 120) {
    whackerPullbackAnchor.x -= 8;
    whackerPullbackAnchor.y += 8;
  }
};

// on release, the pullback constraint is removed and the spring fires the whacker
document.onkeyup = function (keys) {
  if (keys.keyCode === 32) {
    World.remove(engine.world, whackerPullback);
    whackerPullbackAnchor.x = pullbackPosition[0];
    whackerPullbackAnchor.y = pullbackPosition[1];
  }
};
```

You get 5 shots per round. Your score is the number of objects that come to rest on the table (in the column above the landing pad) — pieces still in flight or that have fallen off don't count. Once all shots are used and everything has settled, the round ends and your score is tallied against your session high score.
