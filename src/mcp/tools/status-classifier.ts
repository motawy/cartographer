export interface UnresolvedReferenceRow {
  sourcePath: string;
  targetQualifiedName: string;
  referenceKind: string;
}

export type UnresolvedCategory =
  | 'test_framework'
  | 'php_builtin'
  | 'generated_cache'
  | 'test_only'
  | 'external_vendor'
  | 'potential_internal_miss'
  | 'static_self'
  | 'unknown';

export interface UnresolvedAnalysis {
  counts: Map<UnresolvedCategory, number>;
  potentialInternalCount: number;
  productionPotentialInternalCount: number;
}

const TEST_FRAMEWORK_PATTERNS = [
  /^phake(?:::|\\|$)/i,
  /^phpunit(?:::|\\|$)/i,
  /^mockery(?:::|\\|$)/i,
  /^m::/i,
];

const PHP_BUILTIN_CLASSES = new Set([
  'arrayaccess',
  'arrayiterator',
  'arrayobject',
  'backedenum',
  'badmethodcallexception',
  'callbackfilteriterator',
  'cachingiterator',
  'closure',
  'countable',
  'dateinterval',
  'datetime',
  'datetimeimmutable',
  'datetimezone',
  'directory',
  'directoryiterator',
  'domainexception',
  'domattr',
  'domcdatasection',
  'domcharacterdata',
  'domcomment',
  'domdocument',
  'domelement',
  'domentity',
  'domentityreference',
  'domexception',
  'domimplementation',
  'domnamednodemap',
  'domnode',
  'domnodelist',
  'domnotation',
  'domprocessinginstruction',
  'domtext',
  'domxpath',
  'emptyiterator',
  'exception',
  'filteriterator',
  'filesystemiterator',
  'globiterator',
  'generator',
  'imagick',
  'imagickexception',
  'invalidargumentexception',
  'iterator',
  'iteratoraggregate',
  'iteratoriterator',
  'jsonexception',
  'jsonserializable',
  'limititerator',
  'logicexception',
  'multipleiterator',
  'norewinditerator',
  'outofboundsexception',
  'oauthexception',
  'outeriterator',
  'pdo',
  'redis',
  'redisarray',
  'rediscluster',
  'redissentinel',
  'recursivearrayiterator',
  'recursivedirectoryiterator',
  'recursivefilteriterator',
  'recursiveiterator',
  'recursiveiteratoriterator',
  'reflection',
  'reflectionclass',
  'reflectionexception',
  'reflectionmethod',
  'reflectionobject',
  'reflectionproperty',
  'regexiterator',
  'runtimeexception',
  'seekableiterator',
  'serializable',
  'soapclient',
  'soapfault',
  'soapheader',
  'soapparam',
  'soapserver',
  'soapvar',
  'simplexmlelement',
  'splfileinfo',
  'splobjectstorage',
  'spltempfileobject',
  'stdclass',
  'stringable',
  'throwable',
  'traversable',
  'unitenum',
  'unexpectedvalueexception',
  'ziparchive',
]);

const STATIC_SELF_CLASSES = new Set(['parent', 'self', 'static']);

export function analyzeUnresolvedReferences(
  rows: UnresolvedReferenceRow[],
  internalPrefixes: Set<string>
): UnresolvedAnalysis {
  const counts = new Map<UnresolvedCategory, number>();
  let potentialInternalCount = 0;
  let productionPotentialInternalCount = 0;

  for (const row of rows) {
    const category = classifyUnresolvedReference(row, internalPrefixes);
    counts.set(category, (counts.get(category) || 0) + 1);

    if (category === 'potential_internal_miss' || category === 'unknown') {
      potentialInternalCount++;
      if (isProductionLikePath(row.sourcePath)) {
        productionPotentialInternalCount++;
      }
    }
  }

  return {
    counts,
    potentialInternalCount,
    productionPotentialInternalCount,
  };
}

export function formatUnresolvedCategory(category: UnresolvedCategory): string {
  switch (category) {
    case 'test_framework':
      return 'Test framework / mocks';
    case 'php_builtin':
      return 'PHP builtins';
    case 'generated_cache':
      return 'Generated cache';
    case 'test_only':
      return 'Test-only references';
    case 'external_vendor':
      return 'External vendor / framework';
    case 'potential_internal_miss':
      return 'Potential internal / cross-repo gaps';
    case 'static_self':
      return 'self/static/parent pseudo-types';
    case 'unknown':
      return 'Unknown unresolved';
  }
}

export function isProductionLikePath(path: string): boolean {
  return !path.startsWith('tests/') && !path.startsWith('cache/');
}

function classifyUnresolvedReference(
  row: UnresolvedReferenceRow,
  internalPrefixes: Set<string>
): UnresolvedCategory {
  const target = row.targetQualifiedName.toLowerCase();
  const classPart = extractClassPart(target);
  const classLeaf = extractLeafName(classPart);
  const prefix = extractPrefix(target);

  if (row.sourcePath.startsWith('cache/')) {
    return 'generated_cache';
  }

  if (matchesAny(target, TEST_FRAMEWORK_PATTERNS)) {
    return 'test_framework';
  }

  if (STATIC_SELF_CLASSES.has(classLeaf)) {
    return 'static_self';
  }

  if (isPhpBuiltin(target, classLeaf, prefix)) {
    return 'php_builtin';
  }

  if (row.sourcePath.startsWith('tests/')) {
    return 'test_only';
  }

  if (prefix && !internalPrefixes.has(prefix)) {
    return 'external_vendor';
  }

  if (prefix && internalPrefixes.has(prefix)) {
    return 'potential_internal_miss';
  }

  if (!prefix && classPart.length > 0) {
    return 'potential_internal_miss';
  }

  return 'unknown';
}

function extractClassPart(target: string): string {
  const scopeIdx = target.indexOf('::');
  return scopeIdx === -1 ? target : target.substring(0, scopeIdx);
}

function extractLeafName(classPart: string): string {
  const backslashIdx = classPart.lastIndexOf('\\');
  return backslashIdx === -1 ? classPart : classPart.substring(backslashIdx + 1);
}

function extractPrefix(target: string): string | null {
  const backslashIdx = target.indexOf('\\');
  if (backslashIdx <= 0) return null;
  return target.substring(0, backslashIdx);
}

function isPhpBuiltin(
  target: string,
  classLeaf: string,
  prefix: string | null
): boolean {
  if (!prefix && PHP_BUILTIN_CLASSES.has(classLeaf)) {
    return true;
  }

  if (!prefix && target.startsWith('pdo::')) {
    return true;
  }

  return false;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}
