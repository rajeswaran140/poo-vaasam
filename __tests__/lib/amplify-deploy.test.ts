/** @jest-environment node */
/**
 * amplify-deploy — trigger an Amplify "RELEASE" build so a freshly-published
 * song goes live (the public pages are build-time). Pure input builder + a
 * thin client wrapper returning a discriminated result.
 */

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-amplify', () => ({
  AmplifyClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  StartJobCommand: jest.fn((input) => ({ __cmd: 'StartJob', input })),
}));

import {
  buildStartJobInput,
  triggerRelease,
  triggerReleaseFromEnv,
  shouldDeployForContent,
} from '@/lib/amplify-deploy';

beforeEach(() => jest.clearAllMocks());

describe('buildStartJobInput', () => {
  it('builds a RELEASE job for the app + branch', () => {
    expect(buildStartJobInput('d3rkmepk4popv0', 'master')).toEqual({
      appId: 'd3rkmepk4popv0',
      branchName: 'master',
      jobType: 'RELEASE',
    });
  });
});

describe('triggerRelease', () => {
  it('returns the jobId on success', async () => {
    mockSend.mockResolvedValueOnce({ jobSummary: { jobId: '181' } });
    const r = await triggerRelease('app1', 'master');
    expect(r).toEqual({ ok: true, jobId: '181' });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ input: { appId: 'app1', branchName: 'master', jobType: 'RELEASE' } }));
  });

  it('returns an error result on SDK failure (never throws)', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied: amplify:StartJob'));
    const r = await triggerRelease('app1', 'master');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('AccessDenied');
  });
});

describe('triggerReleaseFromEnv', () => {
  const OLD = process.env;
  beforeEach(() => { process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  it('releases the env app/branch when configured', async () => {
    process.env.AMPLIFY_APP_ID = 'envApp';
    process.env.AMPLIFY_BRANCH = 'master';
    mockSend.mockResolvedValueOnce({ jobSummary: { jobId: '196' } });
    const r = await triggerReleaseFromEnv();
    expect(r).toEqual({ ok: true, jobId: '196' });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: { appId: 'envApp', branchName: 'master', jobType: 'RELEASE' } })
    );
  });

  it('returns not-configured (no AWS call) when AMPLIFY_APP_ID is unset', async () => {
    delete process.env.AMPLIFY_APP_ID;
    const r = await triggerReleaseFromEnv();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/AMPLIFY_APP_ID/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('shouldDeployForContent', () => {
  it('deploys when publishing, editing a live item, or unpublishing', () => {
    expect(shouldDeployForContent(false, true)).toBe(true); // publish
    expect(shouldDeployForContent(true, true)).toBe(true); // edit live
    expect(shouldDeployForContent(true, false)).toBe(true); // unpublish
  });
  it('does NOT deploy for pure draft work', () => {
    expect(shouldDeployForContent(false, false)).toBe(false);
  });
});
