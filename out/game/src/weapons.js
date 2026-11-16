// Weapons: the loadout each side buys between rounds. A weapon owns its numbers and its
// view model; main.js owns the ray and the damage. Every weapon is hitscan.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm',
    slot: 2,
    price: 0,
    damage: 26,
    headshot: 3.0,
    mag: 12,
    reserve: 36,
    fireGap: 0.16,
    reloadTime: 1.3,
    spreadStill: 0.003,
    spreadMoving: 0.024,
    spreadAir: 0.05,
    recoil: 0.011,
    kick: 0.05,
    sound: 'pistol',
    auto: false,
  },
  smg: {
    name: 'K-Vector',
    slot: 1,
    price: 900,
    damage: 21,
    headshot: 2.6,
    mag: 30,
    reserve: 90,
    fireGap: 0.078,
    reloadTime: 1.8,
    spreadStill: 0.006,
    spreadMoving: 0.014,
    spreadAir: 0.05,
    recoil: 0.008,
    kick: 0.035,
    sound: 'smg',
    auto: true,
  },
  rifle: {
    name: 'AR-77 "Meridian"',
    slot: 1,
    price: 2400,
    damage: 31,
    headshot: 3.2,
    mag: 25,
    reserve: 75,
    fireGap: 0.1,
    reloadTime: 2.1,
    spreadStill: 0.0022,
    spreadMoving: 0.03,
    spreadAir: 0.06,
    recoil: 0.012,
    kick: 0.05,
    sound: 'rifle',
    auto: true,
  },
  dmr: {
    name: 'LR-4 Sentinel',
    slot: 1,
    price: 3800,
    damage: 98,
    headshot: 1.6,
    mag: 6,
    reserve: 24,
    fireGap: 0.85,
    reloadTime: 2.6,
    spreadStill: 0.0006,
    spreadMoving: 0.06,
    spreadAir: 0.09,
    recoil: 0.03,
    kick: 0.12,
    sound: 'dmr',
    auto: false,
  },
};

export const GRENADES = { frag: { name: 'Frag', price: 300, damage: 88, radius: 6, fuse: 2.2 }, flash: { name: 'Flash', price: 200, radius: 9, fuse: 1.6, blind: 2.4 } };

const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const GRIP_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const ACCENT_MATERIAL = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.9, roughness: 0.4 });

function buildModel(kind) {
  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.1, kind === 'dmr' ? 0.56 : 0.42), BODY_MATERIAL);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.042, kind === 'pistol' ? 0.22 : 0.44), GRIP_MATERIAL);
  barrel.position.set(0, 0.02, kind === 'pistol' ? -0.2 : -0.4);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, kind === 'pistol' ? 0.14 : 0.2, 0.08), GRIP_MATERIAL);
  mag.position.set(0, -0.13, kind === 'pistol' ? -0.02 : 0.02);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, kind === 'pistol' ? 0.12 : 0.22), GRIP_MATERIAL);
  stock.position.set(0, -0.02, kind === 'pistol' ? 0.14 : 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.1), ACCENT_MATERIAL);
  sight.position.set(0, 0.085, -0.06);
  model.add(receiver, barrel, mag, stock, sight);
  model.position.set(0.24, -0.2, -0.46);
  model.traverse((mesh) => { mesh.castShadow = false; });
  return model;
}

export function createWeapon(kind) {
  const def = WEAPONS[kind];
  const model = buildModel(kind);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, kind === 'pistol' ? -0.75 : -0.98);
  flash.visible = false;
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6, 2);
  flashLight.position.set(0.24, -0.15, -0.7);

  const state = { mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  return {
    def,
    kind,
    model,
    flash,
    flashLight,
    state,
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      model.position.z = -0.46 + state.kick;
      model.rotation.x = state.kick * 2.2;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
        if (state.reloadLeft === 0) {
          const take = Math.min(def.mag - state.mag, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = def.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed, onGround) {
      const moving = Math.min(1, speed / 5.2);
      const base = def.spreadStill + moving * def.spreadMoving;
      return onGround ? base : Math.max(base, def.spreadAir);
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}
