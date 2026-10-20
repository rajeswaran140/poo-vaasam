/**
 * One-off, READ-ONLY: find saved mastering jobs whose output file was
 * overwritten by a later job on the same source and target.
 *
 *   AWS_REGION=ca-central-1 npx tsx scripts/find-shared-master-keys.ts
 *
 * Before 2026-10-20 output keys were built from (source, target) alone, so two
 * jobs could name the same file and only the last write survived. This lists
 * every key named by more than one job, with the S3 object's LastModified so
 * you can see which job's bytes are actually stored. It cannot recover the
 * overwritten audio; it only says where it happened.
 *
 * Scans MASTERJOB# rows and HEADs the shared keys. Writes nothing.
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { findSharedOutputKeys, type JobOutputs } from '../src/lib/master-key-collisions';

const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const BUCKET = process.env.TAKES_BUCKET || 'tamil-web-media';
// The media bucket is in us-east-1, not the table's region — same split as the worker.
const S3_REGION = process.env.TAKES_BUCKET_REGION || 'us-east-1';

const db = new DynamoDBClient({ region: REGION });
const s3 = new S3Client({ region: S3_REGION });

async function listJobs(): Promise<JobOutputs[]> {
  const out: JobOutputs[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'begins_with(PK, :p) AND SK = :sk',
      ExpressionAttributeValues: { ':p': { S: 'MASTERJOB#' }, ':sk': { S: 'METADATA' } },
      ProjectionExpression: 'PK, title, s3Key, masterKey, matchedMasterKey, savedAt, updatedAt',
      ExclusiveStartKey: start as Record<string, never> | undefined,
    }));
    for (const it of res.Items ?? []) {
      out.push({
        jobId: (it.PK?.S ?? '').replace(/^MASTERJOB#/, ''),
        title: it.title?.S ?? null,
        s3Key: it.s3Key?.S ?? '',
        masterKey: it.masterKey?.S ?? null,
        matchedMasterKey: it.matchedMasterKey?.S ?? null,
        savedAt: it.savedAt?.S ?? null,
        updatedAt: it.updatedAt?.S ?? null,
      });
    }
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

async function lastModified(key: string): Promise<string> {
  try {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return h.LastModified?.toISOString() ?? '?';
  } catch (e) {
    // Say WHICH failure: a wrong region once read as "missing" for a file that was there.
    const name = (e as { name?: string }).name ?? 'error';
    return name === 'NotFound' ? 'missing (404)' : `unknown — HEAD failed: ${name}`;
  }
}

async function main() {
  const jobs = await listJobs();
  const shared = findSharedOutputKeys(jobs);
  console.log(`${jobs.length} mastering job records · ${shared.length} output file(s) named by more than one job\n`);
  for (const g of shared) {
    console.log(`${g.field}  ${g.key}`);
    console.log(`  stored object last modified: ${await lastModified(g.key)}`);
    for (const j of g.jobs) {
      console.log(`  - job ${j.jobId}  updated ${j.updatedAt ?? '?'}  ${j.savedAt ? 'SAVED' : 'unsaved'}  ${j.title ?? '(no title)'}`);
    }
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
