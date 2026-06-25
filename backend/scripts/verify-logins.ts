/**
 * Verifies every user can log in against the running backend and that the
 * returned JWT payload matches what the old hardcoded array would have produced.
 *
 * Usage (from backend/, with the dev server running):
 *   LOGIN_PASSWORD=<shared-password> npx ts-node scripts/verify-logins.ts
 *   # or:  npm run verify:logins   (reads LOGIN_PASSWORD / API_URL from env)
 *
 * Env:
 *   LOGIN_PASSWORD  (required)  plaintext password matching the shared bcrypt HASH
 *   API_URL         (optional)  backend base URL, default http://localhost:3000
 *
 * Exit code is non-zero if any login fails or any payload mismatches, so this
 * is safe to gate a cutover on.
 */
import 'reflect-metadata';
import { USERS, CUSTOMER_ID_MAP } from '../src/auth/auth.service';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.LOGIN_PASSWORD;

interface Payload {
  username: string;
  companyName: string;
  accountNames: string[];
  platforms: string[];
  isAdmin: boolean;
  customerIds: string[];
}

function arraysEqual(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/** Build the payload the way auth.service does (faithful CUSTOMER_ID_MAP lookup). */
function expectedFor(record: (typeof USERS)[number]): Payload {
  return {
    username: record.user.username,
    companyName: record.user.companyName,
    accountNames: record.user.accountNames,
    platforms: record.user.platforms,
    isAdmin: record.user.isAdmin,
    customerIds: CUSTOMER_ID_MAP[record.user.companyName] || [],
  };
}

function diff(expected: Payload, actual: Payload | undefined): string[] {
  if (!actual) return ['no user object returned'];
  const problems: string[] = [];
  if (actual.username !== expected.username)
    problems.push(`username: "${actual.username}" != "${expected.username}"`);
  if (actual.companyName !== expected.companyName)
    problems.push(`companyName: "${actual.companyName}" != "${expected.companyName}"`);
  if (actual.isAdmin !== expected.isAdmin)
    problems.push(`isAdmin: ${actual.isAdmin} != ${expected.isAdmin}`);
  if (!arraysEqual(actual.accountNames, expected.accountNames))
    problems.push(
      `accountNames: [${actual.accountNames}] != [${expected.accountNames}]`,
    );
  if (!arraysEqual(actual.platforms, expected.platforms))
    problems.push(`platforms: [${actual.platforms}] != [${expected.platforms}]`);
  if (!arraysEqual(actual.customerIds, expected.customerIds))
    problems.push(
      `customerIds: [${actual.customerIds}] != [${expected.customerIds}]`,
    );
  return problems;
}

async function login(
  username: string,
  password: string,
): Promise<{ status: number; user?: Payload }> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { user?: Payload };
  return { status: res.status, user: body.user };
}

async function main() {
  if (!PASSWORD) {
    console.error('LOGIN_PASSWORD env var is required.');
    process.exit(2);
  }

  console.log(`Verifying ${USERS.length} logins against ${API_URL}\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const record of USERS) {
    const username = record.user.username;
    const expected = expectedFor(record);
    try {
      const { status, user } = await login(username, PASSWORD);
      if (status !== 200) {
        failures.push(`${username}: HTTP ${status}`);
        console.log(`FAIL  ${username}  (HTTP ${status})`);
        continue;
      }
      const problems = diff(expected, user);
      if (problems.length) {
        failures.push(`${username}: ${problems.join('; ')}`);
        console.log(`FAIL  ${username}`);
        problems.forEach((p) => console.log(`        - ${p}`));
      } else {
        passed++;
        console.log(`ok    ${username}`);
      }
    } catch (err) {
      failures.push(`${username}: ${(err as Error).message}`);
      console.log(`ERROR ${username}  (${(err as Error).message})`);
    }
  }

  // Negative check: a wrong password must be rejected with 401.
  const sample = USERS[0].user.username;
  const bad = await login(sample, `${PASSWORD}_wrong`);
  const badOk = bad.status === 401;
  console.log(
    `\n${badOk ? 'ok   ' : 'FAIL '} wrong-password rejected for ${sample} (got HTTP ${bad.status}, want 401)`,
  );
  if (!badOk) failures.push(`wrong-password for ${sample} returned ${bad.status}, expected 401`);

  console.log(`\n${passed}/${USERS.length} payloads matched.`);
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All logins verified.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
