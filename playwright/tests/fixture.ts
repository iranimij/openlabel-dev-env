import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * How specs reach the fixture's database and CLI.
 * - Local (default): the Warden environment of this repository (`warden env exec`).
 * - CI (`OL_FIXTURE=shell`): Magento in `MAGENTO_ROOT`, MySQL from `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`.
 */
const shell = process.env.OL_FIXTURE === 'shell';
const repoRoot = resolve(__dirname, '../..');

export const magentoRoot = shell ? (process.env.MAGENTO_ROOT ?? repoRoot) : repoRoot;

/** Runs SQL and returns tab-separated rows. */
export function sql(query: string): string[][] {
  const args = ['-N', '-B', '-e', query];
  const out = shell
    ? execFileSync('mysql', [
      '-h', process.env.DB_HOST ?? '127.0.0.1',
      '-u', process.env.DB_USER ?? 'magento',
      `-p${process.env.DB_PASSWORD ?? 'magento'}`,
      process.env.DB_NAME ?? 'magento',
      ...args,
    ], { encoding: 'utf8' })
    : execFileSync('warden', ['env', 'exec', '-T', 'db', 'mysql', '-umagento', '-pmagento', 'magento', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  return out.trim() === '' ? [] : out.trim().split('\n').map((line) => line.split('\t'));
}

/** Runs bin/magento. */
export function magento(...args: string[]): string {
  return shell
    ? execFileSync('php', ['bin/magento', ...args], { cwd: magentoRoot, encoding: 'utf8' })
    : execFileSync('warden', ['env', 'exec', '-T', 'php-fpm', 'bin/magento', ...args], { cwd: repoRoot, encoding: 'utf8' });
}
