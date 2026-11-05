/**
 * On Amplify the SSR server has no ambient AWS credentials: every AWS call in
 * the site signs with the app user's keys from `awsConfig`. The xAI key read
 * must too, or it fails with CredentialsProviderError (seen live 2026-11-05).
 */
jest.mock('@/lib/aws-config', () => ({
  awsConfig: {
    region: 'ca-central-1',
    credentials: { accessKeyId: 'AKIAAPPUSERTEST', secretAccessKey: 'app-secret' },
  },
}));

import { SSMClient } from '@aws-sdk/client-ssm';
import { getXaiApiKey, __resetXaiKeyCacheForTests } from '@/services/video/credentials';

it('signs the SSM read with the app credentials from awsConfig', async () => {
  __resetXaiKeyCacheForTests();
  let signedWith: string | undefined;
  const send = jest.spyOn(SSMClient.prototype, 'send').mockImplementation(async function (this: SSMClient) {
    const creds = await (this.config.credentials as () => Promise<{ accessKeyId: string }>)();
    signedWith = creds.accessKeyId;
    return { Parameter: { Value: 'xai-test-key' } } as never;
  });
  expect(await getXaiApiKey()).toBe('xai-test-key');
  expect(signedWith).toBe('AKIAAPPUSERTEST');
  send.mockRestore();
});
