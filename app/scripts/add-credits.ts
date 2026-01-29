/**
 * CLI script to add R‑Credits to a user's account.
 *
 * Usage:
 *   pnpm add-credits <user> <amount> [--key path/to/service-account.json]
 *   pnpm add-credits user@example.com 100
 *   pnpm add-credits abc123uid 50 --key ./secrets/firebase-key.json
 *
 * <user>  User email or Firebase UID.
 * <amount>  Positive integer; credits to add.
 * --key     Path to Firebase service account JSON. Optional if
 *           FIREBASE_SERVICE_ACCOUNT_KEY is set (JSON string or file path).
 *
 * Requires Firebase Admin (service account) with Firestore access.
 */

import { initAdmin, getAdminAuth } from "../app/lib/server/firebase-admin";
import { addCredits } from "../app/lib/server/credits";

function parseArgs(): { user: string; amount: number; keyPath?: string } {
  const argv = process.argv.slice(2);
  const positional: string[] = [];
  let keyPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--key" && argv[i + 1]) {
      keyPath = argv[++i];
    } else if (a.startsWith("--key=")) {
      keyPath = a.slice(6);
    } else if (a !== "--key") {
      positional.push(a);
    }
  }

  const [user, amountStr] = positional;
  if (!user || amountStr == null) {
    console.error(`
Usage: pnpm add-credits <user> <amount> [--key path/to/service-account.json]

  user    Email or Firebase UID
  amount  Credits to add (positive integer)
  --key   Service account JSON path (optional if FIREBASE_SERVICE_ACCOUNT_KEY is set)
`);
    process.exit(1);
  }

  const amount = parseInt(amountStr, 10);
  if (!Number.isInteger(amount) || amount <= 0) {
    console.error("Amount must be a positive integer.");
    process.exit(1);
  }

  return { user, amount, keyPath };
}

async function resolveUserId(user: string): Promise<string> {
  const auth = await getAdminAuth();
  if (user.includes("@")) {
    const record = await auth.getUserByEmail(user);
    return record.uid;
  }
  await auth.getUser(user);
  return user;
}

async function main() {
  const { user, amount, keyPath } = parseArgs();

  if (keyPath) {
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY = keyPath;
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error(
      "Set FIREBASE_SERVICE_ACCOUNT_KEY (env) or pass --key path/to/service-account.json"
    );
    process.exit(1);
  }

  await initAdmin();
  const userId = await resolveUserId(user);
  const result = await addCredits(userId, amount, "cli-add");

  console.log(
    `Added ${result.added} R‑Credits to ${user} (${userId}). Balance: ${result.previousBalance} → ${result.newBalance}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
