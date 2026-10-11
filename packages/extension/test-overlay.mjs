import assert from 'node:assert/strict';
import test from 'node:test';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.style = {};
    this.isConnected = false;
    this.className = '';
    this.textContent = '';
  }

  append(...children) {
    children.forEach((child) => { this.appendChild(child); });
  }

  appendChild(child) {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    event.target = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }

  remove() {
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
    this.isConnected = false;
  }
}

test('overlay buttons invoke actions and remove the overlay', async () => {
  const document = {
    head: new FakeElement('head'),
    documentElement: new FakeElement('html'),
    createElement: (tagName) => new FakeElement(tagName),
  };
  document.head.isConnected = true;
  document.documentElement.isConnected = true;
  const previous = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ position: 'static' });

  try {
    const { showOverlay } = await import('./overlay.js');
    const host = new FakeElement('section');
    host.isConnected = true;
    let action;
    const overlay = showOverlay(host, {
      onResume: () => { action = 'resume'; },
      onSkip: () => { action = 'skip'; },
    });
    const buttons = host.children[0].children[2].children;
    const event = {
      type: 'click',
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    };

    buttons[0].dispatchEvent(event);

    assert.equal(action, 'resume');
    assert.equal(host.children.length, 0);
    overlay.remove();
  } finally {
    globalThis.document = previous.document;
    globalThis.getComputedStyle = previous.getComputedStyle;
  }
});
