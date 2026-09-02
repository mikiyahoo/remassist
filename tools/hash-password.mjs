/**
 * Print a password hash and nothing else — MIGRATION-PLAN §10.
 *
 *   node tools/hash-password.mjs
 *
 * For the case admin:create cannot serve: writing a password onto a row that
 * already exists, or onto a database you can only reach with a SQL console.
 * It prints a `scrypt$N$r$p$salt$hash` string to paste into an UPDATE or an
 * INSERT; it touches no database itself, so it is safe to run anywhere.
 *
 * Prompts with echo disabled and accepts the password in no other way — not as
 * an argument, not from an environment variable. Same reasoning as
 * tools/create-admin.mts: an argument lands in shell history and in the process
 * list, and one pasted into a chat window lands somewhere worse.
 *
 * The hash is safe to paste around. That is the whole point of a hash — but
 * the password you typed to make it is not, so do not put that anywhere.
 */
import { createInterface } from 'node:readline';
import { hashPassword, passwordProblem } from '../lib/auth/password.ts';

/**
 * Ask without echoing. readline routes every keystroke through
 * `_writeToOutput`, so replacing it lets the prompt through and swallows the
 * characters typed in reply.
 */
function askHidden(rl, prompt) {
  return new Promise((resolve) => {
    const out = rl.output;
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) out.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl._writeToOutput = (s) => out.write(s);
      out.write('\n');
      resolve(answer);
    });
  });
}

if (!process.stdin.isTTY) {
  console.error('\n  This needs a real terminal — it prompts with echo off.\n');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

try {
  console.log('\n  Hashing a password. Nothing is written to any database.\n');

  const password = await askHidden(rl, '  Password (not shown): ');
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`\n  ${problem}\n`);
    process.exit(1);
  }

  const again = await askHidden(rl, '  Confirm password: ');
  if (password !== again) {
    console.error('\n  Those did not match. Nothing was printed.\n');
    process.exit(1);
  }

  console.log(`\n${await hashPassword(password)}\n`);
} finally {
  rl.close();
}
