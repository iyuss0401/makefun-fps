// Keyboard, mouse, pointer lock, weapon switching, buy menu and grenade keys. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it holds it.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = {
    keys, locked: false, firing: false, lookX: 0, lookY: 0,
    reloadPressed: false, switchPressed: 0, grenadePressed: 0,
    buyPressed: false, plantPressed: false, usePressed: false,
  };

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => {
    setKey(event, true);
    if (!state.locked) return;
    if (event.code === 'KeyR') state.reloadPressed = true;
    if (event.code === 'KeyG') state.grenadePressed = 1;
    if (event.code === 'KeyF') state.grenadePressed = 2;
    if (event.code === 'KeyB') state.buyPressed = true;
    if (event.code === 'KeyE') state.usePressed = true;
    if (event.code === 'Digit1') state.switchPressed = 1;
    if (event.code === 'Digit2') state.switchPressed = 2;
    if (event.code === 'KeyX') state.plantPressed = true;
  });
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    consumeActions() {
      const actions = {
        reload: state.reloadPressed,
        switchTo: state.switchPressed,
        grenade: state.grenadePressed,
        buy: state.buyPressed,
        plant: state.plantPressed,
        use: state.usePressed,
      };
      state.reloadPressed = false;
      state.switchPressed = 0;
      state.grenadePressed = 0;
      state.buyPressed = false;
      state.plantPressed = false;
      state.usePressed = false;
      return actions;
    },
  };
}
