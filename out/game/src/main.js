// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// main.js owns the match state machine (buy, live, planted, round end, match end), the local
// player's combat, and every piece of glue; the modules each own one job.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, ATTACKER_SPAWNS, DEFENDER_SPAWNS, PLANT_ZONE } from './world.js';
import { createInput } from './input.js';
import { createMover } from './mover.js';
import { createWeapon, WEAPONS, GRENADES } from './weapons.js';
import { createBot, createBotBrain, killBot, reviveBot } from './bots.js';
import { createEffects, createGrenadePool } from './effects.js';
import { audio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 115;
const BOMB_TIME = 40;
const PLANT_TIME = 3.2;
const ROUND_END_HOLD = 4.5;
const WIN_ROUNDS = 5;
const START_MONEY = 800;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1400;
const LOSS_STREAK_BONUS = 500;
const PLANT_REWARD = 300;
const MAX_GRENADES = 2;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#1a2530'), 34, 90);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const SHOOTABLES = world.shootables;
const effects = createEffects(scene);
const grenades = createGrenadePool(scene, effects, audio);
const hud = createHud(() => {}, () => {});
hud.buyOpen = () => document.getElementById('buy-menu').classList.contains('open');
const input = createInput(renderer.domElement, onLockChange);
const mover = createMover(world.colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

// --- Match state -----------------------------------------------------------
const match = {
  phase: 'buy',          // buy | live | planted | roundEnd | matchEnd
  round: 1,
  scoreAttacker: 0,
  scoreDefender: 0,
  timer: ROUND_TIME,
  money: START_MONEY,
  lossStreak: 0,
  killFeed: [],
  planted: false,
  bombTimer: 0,
  plantProgress: 0,
  beepAt: 0,
  endAt: 0,
};

const player = {
  alive: true,
  health: 100,
  weapons: { primary: null, secondary: createWeapon('pistol') },
  slot: 'secondary',
  grenades: { frag: 1, flash: 0 },
};
const body = mover.self;

// The player as the bots see it: a mover-shaped proxy. Alive follows the real health.
const playerProxy = { isPlayer: true, mover: { self: body }, get alive() { return player.alive; } };

// --- Bot callbacks ---------------------------------------------------------
function onBotKill(shooter, victim, headshot) {
  const attackerName = shooter.team === 'attacker' ? 'ATK bot' : 'DEF bot';
  const victimName = victim.team === 'attacker' ? 'ATK bot' : 'DEF bot';
  match.killFeed.push(`${attackerName} ${headshot ? '◎' : '→'} ${victimName}`);
  hud.killFeed(match.killFeed);
  if (shooter.team === 'attacker') match.money = Math.min(9000, match.money + KILL_REWARD);
  hud.setMoney(match.money);
  audio.killConfirm();
  checkRoundEnd();
}
const KILL_REWARD = 300;

function onBotPlayerHit(bot, headshot) {
  if (!player.alive) return;
  const moving = mover.groundSpeed() > 1.5;
  const crouching = body.crouching;
  const distance = bot.mover.self.position.distanceTo(body.position);
  let hitChance = 0.5 - distance * 0.008;
  if (moving) hitChance -= 0.13;
  if (crouching) hitChance += 0.03;
  if (random() > Math.max(0.06, Math.min(0.55, hitChance))) {
    // Miss: impact near the player so it reads on screen.
    effects.impact(
      new THREE.Vector3(body.position.x + (random() - 0.5) * 2.4, body.position.y + 0.8 + random() * 0.9, body.position.z + (random() - 0.5) * 2.4),
      new THREE.Vector3(0, 1, 0),
    );
    return;
  }
  const damage = Math.round(bot.weapon.def.damage * (headshot ? bot.weapon.def.headshot * 0.45 : 1));
  player.health -= damage;
  audio.hurt();
  hud.setHealth(player.health);
  if (player.health <= 0) {
    player.alive = false;
    match.killFeed.push(`DEF bot ${headshot ? '◎' : '→'} You`);
    hud.killFeed(match.killFeed);
    checkRoundEnd();
  }
}

const bots = createBotBrain({ onKill: onBotKill, onImpact: (point, kind) => (kind === 'blood' ? effects.blood(point) : effects.impact(point, new THREE.Vector3(0, 1, 0))), onPlayerHit: onBotPlayerHit, shootables: SHOOTABLES });

const viewModels = new THREE.Group();
camera.add(viewModels);

function currentWeapon() {
  return player.weapons[player.slot];
}

function equipViewModel() {
  viewModels.clear();
  const weapon = currentWeapon();
  if (weapon) viewModels.add(weapon.model, weapon.flash, weapon.flashLight);
  hud.setWeapon(weapon ? weapon.def.name : 'Unarmed');
}

let botEnemies = [];
let botAllies = [];

// --- Teams -----------------------------------------------------------------
function buildTeams() {
  for (const bot of botAllies) scene.remove(bot.group);
  for (const bot of botEnemies) scene.remove(bot.group);
  bots.bots.length = 0;
  botAllies = [];
  botEnemies = [];
  ATTACKER_SPAWNS.slice(1).forEach((spawn, index) => {
    const bot = createBot('attacker', spawn, world.colliders, SHOOTABLES, 1 + index * 0.3);
    scene.add(bot.group);
    bots.add(bot);
    botAllies.push(bot);
  });
  DEFENDER_SPAWNS.forEach((spawn, index) => {
    const bot = createBot('defender', spawn, world.colliders, SHOOTABLES, 1 + index * 0.3);
    scene.add(bot.group);
    bots.add(bot);
    botEnemies.push(bot);
  });
}
buildTeams();

// Routes: what each team tries when idle. Attackers push the site from three lanes.
const ATTACK_ROUTES = [
  [[2, 10], [2, 2], [6, -6], [6, -12]],
  [[-2, 10], [-9, 2], [-9, -6], [4, -12]],
  [[6, 11], [14, 2], [12, -8], [8, -13]],
];
const DEFEND_ROUTES = [
  [[6, -12], [6, -14]],
  [[0, -12], [6, -14]],
  [[12, -10], [7, -14]],
];

function objectiveFor(team) {
  const routes = team === 'attacker' ? ATTACK_ROUTES : DEFEND_ROUTES;
  return () => routes[Math.floor(random() * routes.length)];
}

// --- Round flow ------------------------------------------------------------
function aliveAttackers() {
  return (player.alive ? 1 : 0) + botAllies.filter((bot) => bot.alive).length;
}
function aliveDefenders() {
  return botEnemies.filter((bot) => bot.alive).length;
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  if (aliveAttackers() === 0) endRound('defender', 'Attackers eliminated');
  else if (aliveDefenders() === 0) endRound('attacker', 'Defenders eliminated');
}

function startRound() {
  match.phase = 'buy';
  match.timer = ROUND_TIME;
  match.planted = false;
  match.plantProgress = 0;
  match.bombTimer = 0;
  match.killFeed = [];
  hud.killFeed([]);
  hud.setBomb('', false);
  hud.setProgress(false, 0);
  grenades.clear();

  player.alive = true;
  player.health = 100;
  const spawn = ATTACKER_SPAWNS[0];
  body.position.set(spawn[0], 0, spawn[1]);
  mover.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  for (const weapon of [player.weapons.primary, player.weapons.secondary]) if (weapon) weapon.refill();
  equipViewModel();

  botAllies.forEach((bot, index) => reviveBot(bot, ATTACKER_SPAWNS[index + 1]));
  botEnemies.forEach((bot, index) => reviveBot(bot, DEFENDER_SPAWNS[index]));
  hud.setHealth(player.health);
  updateAmmoHud();
  hud.setRound(`Round ${match.round} · First to ${WIN_ROUNDS}`);
  hud.setScore(match.scoreAttacker, match.scoreDefender);
  hud.setMoney(match.money);
  hud.showBuy(true, match.money);
  if (shot) hud.showBuy(false, 0);
}

function beginLive() {
  if (match.phase !== 'buy') return;
  match.phase = 'live';
  hud.showBuy(false, 0);
}

function endRound(winner, reason) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  const won = winner === 'attacker';
  if (won) {
    match.scoreAttacker += 1;
    match.lossStreak = 0;
  } else {
    match.scoreDefender += 1;
    match.lossStreak += 1;
  }
  const reward = won ? WIN_REWARD : LOSS_REWARD + Math.min(2, match.lossStreak) * LOSS_STREAK_BONUS;
  match.money = Math.min(9000, match.money + reward);
  match.phase = 'roundEnd';
  match.endAt = ROUND_END_HOLD;
  hud.setScore(match.scoreAttacker, match.scoreDefender);
  hud.setMoney(match.money);
  audio.stinger(won);
  const line = `${reason} — ${won ? 'round won' : 'round lost'}`;
  const matchOver = match.scoreAttacker >= WIN_ROUNDS || match.scoreDefender >= WIN_ROUNDS;
  if (matchOver) {
    match.phase = 'matchEnd';
    hud.showOverlay(won ? 'matchWin' : 'matchLoss', `${line} · Final ${match.scoreAttacker}–${match.scoreDefender}`);
  } else {
    hud.showOverlay(won ? 'roundWin' : 'roundLoss', `${line} · ${match.scoreAttacker}–${match.scoreDefender}`);
  }
  input.releaseLock();
}

function nextRound() {
  match.round += 1;
  startRound();
}

// --- Buy -------------------------------------------------------------------
function buy(item) {
  if (match.phase !== 'buy') return;
  if (item === 'frag' || item === 'flash') {
    const price = GRENADES[item].price;
    if (match.money < price || player.grenades[item] >= MAX_GRENADES) return;
    match.money -= price;
    player.grenades[item] += 1;
  } else {
    const def = WEAPONS[item];
    if (match.money < def.price) return;
    match.money -= def.price;
    if (def.slot === 1) {
      player.weapons.primary = createWeapon(item);
      player.slot = 'primary';
    } else {
      player.weapons.secondary = createWeapon(item);
      player.slot = 'secondary';
    }
    equipViewModel();
  }
  hud.setMoney(match.money);
  updateAmmoHud();
}

// --- Combat ----------------------------------------------------------------
const shootDirection = new THREE.Vector3();
const upVector = new THREE.Vector3(0, 1, 0);

function damageBot(bot, amount, point, headshot) {
  if (!bot.alive) return false;
  bot.health -= amount;
  effects.blood(point);
  audio.flesh();
  if (bot.health > 0) return false;
  killBot(bot, elapsed);
  match.killFeed.push(`You ${headshot ? '◎' : '→'} ${bot.team === 'attacker' ? 'ATK' : 'DEF'} bot`);
  hud.killFeed(match.killFeed);
  match.money = Math.min(9000, match.money + KILL_REWARD);
  hud.setMoney(match.money);
  audio.killConfirm();
  return true;
}

function fireHitscan(origin, direction, weaponDef, isPlayer) {
  raycaster.set(origin, direction);
  const hits = raycaster.intersectObjects(SHOOTABLES, false);
  for (const hit of hits) {
    const bot = hit.object.userData.bot;
    if (bot && !bot.alive) continue;
    if (bot) {
      const head = hit.object.userData.part === 'head';
      const damage = Math.round(weaponDef.damage * (head ? weaponDef.headshot : 1));
      const killed = damageBot(bot, damage, hit.point, head);
      if (isPlayer) {
        hud.hitMarker(killed, killed ? 220 : 90);
        if (!killed) audio.hitConfirm();
      }
      return;
    }
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : upVector;
    effects.impact(hit.point, normal);
    audio.impact();
    return;
  }
}

function playerShoot() {
  const weapon = currentWeapon();
  if (!player.alive || !weapon) return;
  if (!weapon.ready()) {
    if (weapon.state.mag === 0 && weapon.state.cooldown === 0 && weapon.state.reloadLeft === 0) audio.empty();
    return;
  }
  if (!weapon.takeRound()) return;
  weapon.pullTrigger();
  audio.shot(weapon.def.sound);
  const spread = shot ? 0 : weapon.spread(mover.groundSpeed(), body.onGround);
  camera.getWorldDirection(shootDirection);
  shootDirection.x += (random() * 2 - 1) * spread;
  shootDirection.y += (random() * 2 - 1) * spread;
  shootDirection.z += (random() * 2 - 1) * spread;
  shootDirection.normalize();
  scene.updateMatrixWorld(true);
  fireHitscan(camera.position, shootDirection, weapon.def, true);
  mover.recoil(weapon.def.recoil + random() * 0.003, (random() * 2 - 1) * 0.004);
  bots.alert(body.position, 'attacker');
  updateAmmoHud();
}

function throwGrenade(kind) {
  if (!player.alive || player.grenades[kind] <= 0) return;
  player.grenades[kind] -= 1;
  const def = GRENADES[kind];
  camera.getWorldDirection(shootDirection);
  const origin = camera.position.clone().addScaledVector(shootDirection, 0.5);
  grenades.throw_(kind, origin, shootDirection.clone().multiplyScalar(14).add(new THREE.Vector3(0, 3, 0)), explodeGrenade, def.fuse);
  updateAmmoHud();
}

function explodeGrenade(center, kind) {
  const def = GRENADES[kind];
  const hurt = (position, apply) => {
    const d = center.distanceTo(position);
    if (d < def.radius) apply(Math.round(def.damage * (1 - d / def.radius)));
  };
  if (player.alive) {
    hurt(body.position, (damage) => {
      player.health -= damage;
      audio.hurt();
      hud.setHealth(player.health);
      if (player.health <= 0) {
        player.alive = false;
        match.killFeed.push(`Your ${def.name} → You`);
        hud.killFeed(match.killFeed);
        checkRoundEnd();
      }
    });
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    hurt(bot.mover.self.position, (damage) => {
      damageBot(bot, damage, bot.mover.self.position, false);
    });
  }
  checkRoundEnd();
}

function updateAmmoHud() {
  const weapon = currentWeapon();
  if (weapon) hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  else hud.setAmmo(0, 0);
  document.getElementById('grenade-count').textContent =
    `G frag ×${player.grenades.frag} · F flash ×${player.grenades.flash}`;
}

// --- Plant -----------------------------------------------------------------
function inPlantZone() {
  return Math.hypot(body.position.x - PLANT_ZONE.x, body.position.z - PLANT_ZONE.z) < PLANT_ZONE.radius;
}

function plantDone() {
  match.planted = true;
  match.phase = 'planted';
  match.bombTimer = BOMB_TIME;
  match.beepAt = 0;
  match.money = Math.min(9000, match.money + PLANT_REWARD);
  hud.setMoney(match.money);
  hud.setBomb('SPIKE PLANTED', true);
  effects.plantRing(new THREE.Vector3(PLANT_ZONE.x, 0, PLANT_ZONE.z));
  audio.beep(true);
}

function detonate() {
  audio.explode();
  effects.explosion(new THREE.Vector3(PLANT_ZONE.x, 1.2, PLANT_ZONE.z));
  hud.setBomb('', false);
  endRound('attacker', 'The spike detonated');
}

// --- Fixed-step simulation -------------------------------------------------
let elapsed = 0;

function step(dt) {
  elapsed += dt;
  effects.step(dt);
  grenades.step(dt);
  const active = match.phase === 'live' || match.phase === 'planted';

  if (player.alive && active && !match.freeze) mover.step(dt, input.state.keys);
  for (const weapon of [player.weapons.primary, player.weapons.secondary]) if (weapon) weapon.step(dt);

  if (active) {
    if (match.phase === 'live') {
      match.timer -= dt;
      if (match.timer <= 0) endRound('defender', 'Time expired');
    } else {
      match.bombTimer -= dt;
      const urgent = match.bombTimer < 10;
      if (elapsed >= match.beepAt) {
        audio.beep(urgent);
        match.beepAt = elapsed + Math.max(0.18, (match.bombTimer / BOMB_TIME) * 1.1);
      }
      if (match.bombTimer <= 0) detonate();
    }
  } else if (match.phase === 'roundEnd') {
    match.endAt -= dt;
  }

  bots.step(dt, elapsed, (selfBot) => (selfBot.team === 'attacker' ? botEnemies : botAllies.concat(playerProxy)), objectiveFor('attacker'), active);
  for (const bot of bots.bots) {
    bot.group.position.set(bot.mover.self.position.x, bot.mover.self.position.y, bot.mover.self.position.z);
    bot.group.rotation.y = bot.mover.self.yaw;
    if (!bot.alive) bot.group.rotation.x = -1.45;
  }
}

// --- Frame -----------------------------------------------------------------
function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (!player.alive) {
    camera.position.y = body.position.y + 0.4;
    camera.rotation.z = 0.5;
  }
  viewModels.visible = player.alive;
  if (player.alive) {
    const speed = mover.groundSpeed();
    viewModels.position.y = Math.sin(elapsed * 9) * 0.006 * Math.min(1, speed / 4);
  }
  if (world.objectiveCore) world.objectiveCore.rotation.y = elapsed * 1.4;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  if (player.alive && input.state.locked) mover.look(look.x, look.y);
  const actions = input.consumeActions();
  const playing = input.state.locked && match.phase !== 'buy' && match.phase !== 'matchEnd' && !hud.buyOpen();
  if (playing) {
    if (input.state.firing) {
      const weapon = currentWeapon();
      if (weapon && (weapon.def.auto || !input.state.firedOnce)) {
        playerShoot();
        input.state.firedOnce = true;
      }
    } else {
      input.state.firedOnce = false;
    }
    if (actions.reload && currentWeapon() && currentWeapon().reload()) {
      audio.reload();
      updateAmmoHud();
    }
    if (actions.switchTo === 1 && player.weapons.primary) { player.slot = 'primary'; equipViewModel(); updateAmmoHud(); }
    if (actions.switchTo === 2) { player.slot = 'secondary'; equipViewModel(); updateAmmoHud(); }
    if (actions.grenade === 1) throwGrenade('frag');
    if (actions.grenade === 2) throwGrenade('flash');
    if ((actions.plant || input.state.keys.has('KeyX')) && match.phase === 'live' && player.alive && inPlantZone()) {
      match.plantProgress += FIXED_STEP;
      hud.setProgress(true, match.plantProgress / PLANT_TIME);
      if (match.plantProgress >= PLANT_TIME) {
        plantDone();
        hud.setProgress(false, 0);
      }
    } else {
      const showProgress = match.phase === 'live' && player.alive && inPlantZone() && input.state.keys.has('KeyX');
      match.plantProgress = showProgress ? match.plantProgress : 0;
      hud.setProgress(showProgress, match.plantProgress / PLANT_TIME);
    }
  }

  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;

  if (match.phase === 'live') {
    const t = Math.max(0, match.timer);
    hud.setTimer(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, t < 20);
  } else if (match.phase === 'planted') {
    hud.setTimer('0:00', true);
  }
  syncCamera();
  renderer.render(scene, camera);
}

// Buy menu toggles with B during buy time.
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyB' && match.phase === 'buy' && !shot) {
    document.getElementById('buy-menu').classList.toggle('open');
  }
});

hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  if (match.phase === 'matchEnd') {
    match.round = 1;
    match.scoreAttacker = 0;
    match.scoreDefender = 0;
    match.money = START_MONEY;
    match.lossStreak = 0;
    buildTeams();
    startRound();
    input.requestLock();
    return;
  }
  if (match.phase === 'roundEnd') {
    hud.hideOverlay();
    nextRound();
    input.requestLock();
    return;
  }
  if (match.phase === 'buy') {
    hud.hideOverlay();
    document.getElementById('buy-menu').classList.remove('open');
    input.requestLock();
    beginLive();
    return;
  }
  hud.hideOverlay();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) hud.hideOverlay();
  else if (match.phase !== 'roundEnd' && match.phase !== 'matchEnd') {
    hud.showOverlay(match.phase === 'buy' ? 'start' : 'paused', '');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Deterministic shot mode ----------------------------------------------
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false, 0);
  body.pitch = 0;
  if (name === 'play' || name === 'end') {
    match.phase = 'live';
    body.position.set(0.5, 0, 11);
    body.yaw = 0;
    settle(20);
    if (name === 'play') {
      const target = botEnemies.find((bot) => bot.alive);
      if (target) {
        // Freeze the posed fight so the frame is composed: a bot mid-lane, hit sparks flying.
        target.mover.self.position.set(6, 0, -6);
        target.group.position.set(6, 0, -6);
        target.state = 'engage';
        target.target = playerProxy;
        // Give the player a rifle view model for the shot.
        buy('rifle');
        body.position.set(0.5, 0, 11);
        for (let round = 0; round < 4; round += 1) {
          target.mover.self.position.set(6 + round * 0.15, 0, -6);
          target.group.position.copy(target.mover.self.position);
          aimAt(new THREE.Vector3(target.mover.self.position.x, 1.3, target.mover.self.position.z));
          playerShoot();
          settle(7);
        }
        // Posed reload so the readout shows a full mag; keep the hit effects fresh.
        const w = currentWeapon();
        if (w) { w.refill(); }
        updateAmmoHud();
        settle(2);
      }
      aimAt(new THREE.Vector3(6, 1.4, -6));
      settle(1);
    } else {
      // End shot: spike planted on the site, defenders rotating, console glowing.
      plantDone();
      match.bombTimer = 12;
      body.position.set(2.5, 0, -6);
      body.yaw = 0;
      aimAt(new THREE.Vector3(8.4, 1.6, -14));
      settle(6);
      // Clear the falling particles so the site reads cleanly, keep the bomb banner.
      effects.step(2.5);
      settle(1);
    }
  } else {
    body.position.set(1.5, 0, 15);
    body.yaw = 0;
    settle(10);
    aimAt(new THREE.Vector3(-9, 1.6, 1.5));
    hud.showOverlay('start', '');
  }
  hud.setHealth(player.health);
  hud.setMoney(match.money);
  updateAmmoHud();
  hud.setScore(match.scoreAttacker, match.scoreDefender);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

// A small debug handle: lets a test or a screenshot script advance the simulation without
// waiting in real time, and read the match state. Never used by gameplay.
window.__breach = {
  match,
  player,
  bots,
  mover,
  shootables: SHOOTABLES,
  scene,
  throwGrenade,
  buy,
  beginLive,
  playerShoot,
  plant() {
    if (match.phase === 'live' && player.alive && inPlantZone()) {
      match.plantProgress = PLANT_TIME;
      plantDone();
    }
    return { phase: match.phase, planted: match.planted };
  },
  fastForward(seconds) {
    const steps = Math.min(60 * 180, Math.round(seconds / FIXED_STEP));
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
    syncCamera();
    hud.setHealth(player.health);
    updateAmmoHud();
    if (match.phase === 'live') {
      const t = Math.max(0, match.timer);
      hud.setTimer(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, t < 20);
    }
  },
};

syncCamera();
startRound();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
