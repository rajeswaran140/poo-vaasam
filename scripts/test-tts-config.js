#!/usr/bin/env node

/**
 * TTS Configuration Test Script
 * Run this to verify Google Cloud TTS credentials are properly configured
 *
 * Usage: node scripts/test-tts-config.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Google Cloud TTS Configuration Test\n');
console.log('=' .repeat(60));

// Load environment variables from .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2];
    }
  });
  console.log('✓ Loaded .env.local');
} else {
  console.log('⚠ .env.local not found');
}

console.log('\n📋 Environment Variables Check:');
console.log('-'.repeat(60));

// Check GOOGLE_APPLICATION_CREDENTIALS
const hasFileCredentials = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
console.log(`\n1. GOOGLE_APPLICATION_CREDENTIALS: ${hasFileCredentials ? '✓ SET' : '✗ NOT SET'}`);
if (hasFileCredentials) {
  console.log(`   Path: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  const fileExists = fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  console.log(`   File exists: ${fileExists ? '✓ YES' : '✗ NO'}`);

  if (fileExists) {
    try {
      const content = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8'));
      console.log(`   Project ID: ${content.project_id}`);
      console.log(`   Client Email: ${content.client_email}`);
    } catch (err) {
      console.log(`   ✗ Error reading file: ${err.message}`);
    }
  }
}

// Check GOOGLE_TTS_CREDENTIALS_BASE64
const hasBase64Credentials = !!process.env.GOOGLE_TTS_CREDENTIALS_BASE64;
console.log(`\n2. GOOGLE_TTS_CREDENTIALS_BASE64: ${hasBase64Credentials ? '✓ SET' : '✗ NOT SET'}`);
if (hasBase64Credentials) {
  const base64String = process.env.GOOGLE_TTS_CREDENTIALS_BASE64;
  console.log(`   Length: ${base64String.length} characters`);
  console.log(`   Preview: ${base64String.substring(0, 50)}...`);

  try {
    const decoded = Buffer.from(base64String, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    console.log(`   ✓ Successfully parsed JSON`);
    console.log(`   Project ID: ${parsed.project_id}`);
    console.log(`   Client Email: ${parsed.client_email}`);
  } catch (err) {
    console.log(`   ✗ Error parsing base64: ${err.message}`);
  }
}

// Test TTS client initialization
console.log('\n📡 TTS Client Test:');
console.log('-'.repeat(60));

(async () => {
  try {
    const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

    let client;
    if (process.env.GOOGLE_TTS_CREDENTIALS_BASE64) {
      console.log('\n→ Using base64 credentials...');
      const credentials = JSON.parse(
        Buffer.from(process.env.GOOGLE_TTS_CREDENTIALS_BASE64, 'base64').toString('utf-8')
      );
      client = new TextToSpeechClient({ credentials });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log('\n→ Using file credentials...');
      client = new TextToSpeechClient({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    } else {
      throw new Error('No credentials configured');
    }

    console.log('✓ Client initialized');

    // Test API call
    console.log('\n→ Testing API connection...');
    const [result] = await client.listVoices({ languageCode: 'ta-IN' });

    console.log('✓ Successfully connected to Google Cloud TTS API');
    console.log(`\nAvailable Tamil voices: ${result.voices?.length || 0}`);

    if (result.voices && result.voices.length > 0) {
      console.log('\nTamil Voices:');
      result.voices.forEach((voice, index) => {
        console.log(`  ${index + 1}. ${voice.name} (${voice.ssmlGender})`);
      });
    }

    // Test audio generation
    console.log('\n→ Testing audio generation...');
    const [response] = await client.synthesizeSpeech({
      input: { text: 'வணக்கம்' },
      voice: { languageCode: 'ta-IN', name: 'ta-IN-Wavenet-A' },
      audioConfig: { audioEncoding: 'MP3' },
    });

    if (response.audioContent) {
      console.log(`✓ Audio generated successfully (${response.audioContent.length} bytes)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL TESTS PASSED - TTS is properly configured!');
    console.log('='.repeat(60));

  } catch (error) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ TEST FAILED');
    console.log('='.repeat(60));
    console.error('\nError:', error.message);

    if (error.message.includes('PERMISSION_DENIED') || error.message.includes('has not been used')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   - Text-to-Speech API needs to be enabled in Google Cloud Console');

      // Extract project ID from error message
      const projectMatch = error.message.match(/project (\d+)/);
      if (projectMatch) {
        const projectId = projectMatch[1];
        console.log('\n🔗 Enable the API here:');
        console.log(`   https://console.developers.google.com/apis/api/texttospeech.googleapis.com/overview?project=${projectId}`);
      }

      console.log('\n📝 Steps:');
      console.log('   1. Click the link above (or visit Google Cloud Console)');
      console.log('   2. Click "Enable API" button');
      console.log('   3. Wait a few minutes for changes to propagate');
      console.log('   4. Run this test script again');
    } else if (error.message.includes('API key not valid')) {
      console.log('\n💡 Troubleshooting:');
      console.log('   - Verify credentials are from the correct Google Cloud project');
      console.log('   - Check that Text-to-Speech API is enabled');
    }

    process.exit(1);
  }
})();
