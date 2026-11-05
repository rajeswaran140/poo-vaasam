import { SSMClient } from '@aws-sdk/client-ssm';
import { getXaiApiKey, __resetXaiKeyCacheForTests } from '@/services/video/credentials';

describe('getXaiApiKey', () => {
  let send: jest.SpyInstance;
  const saved = { app: process.env.AWS_APP_ID, branch: process.env.AWS_BRANCH };

  beforeEach(() => {
    delete process.env.AWS_APP_ID;
    delete process.env.AWS_BRANCH;
    __resetXaiKeyCacheForTests();
    send = jest.spyOn(SSMClient.prototype, 'send');
  });
  afterEach(() => {
    send.mockRestore();
    if (saved.app !== undefined) process.env.AWS_APP_ID = saved.app;
    if (saved.branch !== undefined) process.env.AWS_BRANCH = saved.branch;
  });

  it('reads the decrypted parameter at the default path and caches it', async () => {
    send.mockResolvedValue({ Parameter: { Value: 'xai-test-key' } });
    expect(await getXaiApiKey()).toBe('xai-test-key');
    expect(await getXaiApiKey()).toBe('xai-test-key');
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0].input;
    expect(input.Name).toBe('/amplify/d3rkmepk4popv0/master/XAI_API_KEY');
    expect(input.WithDecryption).toBe(true);
  });

  it('honours AWS_APP_ID and AWS_BRANCH', async () => {
    process.env.AWS_APP_ID = 'app1';
    process.env.AWS_BRANCH = 'dev';
    send.mockResolvedValue({ Parameter: { Value: 'k' } });
    await getXaiApiKey();
    expect(send.mock.calls[0][0].input.Name).toBe('/amplify/app1/dev/XAI_API_KEY');
  });

  it('returns null on ParameterNotFound', async () => {
    const err = new Error('nope');
    err.name = 'ParameterNotFound';
    send.mockRejectedValue(err);
    expect(await getXaiApiKey()).toBeNull();
  });

  it('rethrows other errors and does not cache them', async () => {
    const err = new Error('denied');
    err.name = 'AccessDeniedException';
    send.mockRejectedValueOnce(err);
    await expect(getXaiApiKey()).rejects.toThrow('denied');
    send.mockResolvedValueOnce({ Parameter: { Value: 'k2' } });
    expect(await getXaiApiKey()).toBe('k2');
  });
});

describe('getXaiApiKey missing-key behaviour', () => {
  it('does not cache a missing key, so adding it later takes effect', async () => {
    __resetXaiKeyCacheForTests();
    const send = jest.spyOn(SSMClient.prototype, 'send');
    const err = new Error('nope');
    err.name = 'ParameterNotFound';
    send.mockRejectedValueOnce(err);
    expect(await getXaiApiKey()).toBeNull();
    send.mockResolvedValueOnce({ Parameter: { Value: 'late' } } as never);
    expect(await getXaiApiKey()).toBe('late');
    send.mockRestore();
  });
});
