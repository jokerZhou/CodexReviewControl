import 'dotenv/config';

const toPort = (value: string | undefined) => {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
};

// 改动说明：支持通过 CORS_ALLOWED_ORIGINS 传入逗号分隔的多白名单来源，
// 用于 Windows/局域网访问前端时（例如 http://192.168.x.x:3000）避免被 CORS 拒绝。
const toOriginList = (value: string | undefined): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export const env = {
  host: process.env.HOST ?? '0.0.0.0',
  port: toPort(process.env.PORT),
  websiteOrigin: process.env.WEBSITE_ORIGIN ?? 'http://localhost:3000',
  corsAllowedOrigins: toOriginList(process.env.CORS_ALLOWED_ORIGINS)
};
