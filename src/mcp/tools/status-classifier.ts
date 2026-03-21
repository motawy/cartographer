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
  'arithmeticerror',
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
  'datetimeinterface',
  'datetimezone',
  'dateperiod',
  'directory',
  'directoryiterator',
  'divisionbyzeroerror',
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
  'error',
  'errorexception',
  'exception',
  'filteriterator',
  'filesystemiterator',
  'globiterator',
  'generator',
  'imagick',
  'imagickdraw',
  'imagickexception',
  'imagickpixel',
  'invalidargumentexception',
  'iterator',
  'iteratoraggregate',
  'iteratoriterator',
  'jsonexception',
  'jsonserializable',
  'lengthexception',
  'limititerator',
  'logicexception',
  'multipleiterator',
  'norewinditerator',
  'outofboundsexception',
  'outofrangeexception',
  'oauthexception',
  'outeriterator',
  'overflowexception',
  'pdo',
  'pdostatement',
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
  'reflectionfunction',
  'reflectionmethod',
  'reflectionobject',
  'reflectionparameter',
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
  'splfileobject',
  'splobjectstorage',
  'spltempfileobject',
  'stdclass',
  'stringable',
  'throwable',
  'tidy',
  'traversable',
  'typeerror',
  'underflowexception',
  'unexpectedvalueexception',
  'unitenum',
  'valueerror',
  'xmlreader',
  'xmlwriter',
  'xsltprocessor',
  'ziparchive',
]);

// Vendor namespace prefixes that may coincidentally match internal prefix names
// or that aren't caught by the internalPrefixes heuristic.
const VENDOR_NAMESPACE_PREFIXES = new Set([
  'aws',
  'barryvdh',
  'carbon',
  'ddtrace',
  'doctrine',
  'ezcgraph',
  'faker',
  'fakerphp',
  'firebase',
  'google',
  'growthbook',
  'guzzlehttp',
  'illuminate',
  'intervention',
  'jumbojett',
  'laravel',
  'league',
  'maatwebsite',
  'microsoft',
  'monolog',
  'ndm',
  'negotiation',
  'nesbot',
  'nette',
  'nikic',
  'psr',
  'psr7middlewares',
  'phpseclib',
  'quickbooksonline',
  'ramsey',
  'respect',
  'setasign',
  'simplejwt',
  'slim',
  'spatie',
  'square',
  'stripe',
  'swagger',
  'swagflow',
  'symfony',
  'twig',
  'vlucas',
  'webmozart',
  'zipstream',
  'zpt',
]);

// Global (no-namespace) classes from third-party libraries
const VENDOR_GLOBAL_CLASSES = new Set([
  'font_metrics',
  'pdfstyle',
  'fpdi',
  'tcpdf',
  'dompdf',
  'ezcgrapharraydataset',
  'ezcgraphrenderer3d',
  'ezcgraphpiechart',
  'ezcgraphhorizontalbarchart',
  'ezcgraphbarchart',
  'transformdocadvopenoffice',
  'transformdocadvlibreoffice',
  'beforevalidexception',
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

  // Known vendor namespace prefixes (catches libs that might share a prefix
  // with internal code, e.g. 'info', 'log')
  if (prefix && VENDOR_NAMESPACE_PREFIXES.has(prefix)) {
    return 'external_vendor';
  }

  // Known vendor global classes (no namespace)
  if (!prefix && VENDOR_GLOBAL_CLASSES.has(classPart)) {
    return 'external_vendor';
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
  // Global builtin: e.g. "datetime", "exception"
  if (!prefix && PHP_BUILTIN_CLASSES.has(classLeaf)) {
    return true;
  }

  // PDO constants: e.g. "pdo::fetch_assoc"
  if (!prefix && target.startsWith('pdo::')) {
    return true;
  }

  return false;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}
