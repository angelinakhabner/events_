import { describe, it, expect, beforeEach } from 'vitest';
import { LANDING_ID } from '../landing/id';
import { hideLanding, landingVisible } from './landing';

beforeEach(() => {
  document.body.innerHTML = `<div id="${LANDING_ID}"></div><div id="root"></div>`;
});

describe('landing curtain', () => {
  it('starts visible — that is how the document is served', () => {
    expect(landingVisible()).toBe(true);
  });

  it('hides, and stays hidden — the app is for everyone now', () => {
    hideLanding();
    expect(landingVisible()).toBe(false);
    hideLanding();
    expect(landingVisible()).toBe(false);
  });

  // Component tests mount into a bare document. Nothing here is worth
  // throwing over.
  it('does nothing when the page is not on the document', () => {
    document.body.innerHTML = '';
    expect(() => hideLanding()).not.toThrow();
    expect(landingVisible()).toBe(false);
  });
});
