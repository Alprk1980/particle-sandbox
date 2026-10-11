import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),
  output: 'export',
  basePath: '/particle-sandbox',
  images: { unoptimized: true },
};
export default nextConfig;
