// The map: "Vault Nine", an original asymmetric three-lane courtyard. A mid office, two side
// corridors and a sunken atrium between the attackers' spawn (T, south) and the defenders' site
// with the objective (C, north). Every box is a collider for movers and a surface a bullet stops
// on. Plain geometry only: no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SIZE = 44;          // courtyard is SIZE x SIZE metres
const WALL_H = 6;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.45 : 0.9,
      metalness: name === 'ink' ? 0.15 : 0.03,
    });
  }
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material = 'hairline', solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function glow(width, height, depth, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glowMaterial);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // Floor, four walls and the low lip of the sunken atrium floor.
  box(SIZE, 0.4, SIZE, 0, -0.2, 0, 'surface');
  box(0.4, WALL_H, SIZE, -SIZE / 2, WALL_H / 2, 0, 'surface');
  box(0.4, WALL_H, SIZE, SIZE / 2, WALL_H / 2, 0, 'surface');
  box(SIZE, WALL_H, 0.4, 0, WALL_H / 2, -SIZE / 2, 'surface');
  box(SIZE, WALL_H, 0.4, 0, WALL_H / 2, SIZE / 2, 'surface');
  // Atrium: a shallow pit in the middle players can drop into but not through the middle lane.
  box(12, 0.7, 3, 0, 0.15, 3.4, 'hairline');
  box(12, 0.7, 3, 0, 0.15, -3.4, 'hairline');

  // MID: the office — two rooms joined by a doorway, on the west half.
  box(8, 3.4, 0.4, -9, 1.7, 1.5, 'surface');            // office south wall with a gap
  box(2.4, 3.4, 0.4, -13.4, 1.7, 1.5, 'surface');
  box(3.2, 3.4, 0.4, -6.0, 1.7, 1.5, 'surface');
  box(0.4, 3.4, 6, -13.8, 1.7, -1.5, 'surface');        // office west wall
  box(0.4, 3.4, 2.4, -7.2, 1.7, -3.6, 'surface');       // doorway jambs to mid hall
  box(0.4, 3.4, 2.4, -4.6, 1.7, -3.6, 'surface');
  box(2.8, 3.4, 0.4, -9.6, 1.7, -4.6, 'surface');       // mid hall south wall
  glow(0.9, 0.12, 0.12, -9, 2.8, 1.28);                 // doorway strip light
  // Mid crates and a raised catwalk over the hall.
  box(1.8, 1.2, 1.8, -10.6, 0.6, -8.2, 'hairline');
  box(1.8, 1.2, 1.8, -8.6, 0.6, -8.2, 'hairline');
  box(1.8, 0.6, 1.8, -9.6, 1.5, -8.2, 'hairline');
  box(7.2, 0.4, 2.2, -9.6, 3.0, -7.4, 'hairline');      // catwalk slab
  box(0.4, 1.0, 2.2, -13.2, 3.6, -7.4, 'hairline');     // catwalk rails (low, vaultable)
  box(0.4, 1.0, 2.2, -6.0, 3.6, -7.4, 'hairline');
  glow(7.2, 0.08, 0.08, -9.6, 2.84, -8.5);

  // EAST LANE: long corridor with staggered cover, sightline from spawn to spawn.
  box(3.2, 3.4, 0.4, 14.4, 1.7, -4.2, 'surface');       // half wall blocks the straight sightline
  box(1.6, 1.1, 1.6, 15.0, 0.55, 4.6, 'hairline');
  box(1.6, 1.1, 1.6, 13.0, 0.55, 0.4, 'hairline');
  box(1.6, 1.1, 1.6, 15.4, 0.55, -8.8, 'hairline');
  box(1.6, 1.1, 1.6, 13.6, 0.55, 9.6, 'hairline');
  glow(0.12, 0.12, 9, 15.9, 2.6, 2);

  // WEST LANE: connectors and pillars between office and attacker spawn.
  box(1.4, 3.2, 1.4, -15.0, 1.6, 6.0, 'hairline');
  box(1.4, 3.2, 1.4, -15.0, 1.6, -0.2, 'hairline');
  box(2.6, 1.1, 1.2, -15.4, 0.55, 2.9, 'hairline');

  // DEFENDER SITE (north): the bombsite platform with the objective console and cover.
  box(10, 0.5, 8, 6, 0.25, -14, 'surface');             // raised site platform
  box(0.4, 1.0, 8, 11.2, 0.75, -14, 'hairline');        // site back rail
  box(2.6, 1.0, 1.2, 3.4, 0.75, -11.0, 'hairline');     // plant cover
  box(1.2, 2.2, 1.2, 8.4, 1.35, -15.4, 'hairline');     // console pillar
  glow(0.9, 0.5, 0.08, 8.4, 2.1, -14.78);               // site console screen
  box(1.8, 1.2, 1.8, 0.4, 0.6, -13.2, 'hairline');
  box(1.8, 1.2, 1.8, 2.2, 0.6, -13.2, 'hairline');
  glow(0.12, 0.12, 6, 6, 0.56, -14);

  // Attacker approach cover (south half).
  box(2.4, 1.1, 1.2, -3.0, 0.55, 9.0, 'hairline');
  box(2.4, 1.1, 1.2, 3.0, 0.55, 9.0, 'hairline');
  box(1.8, 1.2, 1.8, 5.8, 0.6, 13.0, 'hairline');
  box(1.4, 3.2, 1.4, 9.0, 1.6, 8.0, 'hairline');
  box(2.6, 1.1, 1.2, -10.6, 0.55, 13.0, 'hairline');

  // Ramp onto the site platform from mid.
  const ramp = box(3.0, 0.4, 4.6, 6, 0.4, -8.6, 'hairline');
  ramp.rotation.x = -0.19;
  colliders.pop();
  colliders.push(new THREE.Box3().setFromObject(ramp));

  // Light: dusk sky, a warm key sun low from the east, cool fill from the north, and amber
  // point lights that sell the glow strips without blooming.
  scene.add(new THREE.HemisphereLight(new THREE.Color('#4a5f7a'), new THREE.Color('#2a2118'), 1.35));

  const key = new THREE.DirectionalLight(new THREE.Color('#ffe6c4'), 2.6);
  key.position.set(14, 12, 6);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#8fa6c8'), 0.95);
  fill.position.set(-9, 8, -12);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(new THREE.Color('#f0a13c'), 0.7);
  rim.position.set(-4, 6, 18);
  scene.add(rim);

  const siteLamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 40, 16, 1.7);
  siteLamp.position.set(6, 3.2, -13);
  scene.add(siteLamp);
  const midLamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 14, 1.7);
  midLamp.position.set(-9, 2.8, 1.4);
  scene.add(midLamp);
  const spawnLamp = new THREE.PointLight(new THREE.Color('#7fb6d8'), 22, 14, 1.7);
  spawnLamp.position.set(0, 3.2, 15);
  scene.add(spawnLamp);

  // The objective: the payload console on the site (visual only; game logic owns the state).
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 1.1, 12), materials.hairline);
  pedestal.position.set(8.4, 0.55, -14);
  pedestal.castShadow = true;
  group.add(pedestal);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), glowMaterial);
  core.position.set(8.4, 1.5, -14);
  core.castShadow = true;
  group.add(core);

  return { colliders, shootables, group, objectiveCore: core };
}

// Mover spawn points: defenders hold the site, attackers start at the south spawn.
export const ATTACKER_SPAWNS = [
  [-2.0, 15.0],
  [2.0, 15.0],
  [-5.0, 13.0],
  [5.0, 13.0],
];
export const DEFENDER_SPAWNS = [
  [5.0, -15.5],
  [8.5, -15.5],
  [11.0, -14.0],
  [3.0, -14.0],
];
// The plant zone: a square on the site platform.
export const PLANT_ZONE = { x: 6, z: -14, radius: 3.2 };
