import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los .md de skills/ se leen del filesystem en runtime (lib/ai/skills.ts),
  // no se importan como modulos JS — sin esto, Vercel no los incluye en el
  // bundle de la funcion serverless y el sync/draft falla en produccion.
  outputFileTracingIncludes: {
    '/api/sync': ['./skills/**/*.md'],
  },
};

export default nextConfig;
