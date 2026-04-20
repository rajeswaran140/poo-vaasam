/**
 * Create S3 Bucket Script
 *
 * Creates the tamil-web-media bucket with proper CORS configuration
 *
 * Usage: npx ts-node scripts/create-s3-bucket.ts
 */

import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';

const client = new S3Client({
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
});

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET || 'tamil-web-media';
const REGION = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';

async function createBucket() {
  console.log(`🚀 Creating S3 bucket: ${BUCKET_NAME}`);

  try {
    // Check if bucket already exists
    try {
      const headCommand = new HeadBucketCommand({
        Bucket: BUCKET_NAME,
      });
      await client.send(headCommand);
      console.log(`✅ Bucket ${BUCKET_NAME} already exists!`);
    } catch (error: any) {
      if (error.name === 'NotFound') {
        // Bucket doesn't exist, create it
        const createCommand = new CreateBucketCommand({
          Bucket: BUCKET_NAME,
          ...(REGION !== 'us-east-1' && {
            CreateBucketConfiguration: {
              LocationConstraint: REGION,
            },
          }),
        });

        await client.send(createCommand);
        console.log('✅ Bucket created successfully!');
      } else {
        throw error;
      }
    }

    // Configure CORS
    console.log('\n📝 Configuring CORS...');
    const corsCommand = new PutBucketCorsCommand({
      Bucket: BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
            AllowedOrigins: [
              'http://localhost:3000',
              'https://*.amplifyapp.com',
              process.env.NEXT_PUBLIC_APP_URL || '*',
            ],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3000,
          },
        ],
      },
    });

    await client.send(corsCommand);
    console.log('✅ CORS configured!');

    // Configure public access block
    console.log('\n🔒 Configuring public access settings...');
    const publicAccessCommand = new PutPublicAccessBlockCommand({
      Bucket: BUCKET_NAME,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    });

    await client.send(publicAccessCommand);
    console.log('✅ Public access configured!');

    // Set bucket policy for public read access
    console.log('\n📜 Setting bucket policy...');
    const bucketPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
          Condition: {
            StringLike: {
              's3:ExistingObjectTag/public': 'true',
            },
          },
        },
      ],
    };

    const policyCommand = new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify(bucketPolicy),
    });

    await client.send(policyCommand);
    console.log('✅ Bucket policy set!');

    console.log('\n✅ S3 bucket setup completed!');
    console.log('\n📊 Bucket Details:');
    console.log(`  Bucket Name: ${BUCKET_NAME}`);
    console.log(`  Region: ${REGION}`);
    console.log(`  URL: https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/`);
    console.log('\n📁 Folder Structure:');
    console.log('  /audio/ - Audio files (songs, poems)');
    console.log('  /images/ - Images (featured images, content images)');
    console.log('  /temp/ - Temporary uploads');

  } catch (error: any) {
    console.error('❌ Error creating bucket:', error.message);

    if (error.name === 'BucketAlreadyExists') {
      console.log('⚠️ Bucket name is already taken globally. Please choose a different name.');
    } else if (error.name === 'BucketAlreadyOwnedByYou') {
      console.log('✅ Bucket already exists and is owned by you!');
    } else {
      throw error;
    }
  }
}

// Run the script
createBucket()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
