# Error Handling and Logging System

This directory contains the unified error handling and structured logging system for the Comments Insight extension.

## Error Handling (`errors.ts`)

### Overview
The error handling system provides:
- **Unified error types** with specific error codes
- **Automatic retry logic** with exponential backoff
- **User-friendly error messages**
- **Error categorization** (retryable vs non-retryable)

### Usage

#### Creating Errors

```typescript
import { ExtensionError, ErrorCode, createAIError, createNetworkError } from '../utils/errors';

// Create a specific error
throw new ExtensionError(
  ErrorCode.AI_RATE_LIMIT,
  'Rate limit exceeded',
  { retryAfter: 60 },
  true // retryable
);

// Use helper functions
throw createAIError(ErrorCode.AI_TIMEOUT, 'Request timed out');
throw createNetworkError('Failed to connect to API');
```

#### Handling Errors

```typescript
import { ErrorHandler } from '../utils/errors';

try {
  // Your code
} catch (error) {
  await ErrorHandler.handleError(error as Error, 'MyService.myMethod');
  throw error;
}
```

#### Using Retry Logic

```typescript
import { ErrorHandler } from '../utils/errors';

const result = await ErrorHandler.withRetry(
  async () => {
    // Your async operation
    return await someApiCall();
  },
  'MyService.apiCall',
  {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
  }
);
```

### Error Codes

The system includes error codes for:
- **Network errors**: `NETWORK_ERROR`, `API_ERROR`, `TIMEOUT_ERROR`
- **AI errors**: `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_INVALID_RESPONSE`, `AI_QUOTA_EXCEEDED`
- **Storage errors**: `STORAGE_QUOTA_EXCEEDED`, `STORAGE_ERROR`
- **Configuration errors**: `INVALID_CONFIG`, `MISSING_API_KEY`
- **Task errors**: `TASK_NOT_FOUND`, `TASK_CANCELLED`
- **Extraction errors**: `PLATFORM_NOT_SUPPORTED`, `EXTRACTION_FAILED`, `NO_COMMENTS_FOUND`

## Logging System (`logger.ts`)

### Overview
The structured logging system provides:
- **Multiple log levels**: DEBUG, INFO, WARN, ERROR
- **Environment-aware logging** (development vs production)
- **Console and storage output**
- **Automatic log rotation**
- **Log querying and export**

### Usage

#### Basic Logging

```typescript
import { Logger } from '../utils/logger';

// Different log levels
Logger.debug('Debug message', { data: 'value' });
Logger.info('Info message', { count: 10 });
Logger.warn('Warning message', { issue: 'something' });
Logger.error('Error message', { error: errorObject });
```

#### Configuration

```typescript
import { Logger, LogLevel } from '../utils/logger';

// Configure logger
Logger.configure({
  minLevel: LogLevel.DEBUG,
  enableConsole: true,
  enableStorage: true,
  maxStoredLogs: 100,
});

// Check environment
if (Logger.isDev()) {
  Logger.debug('Running in development mode');
}
```

#### Querying Logs

```typescript
import { Logger, LogLevel } from '../utils/logger';

// Get all logs
const allLogs = await Logger.getLogs();

// Get error logs only
const errorLogs = await Logger.getLogs(LogLevel.ERROR);

// Get limited number of logs
const recentLogs = await Logger.getLogs(undefined, 50);

// Get log statistics
const stats = await Logger.getLogStats();
console.log(`Total logs: ${stats.total}`);
console.log(`Errors: ${stats.byLevel.ERROR}`);

// Export logs
const logsJson = await Logger.exportLogs();

// Clear all logs
await Logger.clearLogs();
```

### Log Levels

- **DEBUG**: Detailed information for debugging (only in development)
- **INFO**: General informational messages
- **WARN**: Warning messages for potential issues
- **ERROR**: Error messages for failures

### Environment Detection

The logger automatically detects the environment:
- **Development**: Shows all log levels (DEBUG and above)
- **Production**: Shows only errors (ERROR level)

Detection is based on:
- Manifest version (0.0.0 or contains "dev" = development)
- Presence of `update_url` in manifest (no update_url = development)

## Log Viewer

The extension includes a log viewer page at `chrome-extension://[id]/src/logs/index.html` that displays:
- **AI logs**: Extraction and analysis prompts/responses
- **System logs**: All application logs with filtering
- **Error logs**: Quick access to error messages
- **Log statistics**: Overview of log counts by type

### Features
- Filter by log type (All, AI, System, Errors)
- View detailed log information
- Copy logs to clipboard
- Export logs as JSON
- Clear all logs

## Best Practices

### Error Handling
1. Always use specific error codes
2. Include relevant context in error details
3. Mark errors as retryable when appropriate
4. Use `ErrorHandler.withRetry()` for network operations
5. Provide user-friendly error messages

### Logging
1. Use appropriate log levels
2. Include structured data in log entries
3. Don't log sensitive information (API keys, passwords)
4. Use descriptive messages with context
5. Log errors with full error objects

### Example: Complete Error Handling

```typescript
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode, createAIError } from '../utils/errors';

async function fetchDataWithRetry() {
  Logger.info('[MyService] Starting data fetch');
  
  try {
    const result = await ErrorHandler.withRetry(
      async () => {
        Logger.debug('[MyService] Attempting API call');
        
        const response = await fetch('https://api.example.com/data');
        
        if (!response.ok) {
          if (response.status === 429) {
            throw createAIError(
              ErrorCode.AI_RATE_LIMIT,
              'Rate limit exceeded',
              { status: response.status }
            );
          }
          throw new Error(`API error: ${response.status}`);
        }
        
        return await response.json();
      },
      'MyService.fetchData',
      {
        maxAttempts: 3,
        initialDelay: 1000,
      }
    );
    
    Logger.info('[MyService] Data fetched successfully', { 
      itemCount: result.length 
    });
    
    return result;
  } catch (error) {
    Logger.error('[MyService] Failed to fetch data', { error });
    await ErrorHandler.handleError(error as Error, 'MyService.fetchData');
    throw error;
  }
}
```

## Migration Guide

To migrate existing code to use the new error handling and logging:

### Replace console.log/error

**Before:**
```typescript
console.log('[Service] Starting operation');
console.error('[Service] Operation failed:', error);
```

**After:**
```typescript
Logger.info('[Service] Starting operation');
Logger.error('[Service] Operation failed', { error });
```

### Add Error Handling

**Before:**
```typescript
try {
  await someOperation();
} catch (error) {
  console.error('Failed:', error);
  throw error;
}
```

**After:**
```typescript
try {
  await someOperation();
} catch (error) {
  await ErrorHandler.handleError(error as Error, 'Service.operation');
  throw error;
}
```

### Use Retry Logic

**Before:**
```typescript
let retries = 3;
while (retries > 0) {
  try {
    return await apiCall();
  } catch (error) {
    retries--;
    if (retries === 0) throw error;
    await sleep(1000);
  }
}
```

**After:**
```typescript
return await ErrorHandler.withRetry(
  () => apiCall(),
  'Service.apiCall',
  { maxAttempts: 3 }
);
```
