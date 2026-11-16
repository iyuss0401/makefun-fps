// Effects: short-lived meshes and particles pooled once and reused, so no hot loop allocates.
// Muzzle sparks, bullet impact puffs, blood hits, grenade explosion and the plant/defuse ring.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const POOL_SIZE = 220;
const PARTICLE_LIFE = 0.55;

function makePool(scene) {
  const geometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const materials = {
    spark: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
    dust: new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted) }),
    blood: new THREE.MeshBasicMaterial({ color: new THREE.Color('#b3372c') }),
    smoke: new THREE.MeshBasicMaterial({ color: new THREE.Color('#555c66'), transparent: true, opacity: 0.6 }),
  };
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i += 1) {
    const mesh = new THREE.Mesh(geometry, materials.dust);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0, gravity: 8 });
  }
  let cursor = 0;
  function spawn(x, y, z, vx, vy, vz, material, scale = 1, life = PARTICLE_LIFE, gravity = 8) {
    const particle = pool[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    particle.mesh.position.set(x, y, z);
    particle.mesh.scale.setScalar(scale);
    particle.mesh.material = materials[material];
    particle.mesh.visible = true;
    particle.life = life;
    particle.maxLife = life;
    particle.vx = vx; particle.vy = vy; particle.vz = vz;
    particle.gravity = gravity;
  }
  return { pool, spawn };
}

export function createEffects(scene) {
  const { pool, spawn } = makePool(scene);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.55, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringLife = 0;

  return {
    spawn,
    impact(point, normal) {
      for (let i = 0; i < 5; i += 1) {
        spawn(point.x, point.y, point.z,
          normal.x * 2 + (Math.random() - 0.5) * 3,
          normal.y * 2 + Math.random() * 2.5,
          normal.z * 2 + (Math.random() - 0.5) * 3,
          'dust', 0.6 + Math.random() * 0.5, 0.4);
      }
      spawn(point.x, point.y, point.z, 0, 0.4, 0, 'spark', 0.9, 0.15, 0);
    },
    blood(point) {
      for (let i = 0; i < 6; i += 1) {
        spawn(point.x, point.y, point.z,
          (Math.random() - 0.5) * 2.4,
          Math.random() * 2,
          (Math.random() - 0.5) * 2.4,
          'blood', 0.5 + Math.random() * 0.4, 0.45);
      }
    },
    explosion(point) {
      for (let i = 0; i < 26; i += 1) {
        const speed = 4 + Math.random() * 7;
        const angle = Math.random() * Math.PI * 2;
        const up = Math.random() * 5;
        spawn(point.x, point.y, point.z,
          Math.cos(angle) * speed, up, Math.sin(angle) * speed,
          i % 3 === 0 ? 'smoke' : 'spark', 1 + Math.random() * 2.2, 0.6 + Math.random() * 0.4, 6);
      }
    },
    plantRing(point) {
      ring.position.set(point.x, 0.06, point.z);
      ring.visible = true;
      ringLife = 1;
    },
    step(dt) {
      for (const particle of pool) {
        if (particle.life <= 0) continue;
        particle.life -= dt;
        if (particle.life <= 0) { particle.mesh.visible = false; continue; }
        particle.vy -= particle.gravity * dt;
        particle.mesh.position.x += particle.vx * dt;
        particle.mesh.position.y += particle.vy * dt;
        particle.mesh.position.z += particle.vz * dt;
        if (particle.mesh.position.y < 0.03) { particle.mesh.position.y = 0.03; particle.vy = 0; particle.vx *= 0.8; particle.vz *= 0.8; }
      }
      if (ringLife > 0) {
        ringLife = Math.max(0, ringLife - dt * 1.4);
        ring.scale.setScalar(1 + (1 - ringLife) * 2.4);
        ring.material.opacity = ringLife * 0.9;
        if (ringLife === 0) ring.visible = false;
      }
    },
  };
}

// Grenades: a thrown physics ball that explodes on its fuse. Created rarely, disposed on pop.
export function createGrenadePool(scene, effects, audio) {
  const geometry = new THREE.SphereGeometry(0.11, 10, 8);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a5548'), roughness: 0.5, metalness: 0.3 });
  const active = [];
  return {
    throw_(kind, position, velocity, damageCallback, fuse) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.castShadow = true;
      scene.add(mesh);
      active.push({ kind, mesh, velocity: velocity.clone(), fuse, damageCallback, bounces: 0 });
    },
    step(dt) {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const grenade = active[i];
        grenade.fuse -= dt;
        grenade.velocity.y -= 14 * dt;
        const next = grenade.mesh.position.clone().addScaledVector(grenade.velocity, dt);
        if (next.y < 0.11) { next.y = 0.11; grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4; grenade.velocity.x *= 0.7; grenade.velocity.z *= 0.7; grenade.bounces += 1; }
        if (Math.abs(next.x) > 21.6) { grenade.velocity.x *= -0.5; next.x = Math.sign(next.x) * 21.6; }
        if (Math.abs(next.z) > 21.6) { grenade.velocity.z *= -0.5; next.z = Math.sign(next.z) * 21.6; }
        grenade.mesh.position.copy(next);
        if (grenade.fuse <= 0) {
          effects.explosion(next);
          audio.explode();
          grenade.damageCallback(next, grenade.kind);
          scene.remove(grenade.mesh);
          active.splice(i, 1);
        }
      }
    },
    clear() {
      for (const grenade of active) scene.remove(grenade.mesh);
      active.length = 0;
    },
  };
}
