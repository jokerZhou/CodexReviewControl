import 'dotenv/config';

const toPort = (value: string | undefined) => {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }
  return port;
};

export const env = {
  host: process.env.HOST ?? '0.0.0.0',
  port: toPort(process.env.PORT),
  websiteOrigin: process.env.WEBSITE_ORIGIN ?? 'http://localhost:3000'
};
