import { execFileSync } from 'node:child_process';

export function isNotFound(stderr) {
  return /: not found\s*$/m.test(String(stderr ?? ''));
}

// タグが無ければ null。それ以外の失敗（認証・ネットワーク）は例外のまま落とす。
export function inspectImage(ref, format) {
  try {
    return JSON.parse(execFileSync('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', format], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (e) {
    if (isNotFound(e.stderr)) return null;
    throw new Error(`${ref} を読めない: ${e.stderr ?? e.message}`);
  }
}
