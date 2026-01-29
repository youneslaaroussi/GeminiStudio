import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

const firebaseProvider = {
  provide: 'FIREBASE_ADMIN',
  useFactory: (config: ConfigService) => {
    const key = config.get<string>('FIREBASE_SERVICE_ACCOUNT_KEY');
    if (!key) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is required');
    }
    const apps = admin.apps;
    if (apps.length > 0) {
      return admin.app();
    }
    let cred: admin.ServiceAccount;
    try {
      cred = JSON.parse(key);
    } catch {
      const fs = require('fs');
      const path = require('path');
      const keyPath = path.resolve(key);
      if (!fs.existsSync(keyPath)) {
        throw new Error(`FIREBASE_SERVICE_ACCOUNT_KEY file not found: ${keyPath}`);
      }
      cred = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    }
    return admin.initializeApp({ credential: admin.credential.cert(cred) });
  },
  inject: [ConfigService],
};

@Global()
@Module({
  providers: [firebaseProvider],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
