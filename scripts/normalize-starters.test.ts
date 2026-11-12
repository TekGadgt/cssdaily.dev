import { describe, expect, it } from 'vitest';
import { planRow } from './normalize-starters';

const body = (css: string) => JSON.stringify({ starter: { html: '<p class="x"></p>', css }, target: { html: '<p class="x"></p>', css: '.x { color: red; }' } });

describe('planRow', () => {
  it('rewrites only starter.css, keeping key order and everything else', () => {
    const plan = planRow({ date: '2026-11-11', difficulty: 'hard', body: body(':root {\n  --a: 1;\n}\n.x {}') })!;
    const next = JSON.parse(plan.newBody);
    expect(next.starter.css).toBe(':root {\n  --a: 1;\n}\n\n.x {\n\n}\n');
    expect(Object.keys(next)).toEqual(['starter', 'target']);
    expect(Object.keys(next.starter)).toEqual(['html', 'css']);
    expect(next.target).toEqual(JSON.parse(plan.oldBody).target);
  });

  it('returns null when already canonical', () => {
    expect(planRow({ date: '2026-11-11', difficulty: 'easy', body: body('.x {\n\n}\n') })).toBeNull();
  });

  it('reports a dropped stray brace', () => {
    expect(planRow({ date: '2026-10-28', difficulty: 'medium', body: body('.x {\n}\n}') })!.strayBraces).toBe(1);
  });
});
