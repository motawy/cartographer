import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import PHP from 'tree-sitter-php';
import { extractReferences } from '../../src/indexer/reference-extractor.js';
import { parsePHP, type NamespaceContext } from '../../src/indexer/parsers/php.js';

let parser: Parser;

beforeAll(() => {
  parser = new Parser();
  parser.setLanguage(PHP.php);
});

function parseAndExtract(source: string) {
  const tree = parser.parse(source);
  const parseResult = parsePHP(tree);
  const context: NamespaceContext = {
    namespace: parseResult.namespace,
    imports: parseResult.imports,
  };
  return extractReferences(tree, context, parseResult.symbols);
}

describe('ReferenceExtractor', () => {
  describe('inheritance', () => {
    it('extracts extends reference', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Models;
        use Illuminate\\Database\\Eloquent\\Model;
        class User extends Model {}
      `);

      const inheritance = refs.filter(r => r.kind === 'inheritance');
      expect(inheritance).toHaveLength(1);
      expect(inheritance[0].sourceQualifiedName).toBe('App\\Models\\User');
      expect(inheritance[0].targetQualifiedName).toBe('illuminate\\database\\eloquent\\model');
    });

    it('extracts implements references', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Contracts\\UserServiceInterface;
        class UserService implements UserServiceInterface {}
      `);

      const impls = refs.filter(r => r.kind === 'implementation');
      expect(impls).toHaveLength(1);
      expect(impls[0].targetQualifiedName).toBe('app\\contracts\\userserviceinterface');
    });

    it('extracts trait use references', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Models;
        use App\\Traits\\HasTimestamps;
        class User {
            use HasTimestamps;
        }
      `);

      const traits = refs.filter(r => r.kind === 'trait_use');
      expect(traits).toHaveLength(1);
      expect(traits[0].targetQualifiedName).toBe('app\\traits\\hastimestamps');
      expect(traits[0].sourceQualifiedName).toBe('App\\Models\\User');
    });

    it('extracts multiple implements', () => {
      const refs = parseAndExtract(`<?php
        namespace App;
        use App\\Contracts\\Loggable;
        use App\\Contracts\\Cacheable;
        class Foo implements Loggable, Cacheable {}
      `);

      const impls = refs.filter(r => r.kind === 'implementation');
      expect(impls).toHaveLength(2);
    });
  });

  describe('type hints', () => {
    it('extracts parameter type hints', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Repositories;
        use App\\Models\\User;
        class UserRepository {
            public function update(User $user, array $data): User {
                return $user;
            }
        }
      `);

      const hints = refs.filter(r => r.kind === 'type_hint');
      expect(hints).toHaveLength(2);
      expect(hints.every(h => h.targetQualifiedName === 'app\\models\\user')).toBe(true);
      expect(hints[0].sourceQualifiedName).toBe('App\\Repositories\\UserRepository::update');
    });

    it('extracts property type hints', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Repositories\\UserRepository;
        class UserService {
            private UserRepository $userRepo;
        }
      `);

      const hints = refs.filter(r => r.kind === 'type_hint');
      expect(hints).toHaveLength(1);
      expect(hints[0].sourceQualifiedName).toBe('App\\Services\\UserService');
      expect(hints[0].targetQualifiedName).toBe('app\\repositories\\userrepository');
    });

    it('extracts promoted property type hints', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Http\\Controllers;
        use App\\Services\\UserService;
        class UserController {
            public function __construct(
                private readonly UserService $userService
            ) {}
        }
      `);

      const hints = refs.filter(r => r.kind === 'type_hint');
      expect(hints).toHaveLength(1);
      expect(hints[0].targetQualifiedName).toBe('app\\services\\userservice');
    });

    it('skips builtin types', () => {
      const refs = parseAndExtract(`<?php
        namespace App;
        class Foo {
            public function bar(int $id, string $name, bool $active): void {}
        }
      `);

      const hints = refs.filter(r => r.kind === 'type_hint');
      expect(hints).toHaveLength(0);
    });

    it('extracts nullable type hints', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Models\\User;
        class UserService {
            public function find(int $id): ?User {
                return null;
            }
        }
      `);

      const hints = refs.filter(r => r.kind === 'type_hint');
      expect(hints).toHaveLength(1);
      expect(hints[0].targetQualifiedName).toBe('app\\models\\user');
    });
  });

  describe('instantiation', () => {
    it('extracts new ClassName()', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Repositories\\UserRepository;
        class UserService {
            public function init(): void {
                $repo = new UserRepository();
            }
        }
      `);

      const insts = refs.filter(r => r.kind === 'instantiation');
      expect(insts).toHaveLength(1);
      expect(insts[0].sourceQualifiedName).toBe('App\\Services\\UserService::init');
      expect(insts[0].targetQualifiedName).toBe('app\\repositories\\userrepository');
    });

    it('resolves imported global classes from single-segment use statements', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use DateTime;
        class UserService {
            public function init(): void {
                $date = new DateTime();
                DateTime::createFromFormat('Y-m-d', '2024-01-01');
            }
        }
      `);

      const insts = refs.filter(r => r.kind === 'instantiation');
      const statics = refs.filter(r => r.kind === 'static_call');

      expect(insts).toHaveLength(1);
      expect(insts[0].targetQualifiedName).toBe('datetime');
      expect(statics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetQualifiedName: 'datetime::createfromformat' }),
        ])
      );
    });

    it('keeps unimported class names in the current namespace', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        class UserService {
            public function init(): void {
                $date = new DateTime();
            }
        }
      `);

      const insts = refs.filter(r => r.kind === 'instantiation');
      expect(insts).toHaveLength(1);
      expect(insts[0].targetQualifiedName).toBe('app\\services\\datetime');
    });
  });

  describe('static calls', () => {
    it('extracts ClassName::method()', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Repositories;
        use App\\Models\\User;
        class UserRepository {
            public function find(int $id): ?User {
                return User::find($id);
            }
        }
      `);

      const statics = refs.filter(r => r.kind === 'static_call');
      expect(statics).toHaveLength(1);
      expect(statics[0].sourceQualifiedName).toBe('App\\Repositories\\UserRepository::find');
      expect(statics[0].targetQualifiedName).toBe('app\\models\\user::find');
    });

    it('resolves single-segment global imports in static calls', () => {
      const refs = parseAndExtract(`<?php
        namespace Simpro\\Core\\Controller\\ContractorJob;
        use F;
        use Console;
        use ContractorJob;
        class Example {
            public function run(): void {
                F::filterParam();
                Console::log();
                ContractorJob::dispatch();
            }
        }
      `);

      const statics = refs.filter(r => r.kind === 'static_call');
      expect(statics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetQualifiedName: 'f::filterparam' }),
          expect.objectContaining({ targetQualifiedName: 'console::log' }),
          expect.objectContaining({ targetQualifiedName: 'contractorjob::dispatch' }),
        ])
      );
    });

    it('skips self:: and static:: calls', () => {
      const refs = parseAndExtract(`<?php
        namespace App;
        class Foo {
            public function bar(): void {
                self::baz();
                static::qux();
            }
            public static function baz(): void {}
            public static function qux(): void {}
        }
      `);

      const statics = refs.filter(r => r.kind === 'static_call');
      expect(statics).toHaveLength(0);
    });
  });

  describe('static access', () => {
    it('extracts ClassName::CONST', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Models\\User;
        class StatusService {
            public function getDefault(): string {
                return User::STATUS_ACTIVE;
            }
        }
      `);

      const access = refs.filter(r => r.kind === 'static_access');
      expect(access).toHaveLength(1);
      expect(access[0].targetQualifiedName).toBe('app\\models\\user::status_active');
    });
  });

  describe('self calls', () => {
    it('extracts $this->method()', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        class UserService {
            public function update(int $id): void {
                $user = $this->findById($id);
            }
            public function findById(int $id): void {}
        }
      `);

      const selfCalls = refs.filter(r => r.kind === 'self_call');
      expect(selfCalls).toHaveLength(1);
      expect(selfCalls[0].sourceQualifiedName).toBe('App\\Services\\UserService::update');
      expect(selfCalls[0].targetQualifiedName).toBe('app\\services\\userservice::findbyid');
    });

    it('lowercases self_call target qualified names', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        class UserService {
            public function update(int $id): void {
                $user = $this->findById($id);
            }
            public function findById(int $id): void {}
        }
      `);

      const selfCalls = refs.filter(r => r.kind === 'self_call');
      expect(selfCalls[0].targetQualifiedName).toBe('app\\services\\userservice::findbyid');
      // Source stays original case
      expect(selfCalls[0].sourceQualifiedName).toBe('App\\Services\\UserService::update');
    });

    it('does not extract $this->property access as self_call', () => {
      const refs = parseAndExtract(`<?php
        namespace App;
        class Foo {
            private int $count;
            public function bar(): int {
                return $this->count;
            }
        }
      `);

      const selfCalls = refs.filter(r => r.kind === 'self_call');
      expect(selfCalls).toHaveLength(0);
    });
  });

  describe('case normalization', () => {
    it('lowercases target qualified names', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Models;
        use Illuminate\\Database\\Eloquent\\Model;
        class User extends Model {}
      `);

      const inheritance = refs.filter(r => r.kind === 'inheritance');
      expect(inheritance[0].targetQualifiedName).toBe('illuminate\\database\\eloquent\\model');
    });

    it('lowercases instantiation targets', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Repositories\\UserRepository;
        class UserService {
            public function init(): void {
                $repo = new UserRepository();
            }
        }
      `);

      const insts = refs.filter(r => r.kind === 'instantiation');
      expect(insts[0].targetQualifiedName).toBe('app\\repositories\\userrepository');
    });

    it('preserves source qualified name case', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Models;
        use Illuminate\\Database\\Eloquent\\Model;
        class User extends Model {}
      `);

      const inheritance = refs.filter(r => r.kind === 'inheritance');
      expect(inheritance[0].sourceQualifiedName).toBe('App\\Models\\User');
    });
  });

  describe('class references (::class)', () => {
    it('extracts ::class as class_reference', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Routes;
        use App\\Controllers\\UserController;
        class UserRoute {
          public function getControllerName(): string {
            return UserController::class;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(1);
      expect(classRefs[0].sourceQualifiedName).toBe('App\\Routes\\UserRoute::getControllerName');
      expect(classRefs[0].targetQualifiedName).toBe('app\\controllers\\usercontroller');
      expect(classRefs[0].line).toBeGreaterThan(0);
    });

    it('resolves ::class through namespace imports', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Routes;
        use App\\Builders\\CostCenters\\RecurringJobCostCenters as CostCenterBuilder;
        class SomeRoute {
          public function getBuilderName(): string {
            return CostCenterBuilder::class;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(1);
      expect(classRefs[0].targetQualifiedName).toBe('app\\builders\\costcenters\\recurringjobcostcenters');
    });

    it('handles qualified ::class without import', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Routes;
        class SomeRoute {
          public function getModelName(): string {
            return \\App\\Models\\User::class;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(1);
      expect(classRefs[0].targetQualifiedName).toBe('app\\models\\user');
    });

    it('does not extract self::class or static::class', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        class UserService {
          public function getClassName(): string {
            return self::class;
          }
          public function getStaticName(): string {
            return static::class;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(0);
    });

    it('does not treat regular constants as class_reference', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Services;
        use App\\Models\\User;
        class UserService {
          public function getStatus(): string {
            return User::STATUS_ACTIVE;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(0);
      // Should still be captured as static_access
      const staticAccess = refs.filter(r => r.kind === 'static_access');
      expect(staticAccess).toHaveLength(1);
    });

    it('extracts multiple ::class references in one method', () => {
      const refs = parseAndExtract(`<?php
        namespace App\\Routes;
        use App\\Controllers\\UserController;
        use App\\Builders\\UserBuilder;
        class UserRoute {
          public function setup(): void {
            $this->controller = UserController::class;
            $this->builder = UserBuilder::class;
          }
        }
      `);

      const classRefs = refs.filter(r => r.kind === 'class_reference');
      expect(classRefs).toHaveLength(2);
      const targets = classRefs.map(r => r.targetQualifiedName).sort();
      expect(targets).toEqual([
        'app\\builders\\userbuilder',
        'app\\controllers\\usercontroller',
      ]);
    });
  });
});
