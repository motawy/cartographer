import { describe, it, expect } from 'vitest';
import { generateConventions } from '../../src/output/conventions-generator.js';
import type { ConventionsData } from '../../src/output/generate-pipeline.js';

function makeConventions(overrides: Partial<ConventionsData> = {}): ConventionsData {
  return {
    totalClasses: 100,
    totalInterfaces: 20,
    totalTraits: 10,
    totalEnums: 0,
    classesWithInterface: 45,
    classesWithInheritance: 60,
    classesWithTraits: 15,
    interfaceAdoptionByModule: new Map([
      ['app/Services', { total: 30, withInterface: 28 }],
      ['app/Models', { total: 40, withInterface: 0 }],
      ['app/Repositories', { total: 20, withInterface: 18 }],
    ]),
    classNames: ['UserService', 'OrderModel', 'PaymentController', 'fooBar'],
    methodNames: ['findById', 'createUser', '__construct', 'GetData'],
    ...overrides,
  };
}

describe('generateConventions', () => {
  it('shows symbol composition', () => {
    const result = generateConventions(makeConventions());
    expect(result).toContain('**Classes:** 100');
    expect(result).toContain('**Interfaces:** 20');
    expect(result).toContain('**Traits:** 10');
  });

  it('hides enums when zero', () => {
    const result = generateConventions(makeConventions());
    expect(result).not.toContain('**Enums:**');
  });

  it('shows enums when present', () => {
    const result = generateConventions(makeConventions({ totalEnums: 5 }));
    expect(result).toContain('**Enums:** 5');
  });

  it('calculates structural pattern percentages', () => {
    const result = generateConventions(makeConventions());
    expect(result).toContain('**45%** of classes implement at least one interface');
    expect(result).toContain('**60%** of classes extend another class');
    expect(result).toContain('**15%** of classes use at least one trait');
  });

  it('shows interface adoption by module', () => {
    const result = generateConventions(makeConventions());
    expect(result).toContain('app/Services');
    expect(result).toContain('93%'); // 28/30
    expect(result).toContain('app/Models');
    expect(result).toContain('0%'); // 0/40
  });

  it('filters small modules from adoption table', () => {
    const result = generateConventions(makeConventions({
      interfaceAdoptionByModule: new Map([
        ['app/Tiny', { total: 2, withInterface: 1 }],
        ['app/Big', { total: 10, withInterface: 8 }],
      ]),
    }));
    expect(result).not.toContain('app/Tiny');
    expect(result).toContain('app/Big');
  });

  it('detects naming conventions', () => {
    const result = generateConventions(makeConventions());
    expect(result).toContain('PascalCase');
    expect(result).toContain('camelCase');
  });

  it('detects magic methods', () => {
    const result = generateConventions(makeConventions());
    expect(result).toContain('Magic methods');
    expect(result).toContain('1 found in sample');
  });

  it('handles zero classes gracefully', () => {
    const result = generateConventions(makeConventions({ totalClasses: 0 }));
    expect(result).toContain('**Classes:** 0');
    expect(result).not.toContain('% of classes implement');
  });
});
