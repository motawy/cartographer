import { describe, expect, it } from 'vitest';
import { analyzeUnresolvedReferences } from '../../src/mcp/tools/status-classifier.js';

describe('status-classifier', () => {
  it('classifies common PHP and extension globals as php_builtin', () => {
    const result = analyzeUnresolvedReferences([
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'DOMXPath', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'DOMNode', referenceKind: 'type_hint' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'DOMElement', referenceKind: 'type_hint' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'Imagick', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'Redis', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'SoapClient', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'JsonSerializable', referenceKind: 'implementation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'IteratorAggregate', referenceKind: 'implementation' },
    ], new Set(['app', 'simpro']));

    expect(result.counts.get('php_builtin')).toBe(8);
    expect(result.potentialInternalCount).toBe(0);
  });

  it('treats leaked namespaced self/static/parent targets as pseudo-types', () => {
    const result = analyzeUnresolvedReferences([
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'simpro\\restapi\\dataobject\\static', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'simpro\\callcentre\\events\\self', referenceKind: 'instantiation' },
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'simpro\\core\\base\\parent', referenceKind: 'instantiation' },
    ], new Set(['app', 'simpro']));

    expect(result.counts.get('static_self')).toBe(3);
    expect(result.potentialInternalCount).toBe(0);
  });

  it('does not misclassify namespaced internal classes that happen to end with builtin names', () => {
    const result = analyzeUnresolvedReferences([
      { sourcePath: 'src/Foo.php', targetQualifiedName: 'app\\services\\datetime', referenceKind: 'instantiation' },
    ], new Set(['app', 'simpro']));

    expect(result.counts.get('potential_internal_miss')).toBe(1);
    expect(result.counts.get('php_builtin')).toBeUndefined();
  });
});
