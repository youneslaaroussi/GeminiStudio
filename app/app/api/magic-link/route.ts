import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/app/lib/server/firebase-admin';

/**
 * Magic link API for demo access.
 * Generates a Firebase custom token for demo users.
 * 
 * Usage: GET /api/magic-link?token=YOUR_SECRET
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  // Verify the magic link secret
  const magicSecret = process.env.MAGIC_LINK_SECRET;
  
  if (!magicSecret) {
    console.error('MAGIC_LINK_SECRET not configured');
    return NextResponse.json(
      { error: 'Magic link not configured' },
      { status: 500 }
    );
  }

  if (!token || token !== magicSecret) {
    return NextResponse.json(
      { error: 'Invalid token' },
      { status: 401 }
    );
  }

  try {
    const auth = await getAdminAuth();
    
    // Create a custom token for the demo user
    // Using a fixed UID for the demo account so all judges share the same session
    const demoUserId = process.env.DEMO_USER_ID || 'demo-user';
    const customToken = await auth.createCustomToken(demoUserId, {
      isDemo: true,
      role: 'judge',
    });

    // Get the target project ID from env
    const projectId = process.env.DEMO_PROJECT_ID;

    return NextResponse.json({
      customToken,
      projectId,
    });
  } catch (error) {
    console.error('Failed to create custom token:', error);
    return NextResponse.json(
      { error: 'Failed to generate access token' },
      { status: 500 }
    );
  }
}
