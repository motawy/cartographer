import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import ignore from 'ignore';
import fg from 'fast-glob';
import type { DiscoveredFile, CartographConfig } from '../types.js';

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.php': 'php',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.go': 'go',
};

export function discoverFiles(
  repoPath: string,
  config: CartographConfig
): DiscoveredFile[] {
  const allowedExtensions = new Set(
    Object.entries(LANGUAGE_EXTENSIONS)
      .filter(([, lang]) => config.languages.includes(lang))
      .map(([ext]) => ext)
  );

  if (allowedExtensions.size === 0) {
    return [];
  }

  const sourcePatterns = [...allowedExtensions].map((ext) => `**/*${ext}`);
  const filePaths = discoverCandidatePaths(repoPath, config.exclude, sourcePatterns);

  // Apply config excludes
  const ig = ignore().add(config.exclude);
  const filteredPaths = filePaths.filter((p) => !ig.ignores(p));

  const files: DiscoveredFile[] = [];

  for (const relativePath of filteredPaths) {
    const ext = extname(relativePath);
    if (!allowedExtensions.has(ext)) continue;

    const language = LANGUAGE_EXTENSIONS[ext]!;
    const absolutePath = join(repoPath, relativePath);

    try {
      const content = readFileSync(absolutePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      files.push({ relativePath, absolutePath, language, hash });
    } catch {
      // Skip unreadable files
      continue;
    }
  }

  return files;
}

function discoverCandidatePaths(
  repoPath: string,
  exclude: string[],
  sourcePatterns: string[]
): string[] {
  const candidates = new Set<string>();

  for (const path of discoverGitPaths(repoPath)) {
    candidates.add(path);
  }

  // Supplement git discovery with a filesystem scan so branch-specific repo
  // layouts do not hide valid source files from the indexer.
  for (const path of fg.sync(sourcePatterns, {
    cwd: repoPath,
    ignore: exclude,
    dot: false,
    onlyFiles: true,
    unique: true,
    suppressErrors: true,
    followSymbolicLinks: true,
  })) {
    candidates.add(path);
  }

  return [...candidates].sort();
}

function discoverGitPaths(repoPath: string): string[] {
  const tracked = runGitCommand(
    repoPath,
    'git ls-files --cached --recurse-submodules'
  ) ?? runGitCommand(repoPath, 'git ls-files --cached') ?? [];

  const untracked = runGitCommand(
    repoPath,
    'git ls-files --others --exclude-standard'
  ) ?? [];

  return [...new Set([...tracked, ...untracked])];
}

function runGitCommand(repoPath: string, command: string): string[] | null {
  try {
    const output = execSync(command, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
}
