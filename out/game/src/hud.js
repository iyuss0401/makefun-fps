// The DOM HUD: crosshair, hit marker, health, ammo, timer, score, kill feed, buy menu and the
// one overlay panel. It never touches the simulation; main.js pushes numbers in.
const $ = (id) => document.getElementById(id);

export function createHud(onBuy, onPlay) {
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const buyMenu = $('buy-menu');
  const buyButtons = buyMenu.querySelectorAll('button[data-buy]');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const timer = $('timer');
  const roundLabel = $('round-label');
  const scoreT = $('score-t');
  const scoreCt = $('score-ct');
  const killFeed = $('kill-feed');
  const hitmarker = $('hitmarker');
  const bombState = $('bomb-state');
  const progressWrap = $('progress-wrap');
  const progressBar = $('progress-bar');
  const weaponName = $('weapon-name');
  let hitTimer = 0;
  let feedTimers = [];

  for (const button of buyButtons) {
    button.addEventListener('click', () => onBuy(button.dataset.buy));
  }

  return {
    setHealth(value) {
      healthValue.textContent = String(Math.max(0, Math.round(value)));
      healthBar.style.width = `${Math.max(0, value)}%`;
      healthBar.classList.toggle('low', value <= 30);
    },
    setAmmo(mag, reserve) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name) { weaponName.textContent = name; },
    setTimer(text, urgent) {
      timer.textContent = text;
      timer.classList.toggle('urgent', urgent);
    },
    setRound(text) { roundLabel.textContent = text; },
    setScore(t, ct) { scoreT.textContent = String(t); scoreCt.textContent = String(ct); },
    setMoney(amount) { $('money-value').textContent = `$${amount}`; },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.25)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    killFeed(lines) {
      killFeed.innerHTML = '';
      for (const t of feedTimers) clearTimeout(t);
      feedTimers = [];
      for (const line of lines.slice(-4)) {
        const entry = document.createElement('div');
        entry.className = 'feed-entry';
        entry.textContent = line;
        killFeed.appendChild(entry);
      }
    },
    setBomb(text, show) {
      bombState.textContent = text;
      bombState.style.display = show ? 'block' : 'none';
    },
    setProgress(show, fraction) {
      progressWrap.style.display = show ? 'block' : 'none';
      progressBar.style.width = `${Math.round(fraction * 100)}%`;
    },
    showBuy(show, money) {
      buyMenu.classList.toggle('open', show);
      if (show) {
        for (const button of buyButtons) {
          const price = Number(button.dataset.price);
          button.classList.toggle('afford', money >= price);
        }
      }
    },
    showOverlay(mode, scoreLine) {
      const copyText = {
        start: 'Breach Nine is a round-based tactical shooter. You attack with three bots: eliminate the defenders or plant the spike on the site. Click to play.',
        paused: 'Paused. Click to resume.',
        roundWin: scoreLine,
        roundLoss: scoreLine,
        matchWin: scoreLine,
        matchLoss: scoreLine,
      };
      title.textContent = {
        start: 'Breach Nine',
        paused: 'Breach Nine',
        roundWin: 'Round won',
        roundLoss: 'Round lost',
        matchWin: 'Match won',
        matchLoss: 'Match lost',
      }[mode];
      copy.textContent = copyText[mode];
      play.textContent = mode === 'start' ? 'Click to play' : 'Continue';
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
