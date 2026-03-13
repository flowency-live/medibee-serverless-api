/**
 * Structured logging utility for Medibee Lambdas
 * Outputs JSON for CloudWatch Logs Insights
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

function formatLog(level, message, data = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  });
}

export function createLogger(event, context) {
  const requestId = context?.awsRequestId || 'local';
  const functionName = context?.functionName || 'local';

  // Extract safe request info
  const requestInfo = {
    requestId,
    functionName,
    path: event?.rawPath || event?.path,
    method: event?.requestContext?.http?.method || event?.httpMethod,
    sourceIp: event?.requestContext?.http?.sourceIp || event?.requestContext?.identity?.sourceIp,
  };

  function log(level, message, data = {}) {
    if (LOG_LEVELS[level] >= currentLevel) {
      console.log(formatLog(level, message, { ...requestInfo, ...data }));
    }
  }

  return {
    debug: (message, data) => log('debug', message, data),
    info: (message, data) => log('info', message, data),
    warn: (message, data) => log('warn', message, data),
    error: (message, data) => log('error', message, data),
  };
}

export default createLogger;
