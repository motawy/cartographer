import { MARKER_END } from './claudemd-generator.js';

/**
 * Inject a Cartograph section into CLAUDE.md content.
 * If markers exist, replaces the content between them.
 * If no markers exist, appends the section at the end.
 */
export function injectSection(existingContent: string, section: string): string {
  const startIdx = existingContent.indexOf('<!-- CARTOGRAPH:START');
  const endIdx = existingContent.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existingContent.substring(0, startIdx);
    const after = existingContent.substring(endIdx + MARKER_END.length);
    return (before + section + after).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
  }

  // Append to end
  const trimmed = existingContent.replace(/\s+$/, '');
  const separator = trimmed.length > 0 ? '\n\n' : '';
  return trimmed + separator + section + '\n';
}
