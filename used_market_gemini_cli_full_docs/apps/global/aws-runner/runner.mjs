const port = String(process.env.PORT || '8790');
if (port !== '8790') {
  throw new Error(`Global runner requires PORT=8790, received ${port}`);
}
process.env.PORT = port;
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'production';
process.env.PUBLIC_API_ONLY = 'true';
if (!String(process.env.CLOUDFLARE_RUNNER_TOKEN || '').trim()) {
  throw new Error('Global runner requires CLOUDFLARE_RUNNER_TOKEN');
}

await import('../dist/web-backend/logic/index.js');
