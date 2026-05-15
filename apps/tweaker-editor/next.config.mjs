import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: __dirname },
  transpilePackages: ['tweakpane', '@tweakpane/plugin-essentials', '@tweakpane/core'],
};

export default nextConfig;
