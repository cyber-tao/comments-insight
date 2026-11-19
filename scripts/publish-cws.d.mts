export const CWS_SCOPE: string;
export const DEFAULT_TOKEN_URI: string;
export const CWS_API_BASE: string;
export const CWS_UPLOAD_BASE: string;

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface PublishCliOptions {
  filePath: string;
  publisherId: string;
  extensionId: string;
  publish: boolean;
  publishType?: string;
  deployPercentage?: string;
  skipReview?: boolean;
  blockOnWarnings?: boolean;
}

export interface PublishSummary {
  publisherId: string;
  extensionId: string;
  crxVersion: string | null;
  uploadState: string;
  published: boolean;
  publishState: string | null;
  warnings: Array<{ reason?: string; description?: string }>;
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey;
export function createServiceAccountJwt(
  serviceAccount: ServiceAccountKey,
  options?: { nowSeconds?: number; lifetimeSeconds?: number; scope?: string },
): string;
export function exchangeJwtForAccessToken(
  serviceAccount: ServiceAccountKey,
  fetchImpl?: typeof fetch,
): Promise<string>;
export function exchangeRefreshTokenForAccessToken(
  credentials: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl?: typeof fetch,
): Promise<string>;
export function resolveAccessToken(
  env?: Record<string, string | undefined>,
  fetchImpl?: typeof fetch,
): Promise<string>;
export function uploadPackage(
  params: { publisherId: string; extensionId: string; filePath: string; accessToken: string },
  fetchImpl?: typeof fetch,
): Promise<{ name?: string; itemId?: string; crxVersion?: string; uploadState?: string }>;
export function fetchItemStatus(
  params: { publisherId: string; extensionId: string; accessToken: string },
  fetchImpl?: typeof fetch,
): Promise<{
  lastAsyncUploadState?: string;
  submittedItemRevisionStatus?: {
    distributionChannels?: Array<{ crxVersion?: string; deployPercentage?: number }>;
  };
}>;
export function waitForUploadCompletion(
  params: {
    publisherId: string;
    extensionId: string;
    accessToken: string;
    initialUploadState?: string;
    pollIntervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  },
  fetchImpl?: typeof fetch,
): Promise<{
  uploadState: string;
  status: Awaited<ReturnType<typeof fetchItemStatus>> | null;
}>;
export function publishItem(
  params: {
    publisherId: string;
    extensionId: string;
    accessToken: string;
    publishType?: string;
    deployPercentage?: string | number;
    skipReview?: boolean;
    blockOnWarnings?: boolean;
  },
  fetchImpl?: typeof fetch,
): Promise<{
  name?: string;
  itemId?: string;
  state?: string;
  warningInfo?: { warnings?: Array<{ reason?: string; description?: string }> };
}>;
export function parseCliArgs(
  argv: string[],
  env?: Record<string, string | undefined>,
): PublishCliOptions;
export function runPublish(
  options: PublishCliOptions,
  deps?: {
    fetchImpl?: typeof fetch;
    env?: Record<string, string | undefined>;
    log?: (...args: unknown[]) => void;
    pollIntervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<PublishSummary>;
