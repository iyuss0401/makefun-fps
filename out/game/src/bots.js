// Bots: capsule body, sphere head, simple state machine. Bots on routes walk waypoints, hold
// positions at objectives, turn to face what they see, and shoot with reaction time and aim
// error that tightens while they hold still. They hear gunfire and push the last sound.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMover } from './mover.js';
import { WEAPONS } from './weapons.js';
import { audio } from './audio.js';

const VIEW_DISTANCE = 30;
const VIEW_DOT = 0.35;          // ~69 degree cone
const REACTION_MIN = 0.25;
const REACTION_RANGE = 0.4;
const AIM_ERROR_START = 0.06;
const AIM_ERROR_HOLD = 0.012;
const HEAD_Y = 1.5;
const TORSO_Y = 1.05;

const TEAM_COLORS = {
  attacker: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c46a3a'), roughness: 0.6, metalness: 0.1 }),
  defender: new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a6ac4'), roughness: 0.6, metalness: 0.1 }),
};
const HEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5 });
const DEAD_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.9 });

let nextId = 1;

export function createBot(team, spawn, colliders, shootables, difficulty = 1) {
  const mover = createMover(colliders);
  mover.self.position.set(spawn[0], 0, spawn[1]);
  mover.self.yaw = team === 'attacker' ? 0 : Math.PI;

  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.9, 6, 12), TEAM_COLORS[team]);
  body.position.y = TORSO_Y;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), HEAD_MATERIAL);
  head.position.y = HEAD_Y;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.05), TEAM_COLORS[team]);
  visor.position.set(0, HEAD_Y, -0.17);
  group.add(body, head, visor);
  group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });

  const bot = {
    id: nextId++,
    team,
    mover,
    group,
    body, head,
    alive: true,
    health: 100,
    weapon: createBotWeapon(difficulty >= 2 ? 'rifle' : 'smg'),
    state: 'hold',
    route: null,
    routeIndex: 0,
    holdUntil: 0,
    reactionLeft: 0,
    aimTime: 0,
    target: null,
    lastSeen: null,
    alertPoint: null,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    strafeTimer: 0,
    fireTimer: 0,
    difficulty,
  };
  body.userData.bot = bot;
  head.userData.bot = bot;
  body.userData.part = 'torso';
  head.userData.part = 'head';
  shootables.push(body, head);
  return bot;
}

function createBotWeapon(kind) {
  const def = WEAPONS[kind];
  return { kind, def, mag: def.mag, cooldown: 0, reloadLeft: 0 };
}

const viewDir = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const eyePoint = new THREE.Vector3();
const targetPoint = new THREE.Vector3();

export function createBotBrain({ onKill, onImpact, onPlayerHit, shootables } = {}) {
  const botShootables = shootables;
  const bots = [];
  const raycaster = new THREE.Raycaster();
  const hitNormal = new THREE.Vector3();
  const upVector = new THREE.Vector3(0, 1, 0);

  function canSee(bot, enemy) {
    if (!enemy.alive) return false;
    eyePoint.set(bot.mover.self.position.x, bot.mover.self.position.y + HEAD_Y, bot.mover.self.position.z);
    targetPoint.set(enemy.mover.self.position.x, enemy.mover.self.position.y + TORSO_Y, enemy.mover.self.position.z);
    toTarget.subVectors(targetPoint, eyePoint);
    const distance = toTarget.length();
    if (distance > VIEW_DISTANCE) return false;
    viewDir.set(-Math.sin(bot.mover.self.yaw), 0, -Math.cos(bot.mover.self.yaw));
    toTarget.normalize();
    if (viewDir.dot(toTarget) < VIEW_DOT) return false;
    if (enemy.isPlayer) return true;   // the player has no mesh; cones and range gate sight
    raycaster.set(eyePoint, toTarget);
    raycaster.far = distance - 0.3;
    const hits = raycaster.intersectObjects(botShootables, false);
    for (const hit of hits) {
      const hitBot = hit.object.userData.bot;
      if (hitBot && hitBot.team === bot.team) continue;   // teammate bodies don't block sight
      return false;
    }
    return true;
  }

  function moveTo(bot, targetX, targetZ, dt, direct = true) {
    const keys = new Set();
    const dx = targetX - bot.mover.self.position.x;
    const dz = targetZ - bot.mover.self.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.6) {
      // Face travel direction; turn smoothly.
      const wanted = Math.atan2(-dx, -dz);
      let diff = wanted - bot.mover.self.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      bot.mover.self.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
      // Re-derive forward/strafe keys in the bot's frame by rotating the wish vector.
      const sin = Math.sin(bot.mover.self.yaw);
      const cos = Math.cos(bot.mover.self.yaw);
      const nx = (dx * cos - dz * sin) / distance;   // local x
      const nz = (-dx * sin - dz * cos) / distance;  // local z (forward)
      if (nz > 0.15) keys.add('KeyW');
      else if (nz < -0.15) keys.add('KeyS');
      if (nx > 0.15) keys.add('KeyD');
      else if (nx < -0.15) keys.add('KeyA');
    }
    if (direct) bot.mover.step(dt, keys, 0.92);
    return distance;
  }

  function step(bot, dt, time, enemies, objective, roundActive) {
    if (!bot.alive || !roundActive) {
      bot.mover.step(dt, new Set());
      return;
    }
    bot.weapon.cooldown = Math.max(0, bot.weapon.cooldown - dt);
    if (bot.weapon.reloadLeft > 0) {
      bot.weapon.reloadLeft = Math.max(0, bot.weapon.reloadLeft - dt);
      if (bot.weapon.reloadLeft === 0) bot.weapon.mag = bot.weapon.def.mag;
    }

    // Perception: pick the nearest visible enemy.
    let seen = null;
    let seenDistance = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (canSee(bot, enemy)) {
        const d = bot.mover.self.position.distanceTo(enemy.mover.self.position);
        if (d < seenDistance) { seen = enemy; seenDistance = d; }
      }
    }
    if (seen) {
      if (bot.target !== seen) {
        bot.target = seen;
        bot.reactionLeft = REACTION_MIN + Math.random() * REACTION_RANGE / bot.difficulty;
        bot.aimTime = 0;
      }
      bot.state = 'engage';
      bot.lastSeen = seen;
      bot.alertPoint = null;
    } else if (bot.state === 'engage') {
      bot.state = 'push';
      bot.pushTimer = 3.5;
    }

    const keys = new Set();
    if (bot.state === 'engage' && bot.target) {
      const enemy = bot.target;
      if (!enemy.alive) { bot.state = 'hold'; bot.target = null; }
      else {
        // Face the enemy, strafe a little, shoot after the reaction time.
        const dx = enemy.mover.self.position.x - bot.mover.self.position.x;
        const dz = enemy.mover.self.position.z - bot.mover.self.position.z;
        const wanted = Math.atan2(-dx, -dz);
        let diff = wanted - bot.mover.self.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        bot.mover.self.yaw += Math.max(-7 * dt, Math.min(7 * dt, diff));
        bot.mover.self.pitch = Math.atan2(
          (enemy.mover.self.position.y + TORSO_Y) - (bot.mover.self.position.y + HEAD_Y),
          Math.hypot(dx, dz),
        );
        bot.strafeTimer -= dt;
        if (bot.strafeTimer <= 0) {
          bot.strafeTimer = 0.5 + Math.random() * 0.8;
          bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
          if (Math.random() < 0.2) bot.strafeDir = 0;
        }
        if (bot.strafeDir) keys.add(bot.strafeDir > 0 ? 'KeyD' : 'KeyA');
        bot.mover.step(dt, keys, 0.55);

        bot.reactionLeft -= dt;
        bot.aimTime += dt;
        if (bot.reactionLeft <= 0 && Math.abs(diff) < 0.25) {
          if (bot.weapon.mag <= 0) {
            if (bot.weapon.reloadLeft === 0) bot.weapon.reloadLeft = bot.weapon.def.reloadTime;
          } else if (bot.weapon.cooldown === 0 && fireAt(bot, enemy)) {
            bot.weapon.cooldown = bot.weapon.def.fireGap * (1.25 - bot.difficulty * 0.1);
            bot.weapon.mag -= 1;
          }
        }
      }
    } else if (bot.state === 'push' && bot.lastSeen) {
      bot.pushTimer -= dt;
      const left = moveTo(bot, bot.lastSeen.mover.self.position.x, bot.lastSeen.mover.self.position.z, dt);
      if (bot.pushTimer <= 0 || left < 1.2) { bot.state = 'hold'; bot.lastSeen = null; }
    } else if (bot.alertPoint) {
      const left = moveTo(bot, bot.alertPoint.x, bot.alertPoint.z, dt);
      if (left < 1.4) bot.alertPoint = null;
    } else if (bot.route && bot.route.length) {
      const waypoint = bot.route[Math.min(bot.routeIndex, bot.route.length - 1)];
      const left = moveTo(bot, waypoint[0], waypoint[1], dt);
      if (left < 1.4) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.routeIndex = bot.route.length - 1;
          bot.state = 'hold';
          bot.holdUntil = time + 2 + Math.random() * 3;
        }
      }
    } else {
      // Hold: small idle scan so they look alive.
      bot.mover.self.yaw += Math.sin(time * 0.7 + bot.id * 2.1) * 0.25 * dt;
      if (time > bot.holdUntil && objective) {
        bot.route = objective();
        bot.routeIndex = 0;
      }
    }
  }

  function fireAt(bot, enemy) {
    // A ray from the bot's eye toward the enemy torso with aim error that shrinks as they aim.
    const error = Math.max(AIM_ERROR_HOLD, AIM_ERROR_START - bot.aimTime * 0.02) / bot.difficulty;
    eyePoint.set(bot.mover.self.position.x, bot.mover.self.position.y + HEAD_Y, bot.mover.self.position.z);
    targetPoint.set(enemy.mover.self.position.x, enemy.mover.self.position.y + TORSO_Y, enemy.mover.self.position.z);
    toTarget.subVectors(targetPoint, eyePoint);
    const playerDistance = enemy.isPlayer ? toTarget.length() : Infinity;
    toTarget.normalize();
    toTarget.x += (Math.random() * 2 - 1) * error;
    toTarget.y += (Math.random() * 2 - 1) * error * 0.6;
    toTarget.z += (Math.random() * 2 - 1) * error;
    toTarget.normalize();
    raycaster.set(eyePoint, toTarget);
    raycaster.far = 60;
    const hits = raycaster.intersectObjects(botShootables, false);
    audio.shot(bot.weapon.def.sound, 0);
    const worldDistance = hits.length ? hits[0].distance : Infinity;
    if (playerDistance < worldDistance) {
      // The shot reaches the player (no wall in between and no teammate blocking).
      const headshot = Math.random() < 0.14;
      if (onPlayerHit) onPlayerHit(bot, headshot);
      else if (onImpact) onImpact(targetPoint, 'blood');
    } else if (hits.length) {
      const hit = hits[0];
      const hitBot = hit.object.userData.bot;
      if (hitBot && hitBot.alive && hitBot.team !== bot.team) {
        const head = hit.object.userData.part === 'head';
        const damage = Math.round(bot.weapon.def.damage * (head ? bot.weapon.def.headshot : 1));
        hitBot.health -= damage;
        if (hitBot.health <= 0) {
          killBot(hitBot, 0);
          if (onKill) onKill(bot, hitBot, head);
        } else if (onImpact) onImpact(hit.point, 'blood');
      } else if (onImpact) {
        hitNormal.copy(hit.face ? hit.face.normal : upVector).transformDirection(hit.object.matrixWorld);
        onImpact(hit.point, 'dust');
      }
    }
    return true;
  }

  return {
    bots,
    add: (bot) => bots.push(bot),
    step(dt, time, enemiesByBot, objective, roundActive) {
      for (const bot of bots) step(bot, dt, time, enemiesByBot(bot), objective, roundActive);
    },
    alert(point, exceptTeam) {
      for (const bot of bots) {
        if (bot.team === exceptTeam || !bot.alive) continue;
        if (bot.state === 'hold' && Math.random() < 0.6) bot.alertPoint = { x: point.x + (Math.random() - 0.5) * 4, z: point.z + (Math.random() - 0.5) * 4 };
      }
    },
  };
}

// Death: swap materials, drop the capsule over.
export function killBot(bot, time) {
  bot.alive = false;
  bot.health = 0;
  bot.body.material = DEAD_MATERIAL;
  bot.head.material = DEAD_MATERIAL;
  bot.group.rotation.x = 0;
  bot.deadAt = time;
}

export function reviveBot(bot, spawn) {
  bot.alive = true;
  bot.health = 100;
  bot.body.material = TEAM_COLORS[bot.team];
  bot.head.material = HEAD_MATERIAL;
  bot.group.rotation.x = 0;
  bot.mover.self.position.set(spawn[0], 0, spawn[1]);
  bot.mover.velocity.set(0, 0, 0);
  bot.weapon.mag = bot.weapon.def.mag;
  bot.weapon.cooldown = 0;
  bot.weapon.reloadLeft = 0;
  bot.state = 'hold';
  bot.target = null;
  bot.lastSeen = null;
  bot.alertPoint = null;
  bot.route = null;
}
