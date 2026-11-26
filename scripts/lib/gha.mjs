import { appendFileSync } from 'node:fs';

export function setOutput(name, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.includes('\n')) throw new Error(`output ${name} に改行は入れられない`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${text}\n`);
  else console.log(`${name}=${text}`);
}

export function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else console.log(markdown);
}

export function env(name, { optional = false } = {}) {
  const v = process.env[name] ?? '';
  if (!optional && v === '') throw new Error(`環境変数 ${name} が無い`);
  return v;
}

export async function main(fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`::error::${e.message}`);
    process.exitCode = 1;
  }
}
