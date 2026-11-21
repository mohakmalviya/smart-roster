import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** In `npm run dev`, serve /api/<name> from api/<name>.ts the way Vercel Functions do. */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const name = url.pathname.replace(/^\/+|\/+$/g, '');
        const method = req.method ?? 'GET';
        if (!/^[a-z]+$/.test(name)) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          if (typeof mod[method] !== 'function') {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
          const out: Response = await mod[method](new Request(`http://localhost/api/${name}${url.search}`, { method, body }));
          res.statusCode = out.status;
          res.setHeader('Content-Type', out.headers.get('Content-Type') ?? 'application/json');
          res.end(await out.text());
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
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
