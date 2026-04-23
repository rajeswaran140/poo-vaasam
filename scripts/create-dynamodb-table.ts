/**
 * Create DynamoDB Table Script
 *
 * Creates the TamilWebContent table with GSIs for the single-table design
 *
 * Usage: npx ts-node scripts/create-dynamodb-table.ts
 */

import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
});

const TABLE_NAME = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'TamilWebContent';

async function createTable() {
  console.log(`🚀 Creating DynamoDB table: ${TABLE_NAME}`);

  try {
    // Check if table already exists
    try {
      const describeCommand = new DescribeTableCommand({
        TableName: TABLE_NAME,
      });
      const existing = await client.send(describeCommand);
      console.log(`✅ Table ${TABLE_NAME} already exists!`);
      console.log(`Status: ${existing.Table?.TableStatus}`);
      return;
    } catch (error: any) {
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
      // Table doesn't exist, continue with creation
    }

    const command = new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST', // On-demand pricing

      // Primary Keys
      KeySchema: [
        {
          AttributeName: 'PK',
          KeyType: 'HASH', // Partition key
        },
        {
          AttributeName: 'SK',
          KeyType: 'RANGE', // Sort key
        },
      ],

      // Attribute Definitions
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
        { AttributeName: 'GSI3PK', AttributeType: 'S' },
        { AttributeName: 'GSI3SK', AttributeType: 'S' },
        { AttributeName: 'GSI4PK', AttributeType: 'S' },
        { AttributeName: 'GSI4SK', AttributeType: 'S' },
        { AttributeName: 'GSI5PK', AttributeType: 'S' },
        { AttributeName: 'GSI5SK', AttributeType: 'S' },
        { AttributeName: 'GSI6PK', AttributeType: 'S' },
        { AttributeName: 'GSI6SK', AttributeType: 'S' },
      ],

      // Global Secondary Indexes
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI3',
          KeySchema: [
            { AttributeName: 'GSI3PK', KeyType: 'HASH' },
            { AttributeName: 'GSI3SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI4',
          KeySchema: [
            { AttributeName: 'GSI4PK', KeyType: 'HASH' },
            { AttributeName: 'GSI4SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI5',
          KeySchema: [
            { AttributeName: 'GSI5PK', KeyType: 'HASH' },
            { AttributeName: 'GSI5SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI6',
          KeySchema: [
            { AttributeName: 'GSI6PK', KeyType: 'HASH' },
            { AttributeName: 'GSI6SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],

      // Additional settings
      Tags: [
        { Key: 'Project', Value: 'PooVaasam' },
        { Key: 'Environment', Value: process.env.NODE_ENV || 'development' },
      ],
    });

    const response = await client.send(command);
    console.log('✅ Table creation initiated!');
    console.log(`Status: ${response.TableDescription?.TableStatus}`);
    console.log(`ARN: ${response.TableDescription?.TableArn}`);

    console.log('\n⏳ Waiting for table to become ACTIVE...');
    console.log('This may take 1-2 minutes...');

    // Wait for table to be active
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const describeCommand = new DescribeTableCommand({
        TableName: TABLE_NAME,
      });

      const description = await client.send(describeCommand);
      const status = description.Table?.TableStatus;

      console.log(`Status check ${attempts + 1}: ${status}`);

      if (status === 'ACTIVE') {
        console.log('\n✅ Table is ACTIVE and ready to use!');
        console.log('\n📊 Table Details:');
        console.log(`  Table Name: ${TABLE_NAME}`);
        console.log(`  Item Count: ${description.Table?.ItemCount || 0}`);
        console.log(`  Size: ${description.Table?.TableSizeBytes || 0} bytes`);
        console.log(`  GSIs: GSI1 (type), GSI2 (category), GSI3 (tag), GSI4 (status), GSI5 (slug), GSI6 (popular)`);
        return;
      }

      attempts++;
    }

    console.log('⚠️ Table creation timed out, but it may still be in progress.');
    console.log('Check AWS Console for status.');

  } catch (error: any) {
    console.error('❌ Error creating table:', error.message);
    if (error.name === 'ResourceInUseException') {
      console.log('Table already exists!');
    } else {
      throw error;
    }
  }
}

// Run the script
createTable()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
