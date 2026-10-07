'use strict';
(() => {
  /** Right-click opens the image action; dragging still pans the existing canvas. */
  globalThis.AssetImageMenu = Object.freeze({
    attach(canvas, { hasImage, isFlipped, onFlip }) {
      const menu = document.createElement('div');
      menu.className = 'image-context-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Imagem');
      menu.hidden = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Inverter';
      button.title = 'Espelhar a imagem horizontalmente';
      button.setAttribute('role', 'menuitemcheckbox');
      menu.appendChild(button);
      document.body.appendChild(menu);
      let start = null, moved = false;
      const close = () => { menu.hidden = true; };
      document.addEventListener('pointerdown', (event) => {
        if (!menu.contains(event.target)) close();
      }, true);
      canvas.addEventListener('pointerdown', (event) => {
        start = event.button === 2 ? { x: event.clientX, y: event.clientY } : null;
        moved = false;
      });
      canvas.addEventListener('pointermove', (event) => {
        if (!start || !(event.buttons & 2)) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
          moved = true;
          close();
        }
      });
      canvas.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (moved) return;
        button.disabled = !hasImage();
        button.setAttribute('aria-checked', String(isFlipped()));
        menu.hidden = false;
        menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8))}px`;
        if (!button.disabled) button.focus();
      });
      button.addEventListener('click', () => {
        if (!hasImage()) return;
        onFlip();
        close();
        canvas.focus();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || menu.hidden) return;
        close();
        canvas.focus();
      });
      window.addEventListener('resize', close);
      window.addEventListener('blur', close);
      document.addEventListener('scroll', close, true);
    },
  });
})();
