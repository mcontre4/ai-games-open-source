import http from 'node:http';
// Only the trusted gateway path is reachable from the isolated agent.
http
  .createServer((req, res) => {
    if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/responses'].includes(req.url)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const upstream = http.request(
      {
        hostname: 'host.docker.internal',
        port: process.env.UPSTREAM_PORT ?? 4101,
        path: req.url,
        method: 'POST',
        headers: { authorization: req.headers.authorization, 'content-type': 'application/json' },
        timeout: 120000,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, {
          'content-type': response.headers['content-type'] ?? 'application/json',
        });
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('{"error":{"message":"Gateway unavailable"}}');
    });
    req.pipe(upstream);
  })
  .listen(4101, '0.0.0.0');
