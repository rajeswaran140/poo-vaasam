/**
 * Persistence for pre-master analyses (PK=`MASTERANALYSIS#<id>`, SK=`METADATA`).
 *
 * Mirrors MasterJobRepository but much smaller: an analysis is a scratch reading
 * about a source file, so it carries a 24h ttl and is never "saved". Nothing
 * downstream depends on it — losing one costs a re-run, not a master.
 */

import { DynamoDBOperations, handleDynamoDBError } from './dynamodb-client';
import type { MasterAnalysis } from '@/types/masterAnalysis';

const TTL_SECONDS = 24 * 60 * 60;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export class MasterAnalysisRepository {
  async create(id: string, input: { s3Key: string; partBKey?: string | null }): Promise<MasterAnalysis> {
    try {
      const now = new Date().toISOString();
      const analysis: MasterAnalysis = {
        id,
        status: 'processing',
        createdAt: now,
        updatedAt: now,
        s3Key: input.s3Key,
        partBKey: input.partBKey ?? null,
        durationSec: null,
        leadingSilenceSec: null,
        trailingSilenceSec: null,
        tailDropLu: null,
        integratedLufs: null,
        partBDurationSec: null,
        partBIntegratedLufs: null,
        partBTailDropLu: null,
        error: null,
      };
      await DynamoDBOperations.put({
        PK: `MASTERANALYSIS#${id}`,
        SK: 'METADATA',
        Type: 'MASTERANALYSIS',
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
        ...analysis,
      });
      return analysis;
    } catch (error) {
      handleDynamoDBError(error);
    }
  }

  async get(id: string): Promise<MasterAnalysis | null> {
    try {
      const item = await DynamoDBOperations.get({ PK: `MASTERANALYSIS#${id}`, SK: 'METADATA' });
      if (!item) return null;
      // Every numeric field degrades to null: a record written by an older
      // worker must never hand a verdict a value it did not measure.
      return {
        id: item.id,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        s3Key: item.s3Key,
        partBKey: typeof item.partBKey === 'string' ? item.partBKey : null,
        durationSec: num(item.durationSec),
        leadingSilenceSec: num(item.leadingSilenceSec),
        trailingSilenceSec: num(item.trailingSilenceSec),
        tailDropLu: num(item.tailDropLu),
        integratedLufs: num(item.integratedLufs),
        partBDurationSec: num(item.partBDurationSec),
        partBIntegratedLufs: num(item.partBIntegratedLufs),
        partBTailDropLu: num(item.partBTailDropLu),
        error: item.error ?? null,
      };
    } catch (error) {
      handleDynamoDBError(error);
    }
  }
}
