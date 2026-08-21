import { describe, it, expect, beforeEach } from 'vitest';
import { LANDING_ID } from '../landing/id';
import { gateWasOpen, hideLanding, landingVisible, rememberGate, showLanding } from './landing';

beforeEach(() => {
  document.body.innerHTML = `<div id="${LANDING_ID}"></div><div id="root"></div>`;
  localStorage.clear();
});

describe('landing curtain', () => {
  it('starts visible — that is how the document is served', () => {
    expect(landingVisible()).toBe(true);
  });

  it('hides and shows again', () => {
    hideLanding();
    expect(landingVisible()).toBe(false);
    showLanding();
    expect(landingVisible()).toBe(true);
  });

  // Component tests mount into a bare document. Nothing here is worth
  // throwing over.
  it('does nothing when the page is not on the document', () => {
    document.body.innerHTML = '';
    expect(() => { hideLanding(); showLanding(); }).not.toThrow();
    expect(landingVisible()).toBe(false);
  });
});

describe('remembered gate answer', () => {
  it('is false until an invite has been seen', () => {
    expect(gateWasOpen()).toBe(false);
  });

  it('round-trips, and is cleared when the invite stops working', () => {
    rememberGate(true);
    expect(gateWasOpen()).toBe(true);
    rememberGate(false);
    expect(gateWasOpen()).toBe(false);
  });
});
