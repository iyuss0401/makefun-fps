// Player movement: acceleration, friction, gravity, crouch, jump and a shallow ramp step,
// resolved as a box against the world's colliders one axis at a time. Both the local player
// and the bots use this mover.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export const PLAYER_CONST = { RADIUS, STAND_HEIGHT, STAND_EYE };

export function createMover(colliders) {
  const position = new THREE.Vector3(0, 0, 0);
  const velocity = new THREE.Vector3();
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();
  const self = {
    position, velocity,
    yaw: 0, pitch: 0,
    eye: STAND_EYE, height: STAND_HEIGHT,
    onGround: true, crouching: false,
  };
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    self.yaw -= dx * sensitivity;
    self.pitch = Math.max(-1.45, Math.min(1.45, self.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    self.pitch = Math.min(1.45, self.pitch + pitchKick);
    self.yaw += yawKick;
  }

  function step(dt, keys, moveScale = 1) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !self.crouching) {
      self.crouching = true;
      self.height = CROUCH_HEIGHT;
    } else if (!crouching && self.crouching && !overlaps(position.x, position.y, position.z, STAND_HEIGHT, 0.02)) {
      self.crouching = false;
      self.height = STAND_HEIGHT;
    }
    const eyeTarget = self.crouching ? CROUCH_EYE : STAND_EYE;
    self.eye += (eyeTarget - self.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(self.yaw);
      const cos = Math.cos(self.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = (self.crouching ? CROUCH_SPEED : WALK_SPEED) * moveScale;
    const blend = Math.min(1, ((self.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / Math.max(0.001, speed));
    velocity.x += (wish.x * speed - velocity.x) * blend;
    velocity.z += (wish.z * speed - velocity.z) * blend;
    if (self.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      velocity.x *= damp;
      velocity.z *= damp;
    }

    if (keys.has('Space') && self.onGround) {
      velocity.y = JUMP_SPEED;
      self.onGround = false;
    }
    velocity.y -= GRAVITY * dt;

    const nextX = position.x + velocity.x * dt;
    if (!overlaps(nextX, position.y, position.z, self.height, 0.04)) position.x = nextX;
    else velocity.x = 0;
    const nextZ = position.z + velocity.z * dt;
    if (!overlaps(position.x, position.y, nextZ, self.height, 0.04)) position.z = nextZ;
    else velocity.z = 0;

    position.y += velocity.y * dt;
    self.onGround = false;
    const hit = overlaps(position.x, position.y, position.z, self.height, 0);
    if (hit && velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      self.onGround = true;
    } else if (hit) {
      position.y = hit.min.y - self.height;
      velocity.y = 0;
    }
    if (position.y < 0) {
      position.y = 0;
      velocity.y = 0;
      self.onGround = true;
    }
    velocity.y = Math.max(-30, velocity.y);
  }

  return {
    self,
    position,
    velocity,
    step,
    look,
    recoil,
    overlaps,
    groundSpeed() {
      return Math.hypot(velocity.x, velocity.z);
    },
  };
}
