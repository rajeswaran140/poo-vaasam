import { NextResponse } from 'next/server';

/**
 * Debug API to check environment variables
 * Server-side check
 */

export async function GET() {
  const config = {
    userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID || 'NOT SET',
    clientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID || 'NOT SET',
    region: process.env.NEXT_PUBLIC_AWS_REGION || 'NOT SET',
    // Mask the actual values for security, just show if they're set
    userPoolIdSet: !!process.env.NEXT_PUBLIC_USER_POOL_ID,
    clientIdSet: !!process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID,
    regionSet: !!process.env.NEXT_PUBLIC_AWS_REGION,
    // Show first few characters for verification
    userPoolIdPreview: process.env.NEXT_PUBLIC_USER_POOL_ID?.substring(0, 15) + '...' || 'NOT SET',
    clientIdPreview: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID?.substring(0, 10) + '...' || 'NOT SET',
  };

  return NextResponse.json(config);
}
