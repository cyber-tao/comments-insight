import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CWS_SCOPE,
  createServiceAccountJwt,
  parseCliArgs,
  parseServiceAccountKey,
  resolveAccessToken,
  runPublish,
} from '../scripts/publish-cws.mjs';

function createEphemeralKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function makeJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('publish-cws (Chrome Web Store API v2)', () => {
  let tempDir: string;
  let zipPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cws-publish-test-'));
    zipPath = path.join(tempDir, 'extension.zip');
    await fs.writeFile(zipPath, Buffer.from('PK\x03\x04test-zip-payload'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('parses raw and base64-encoded service account JSON keys and rejects invalid ones', () => {
    const { privateKey } = createEphemeralKeyPair();
    const rawJson = JSON.stringify({
      client_email: 'cws-bot@example.iam.gserviceaccount.com',
      private_key: privateKey,
    });

    const parsedRaw = parseServiceAccountKey(rawJson);
    expect(parsedRaw.client_email).toBe('cws-bot@example.iam.gserviceaccount.com');
    expect(parsedRaw.token_uri).toBe('https://oauth2.googleapis.com/token');

    const parsedB64 = parseServiceAccountKey(Buffer.from(rawJson, 'utf8').toString('base64'));
    expect(parsedB64).toEqual(parsedRaw);

    expect(() => parseServiceAccountKey('')).toThrow(/empty/i);
    expect(() => parseServiceAccountKey('not-json')).toThrow(/Invalid Chrome Web Store/i);
    expect(() => parseServiceAccountKey(JSON.stringify({ client_email: 'only@email' }))).toThrow(
      /private_key/i,
    );
  });

  it('creates a valid RS256 JWT verifiable against the matching public key', () => {
    const { publicKey, privateKey } = createEphemeralKeyPair();
    const jwt = createServiceAccountJwt(
      {
        client_email: 'cws-bot@example.iam.gserviceaccount.com',
        private_key: privateKey,
        token_uri: 'https://oauth2.googleapis.com/token',
      },
      { nowSeconds: 1_700_000_000 },
    );

    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const [encodedHeader, encodedPayload, encodedSig] = parts;

    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toEqual({
      iss: 'cws-bot@example.iam.gserviceaccount.com',
      scope: CWS_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(encodedSig, 'base64url'))).toBe(true);
  });

  it('resolves access tokens in priority order (OIDC token > Service Account > OAuth2)', async () => {
    const { privateKey } = createEphemeralKeyPair();
    const saKey = JSON.stringify({
      client_email: 'cws-bot@example.iam.gserviceaccount.com',
      private_key: privateKey,
    });

    const directFetch = vi.fn();
    expect(
      await resolveAccessToken(
        { CHROME_ACCESS_TOKEN: 'oidc-token', CHROME_SERVICE_ACCOUNT_KEY: saKey },
        directFetch,
      ),
    ).toBe('oidc-token');
    expect(directFetch).not.toHaveBeenCalled();

    const saFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ access_token: 'sa-access-token' }));
    expect(
      await resolveAccessToken(
        {
          CHROME_SERVICE_ACCOUNT_KEY: saKey,
          CHROME_CLIENT_ID: 'cid',
          CHROME_CLIENT_SECRET: 'csec',
          CHROME_REFRESH_TOKEN: 'rtok',
        },
        saFetch,
      ),
    ).toBe('sa-access-token');
    expect(saFetch).toHaveBeenCalledOnce();
    expect(String(saFetch.mock.calls[0][1].body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    );

    const oauthFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ access_token: 'oauth-access-token' }));
    expect(
      await resolveAccessToken(
        {
          CHROME_CLIENT_ID: 'cid',
          CHROME_CLIENT_SECRET: 'csec',
          CHROME_REFRESH_TOKEN: 'rtok',
        },
        oauthFetch,
      ),
    ).toBe('oauth-access-token');
    expect(oauthFetch).toHaveBeenCalledOnce();

    await expect(resolveAccessToken({}, vi.fn())).rejects.toThrow(
      /Missing Chrome Web Store credentials/i,
    );
  });

  it('uploads in draft mode without calling :publish when upload succeeds immediately', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeJsonResponse({
        name: 'publishers/pub-1/items/ext-1',
        itemId: 'ext-1',
        crxVersion: '0.12.1',
        uploadState: 'SUCCEEDED',
      }),
    );

    const summary = await runPublish(
      parseCliArgs(['--file', zipPath, '--draft'], {
        CHROME_PUBLISHER_ID: 'pub-1',
        CHROME_EXTENSION_ID: 'ext-1',
      }),
      {
        fetchImpl: fetchMock,
        env: { CHROME_ACCESS_TOKEN: 'secret-token-value' },
        log: vi.fn(),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://chromewebstore.googleapis.com/upload/v2/publishers/pub-1/items/ext-1:upload',
    );
    expect(summary).toMatchObject({
      crxVersion: '0.12.1',
      uploadState: 'SUCCEEDED',
      published: false,
      publishState: null,
    });
  });

  it('polls :fetchStatus when upload is async and then publishes with staged options', async () => {
    const { privateKey } = createEphemeralKeyPair();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'sa-token-xyz' }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          name: 'publishers/pub-1/items/ext-1',
          itemId: 'ext-1',
          uploadState: 'IN_PROGRESS',
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          lastAsyncUploadState: 'UPLOAD_IN_PROGRESS',
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          lastAsyncUploadState: 'SUCCEEDED',
          submittedItemRevisionStatus: {
            distributionChannels: [{ crxVersion: '0.12.1', deployPercentage: 25 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          name: 'publishers/pub-1/items/ext-1',
          itemId: 'ext-1',
          state: 'PENDING_REVIEW',
          warningInfo: { warnings: [] },
        }),
      );

    const sleep = vi.fn().mockResolvedValue(undefined);
    const summary = await runPublish(
      parseCliArgs(
        [
          '--file',
          zipPath,
          '--publish',
          '--publish-type',
          'STAGED_PUBLISH',
          '--deploy-percentage',
          '25',
        ],
        {
          CHROME_PUBLISHER_ID: 'pub-1',
          CHROME_EXTENSION_ID: 'ext-1',
        },
      ),
      {
        fetchImpl: fetchMock,
        env: {
          CHROME_SERVICE_ACCOUNT_KEY: JSON.stringify({
            client_email: 'bot@example.iam.gserviceaccount.com',
            private_key: privateKey,
          }),
        },
        pollIntervalMs: 1,
        maxAttempts: 5,
        sleep,
        log: vi.fn(),
      },
    );

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/ext-1:fetchStatus',
    );
    expect(fetchMock.mock.calls[4][0]).toBe(
      'https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/ext-1:publish',
    );
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({
      publishType: 'STAGED_PUBLISH',
      deployInfos: [{ deployPercentage: 25 }],
    });
    expect(summary).toMatchObject({
      crxVersion: '0.12.1',
      uploadState: 'SUCCEEDED',
      published: true,
      publishState: 'PENDING_REVIEW',
    });
  });

  it('fails cleanly on FAILED upload state, poll timeout, or HTTP errors without leaking secrets', async () => {
    const { privateKey } = createEphemeralKeyPair();
    const secretToken = 'super-secret-bearer-token';

    const failedUploadFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ uploadState: 'FAILED' }));
    await expect(
      runPublish(
        { filePath: zipPath, publisherId: 'pub-1', extensionId: 'ext-1', publish: true },
        {
          fetchImpl: failedUploadFetch,
          env: { CHROME_ACCESS_TOKEN: secretToken },
          log: vi.fn(),
        },
      ),
    ).rejects.toThrow(/upload failed/i);

    const timeoutFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ uploadState: 'IN_PROGRESS' }))
      .mockImplementation(async () => makeJsonResponse({ lastAsyncUploadState: 'IN_PROGRESS' }));
    await expect(
      runPublish(
        { filePath: zipPath, publisherId: 'pub-1', extensionId: 'ext-1', publish: true },
        {
          fetchImpl: timeoutFetch,
          env: { CHROME_ACCESS_TOKEN: secretToken },
          pollIntervalMs: 1,
          maxAttempts: 2,
          sleep: vi.fn().mockResolvedValue(undefined),
          log: vi.fn(),
        },
      ),
    ).rejects.toThrow(/Timed out waiting/i);

    const tokenErrorFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(
          { error: 'invalid_grant', error_description: 'Invalid JWT Signature' },
          400,
        ),
      );
    let caughtError: unknown = null;
    try {
      await resolveAccessToken(
        {
          CHROME_SERVICE_ACCOUNT_KEY: JSON.stringify({
            client_email: 'bot@example.iam.gserviceaccount.com',
            private_key: privateKey,
          }),
        },
        tokenErrorFetch,
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    if (caughtError instanceof Error) {
      expect(caughtError.message).toContain('HTTP 400');
      expect(caughtError.message).not.toContain(privateKey);
      expect(caughtError.message).not.toContain('BEGIN PRIVATE KEY');
    }
  });
});
