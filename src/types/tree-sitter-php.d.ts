declare module 'tree-sitter-php' {
  import type { Language } from 'tree-sitter';
  const php: Language;
  const php_only: Language;
  export { php, php_only };
}
