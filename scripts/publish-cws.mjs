import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const CWS_API_BASE = 'https://chromewebstore.googleapis.com/v2';
export const CWS_UPLOAD_BASE = 'https://chromewebstore.googleapis.com/upload/v2';
const VALID_PUBLISH_TYPES = new Set(['DEFAULT_PUBLISH', 'STAGED_PUBLISH']);
const IN_PROGRESS_UPLOAD_STATES = new Set([
  'IN_PROGRESS',
  'UPLOAD_IN_PROGRESS',
  'UPLOAD_STATE_UNSPECIFIED',
]);

function extractSafeOAuthError(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const parts = [];
  if (typeof payload.error === 'string' && payload.error) {
    parts.push(payload.error);
  }
  if (typeof payload.error_description === 'string' && payload.error_description) {
    parts.push(payload.error_description);
  }
  if (
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.message === 'string'
  ) {
    parts.push(payload.error.message);
  }
  return parts.join(': ');
}

async function parseJsonSafe(response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { rawText: raw };
  }
}

export function parseServiceAccountKey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('CHROME_SERVICE_ACCOUNT_KEY is empty or not a string.');
  }

  const trimmed = raw.trim();
  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      parsed = JSON.parse(decoded);
    } catch {
      throw new Error(
        'Invalid Chrome Web Store service account JSON (expected raw or base64 JSON).',
      );
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Chrome Web Store service account JSON object.');
  }

  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key.trim() : '';
  const tokenUri =
    typeof parsed.token_uri === 'string' && parsed.token_uri.trim()
      ? parsed.token_uri.trim()
      : DEFAULT_TOKEN_URI;

  if (!clientEmail || !privateKey) {
    throw new Error('Service account JSON must contain non-empty client_email and private_key.');
  }

  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: tokenUri,
  };
}

export function createServiceAccountJwt(serviceAccount, options = {}) {
  const nowSeconds =
    typeof options.nowSeconds === 'number' && Number.isFinite(options.nowSeconds)
      ? Math.floor(options.nowSeconds)
      : Math.floor(Date.now() / 1000);
  const lifetimeSeconds =
    typeof options.lifetimeSeconds === 'number' && Number.isFinite(options.lifetimeSeconds)
      ? options.lifetimeSeconds
      : 3600;
  const scope = options.scope ?? CWS_SCOPE;
  const audience = serviceAccount.token_uri || DEFAULT_TOKEN_URI;

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
      aud: audience,
      iat: nowSeconds,
      exp: nowSeconds + lifetimeSeconds,
    }),
  ).toString('base64url');

  const unsignedToken = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, 'base64url');

  return `${unsignedToken}.${signature}`;
}

export async function exchangeJwtForAccessToken(serviceAccount, fetchImpl = fetch) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const detail = extractSafeOAuthError(data);
    throw new Error(
      `Failed to exchange service account JWT for access token (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('OAuth token endpoint response did not include an access_token.');
  }

  return data.access_token;
}

export async function exchangeRefreshTokenForAccessToken(
  { clientId, clientSecret, refreshToken },
  fetchImpl = fetch,
) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth credentials require clientId, clientSecret, and refreshToken.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetchImpl(DEFAULT_TOKEN_URI, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    const detail = extractSafeOAuthError(data);
    throw new Error(
      `Failed to refresh Chrome Web Store OAuth access token (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }

  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('OAuth refresh response did not include an access_token.');
  }

  return data.access_token;
}

export async function resolveAccessToken(env = process.env, fetchImpl = fetch) {
  const directToken = env.CHROME_ACCESS_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const rawServiceAccount = env.CHROME_SERVICE_ACCOUNT_KEY?.trim();
  if (rawServiceAccount) {
    const serviceAccount = parseServiceAccountKey(rawServiceAccount);
    return exchangeJwtForAccessToken(serviceAccount, fetchImpl);
  }

  const clientId = env.CHROME_CLIENT_ID?.trim();
  const clientSecret = env.CHROME_CLIENT_SECRET?.trim();
  const refreshToken = env.CHROME_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) {
    return exchangeRefreshTokenForAccessToken({ clientId, clientSecret, refreshToken }, fetchImpl);
  }

  throw new Error(
    'Missing Chrome Web Store credentials. Provide CHROME_ACCESS_TOKEN (OIDC), CHROME_SERVICE_ACCOUNT_KEY (Service Account JSON), or CHROME_CLIENT_ID + CHROME_CLIENT_SECRET + CHROME_REFRESH_TOKEN.',
  );
}

function formatCwsApiError(action, response, data) {
  const message =
    data?.error && typeof data.error === 'object' && typeof data.error.message === 'string'
      ? data.error.message
      : typeof data?.rawText === 'string'
        ? data.rawText.slice(0, 300)
        : '';
  return new Error(
    `Chrome Web Store API ${action} failed (HTTP ${response.status})${message ? `: ${message}` : ''}`,
  );
}

export async function uploadPackage(
  { publisherId, extensionId, filePath, accessToken },
  fetchImpl = fetch,
) {
  const zipBuffer = await fs.readFile(filePath);
  if (!zipBuffer || zipBuffer.byteLength === 0) {
    throw new Error(`Extension archive is empty: ${filePath}`);
  }

  const url = `${CWS_UPLOAD_BASE}/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:upload`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/zip',
    },
    body: zipBuffer,
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw formatCwsApiError('upload', response, data);
  }

  return data;
}

export async function fetchItemStatus(
  { publisherId, extensionId, accessToken },
  fetchImpl = fetch,
) {
  const url = `${CWS_API_BASE}/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:fetchStatus`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw formatCwsApiError('fetchStatus', response, data);
  }

  return data;
}

export async function waitForUploadCompletion(
  {
    publisherId,
    extensionId,
    accessToken,
    initialUploadState,
    pollIntervalMs = 5000,
    maxAttempts = 36,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
  fetchImpl = fetch,
) {
  if (initialUploadState === 'SUCCEEDED') {
    return { uploadState: 'SUCCEEDED', status: null };
  }
  if (initialUploadState === 'FAILED') {
    throw new Error('Chrome Web Store package upload failed.');
  }
  if (initialUploadState !== 'IN_PROGRESS' && initialUploadState !== 'UPLOAD_IN_PROGRESS') {
    throw new Error(`Unexpected Chrome Web Store uploadState: ${String(initialUploadState)}`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }

    const status = await fetchItemStatus({ publisherId, extensionId, accessToken }, fetchImpl);
    const asyncState = status?.lastAsyncUploadState;

    if (asyncState === 'SUCCEEDED') {
      return { uploadState: 'SUCCEEDED', status };
    }
    if (asyncState === 'FAILED' || asyncState === 'NOT_FOUND') {
      throw new Error(`Chrome Web Store async upload ended with state: ${asyncState}`);
    }
    if (asyncState && !IN_PROGRESS_UPLOAD_STATES.has(asyncState)) {
      throw new Error(`Unexpected Chrome Web Store lastAsyncUploadState: ${String(asyncState)}`);
    }
  }

  throw new Error(
    `Timed out waiting for Chrome Web Store upload completion after ${maxAttempts} poll attempt(s).`,
  );
}

export async function publishItem(
  {
    publisherId,
    extensionId,
    accessToken,
    publishType,
    deployPercentage,
    skipReview,
    blockOnWarnings,
  },
  fetchImpl = fetch,
) {
  const payload = {};

  if (publishType !== undefined && publishType !== '') {
    if (!VALID_PUBLISH_TYPES.has(publishType)) {
      throw new Error(
        `Invalid publishType "${publishType}". Expected DEFAULT_PUBLISH or STAGED_PUBLISH.`,
      );
    }
    payload.publishType = publishType;
  }

  const normalizedDeployPercentage =
    typeof deployPercentage === 'string' ? deployPercentage.trim() : deployPercentage;
  if (normalizedDeployPercentage !== undefined && normalizedDeployPercentage !== '') {
    const parsedPct =
      typeof normalizedDeployPercentage === 'number'
        ? normalizedDeployPercentage
        : Number(String(normalizedDeployPercentage));
    if (!Number.isInteger(parsedPct) || parsedPct < 0 || parsedPct > 100) {
      throw new Error(
        `Invalid deployPercentage "${String(deployPercentage)}". Expected integer 0-100.`,
      );
    }
    payload.deployInfos = [{ deployPercentage: parsedPct }];
  }

  if (typeof skipReview === 'boolean') {
    payload.skipReview = skipReview;
  }
  if (typeof blockOnWarnings === 'boolean') {
    payload.blockOnWarnings = blockOnWarnings;
  }

  const url = `${CWS_API_BASE}/publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}:publish`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await parseJsonSafe(response);
  if (!response.ok) {
    throw formatCwsApiError('publish', response, data);
  }

  return data;
}

export function parseCliArgs(argv, env = process.env) {
  const options = {
    filePath: env.CWS_FILE_PATH?.trim() || 'dist/extension.zip',
    publisherId: env.CHROME_PUBLISHER_ID?.trim() || '',
    extensionId: env.CHROME_EXTENSION_ID?.trim() || '',
    publish: env.CWS_PUBLISH ? env.CWS_PUBLISH.trim().toLowerCase() !== 'false' : true,
    publishType: env.CWS_PUBLISH_TYPE?.trim() || undefined,
    deployPercentage: env.CWS_DEPLOY_PERCENTAGE?.trim() || undefined,
    skipReview: env.CWS_SKIP_REVIEW
      ? env.CWS_SKIP_REVIEW.trim().toLowerCase() === 'true'
      : undefined,
    blockOnWarnings: env.CWS_BLOCK_ON_WARNINGS
      ? env.CWS_BLOCK_ON_WARNINGS.trim().toLowerCase() === 'true'
      : undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--file':
        options.filePath = argv[++i] ?? '';
        break;
      case '--publisher-id':
        options.publisherId = argv[++i] ?? '';
        break;
      case '--extension-id':
        options.extensionId = argv[++i] ?? '';
        break;
      case '--publish':
        options.publish = true;
        break;
      case '--draft':
        options.publish = false;
        break;
      case '--publish-type':
        options.publishType = argv[++i];
        break;
      case '--deploy-percentage':
        options.deployPercentage = argv[++i];
        break;
      case '--skip-review':
        options.skipReview = true;
        break;
      case '--block-on-warnings':
        options.blockOnWarnings = true;
        break;
      default:
        throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  return options;
}

export async function runPublish(options, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.log;

  const publisherId = options.publisherId?.trim();
  const extensionId = options.extensionId?.trim();
  const filePath = options.filePath?.trim();

  if (!publisherId) {
    throw new Error('CHROME_PUBLISHER_ID (or --publisher-id) is required.');
  }
  if (!extensionId) {
    throw new Error('CHROME_EXTENSION_ID (or --extension-id) is required.');
  }
  if (!filePath) {
    throw new Error('Package file path (--file) is required.');
  }

  const accessToken = await resolveAccessToken(env, fetchImpl);

  log(
    `Uploading ${path.basename(filePath)} to Chrome Web Store (publisher=${publisherId}, item=${extensionId})...`,
  );
  const uploadResult = await uploadPackage(
    { publisherId, extensionId, filePath, accessToken },
    fetchImpl,
  );

  const completion = await waitForUploadCompletion(
    {
      publisherId,
      extensionId,
      accessToken,
      initialUploadState: uploadResult.uploadState,
      pollIntervalMs: deps.pollIntervalMs,
      maxAttempts: deps.maxAttempts,
      sleep: deps.sleep,
    },
    fetchImpl,
  );

  let publishResult = null;
  if (options.publish) {
    publishResult = await publishItem(
      {
        publisherId,
        extensionId,
        accessToken,
        publishType: options.publishType,
        deployPercentage: options.deployPercentage,
        skipReview: options.skipReview,
        blockOnWarnings: options.blockOnWarnings,
      },
      fetchImpl,
    );
  }

  const summary = {
    publisherId,
    extensionId,
    crxVersion:
      uploadResult.crxVersion ??
      completion.status?.submittedItemRevisionStatus?.distributionChannels?.[0]?.crxVersion ??
      null,
    uploadState: completion.uploadState,
    published: Boolean(options.publish),
    publishState: publishResult?.state ?? null,
    warnings: publishResult?.warningInfo?.warnings ?? [],
  };

  log(
    `Chrome Web Store ${summary.published ? 'publish' : 'draft upload'} complete: ` +
      `version=${summary.crxVersion ?? 'unknown'}, uploadState=${summary.uploadState}` +
      (summary.publishState ? `, itemState=${summary.publishState}` : ''),
  );
  if (summary.warnings.length > 0) {
    for (const warning of summary.warnings) {
      log(`CWS Warning [${warning.reason}]: ${warning.description}`);
    }
  }

  return summary;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  await runPublish(options);
}

const isEntrypoint =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
