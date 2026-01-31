#!/usr/bin/env npx tsx
/**
 * Generate magic link credentials for hackathon judges.
 * 
 * Usage:
 *   npx tsx scripts/generate-magic-link.ts judge@example.com [projectId]
 * 
 * This script will:
 *   1. Generate a secure random secret
 *   2. Create or find a Firebase user with the given email
 *   3. Output the env values and shareable magic link
 */

import 'dotenv/config';
import { randomBytes } from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
function initFirebaseAdmin() {
  if (getApps().length > 0) {
    return;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  
  if (!serviceAccountKey) {
    console.error('Error: FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set');
    console.error('Set it to the path of your service account JSON or the JSON content itself');
    process.exit(1);
  }

  try {
    // Try parsing as JSON first
    const credentials = JSON.parse(serviceAccountKey);
    initializeApp({ credential: cert(credentials) });
  } catch {
    // If not JSON, treat as file path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    
    const keyPath = path.resolve(serviceAccountKey);
    if (!fs.existsSync(keyPath)) {
      console.error(`Error: Service account key file not found: ${keyPath}`);
      process.exit(1);
    }
    
    const credentials = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    initializeApp({ credential: cert(credentials) });
  }
}

async function main() {
  const email = process.argv[2];
  const projectId = process.argv[3];

  if (!email) {
    console.error('Usage: npx tsx scripts/generate-magic-link.ts <email> [projectId]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/generate-magic-link.ts judge@hackathon.com');
    console.error('  npx tsx scripts/generate-magic-link.ts judge@hackathon.com abc123-project-id');
    process.exit(1);
  }

  // Validate email format
  if (!email.includes('@')) {
    console.error('Error: Invalid email address');
    process.exit(1);
  }

  initFirebaseAdmin();
  const auth = getAuth();

  // Generate a secure random secret
  const secret = randomBytes(32).toString('hex');

  // Create or get the Firebase user
  let userId: string;
  try {
    // Check if user already exists
    const existingUser = await auth.getUserByEmail(email);
    userId = existingUser.uid;
    console.log(`\nFound existing Firebase user: ${userId}`);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      // Create new user
      const newUser = await auth.createUser({
        email,
        emailVerified: true,
        displayName: 'Hackathon Judge',
      });
      userId = newUser.uid;
      console.log(`\nCreated new Firebase user: ${userId}`);
    } else {
      console.error('Error checking/creating user:', error.message);
      process.exit(1);
    }
  }

  // Output the results
  console.log('\n' + '='.repeat(60));
  console.log('MAGIC LINK CONFIGURATION');
  console.log('='.repeat(60));
  
  console.log('\nAdd these to your .env file:\n');
  console.log(`MAGIC_LINK_SECRET=${secret}`);
  console.log(`DEMO_USER_ID=${userId}`);
  if (projectId) {
    console.log(`DEMO_PROJECT_ID=${projectId}`);
  } else {
    console.log(`DEMO_PROJECT_ID=<your-project-id-here>`);
  }

  console.log('\n' + '-'.repeat(60));
  
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com';
  const magicLink = `${baseUrl}/demo?token=${secret}`;
  
  console.log('\nShare this magic link with judges:\n');
  console.log(magicLink);
  
  if (projectId) {
    console.log(`\nOr with explicit project: ${baseUrl}/demo?token=${secret}&project=${projectId}`);
  }

  console.log('\n' + '-'.repeat(60));
  console.log('\nJudge email:', email);
  console.log('Firebase UID:', userId);
  console.log('Secret length:', secret.length, 'characters');
  console.log('\nKeep the secret safe - anyone with it can access your demo!\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
