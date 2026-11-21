import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** In `npm run dev`, serve /api/explain from api/explain.ts (on Vercel it is a Function). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
      server.middlewares.use('/api/explain', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const mod = await server.ssrLoadModule('/api/explain.ts');
        const out: Response = await mod.POST(new Request('http://localhost/api/explain', { method: 'POST', body: Buffer.concat(chunks).toString() }));
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(await out.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  test: {
    environment: 'node',
    // A full month search takes 1–2 s; regeneration tests run several. Leave room on slow machines.
    testTimeout: 30000,
  },
} as any);
