const http = require("http");
const { verifyRequest } = require("../../src/internal/auth");

// Local stand-in for the auth service's bot-access endpoint. Every request is checked with the
// same verifyRequest the bot uses for its own API, so passing tests prove the signatures match
async function startFakeAuthService({ clientId, secret }) {
  const fake = {
    calls: [],
    respond: () => ({ status: 200, json: { duplicate: false, applied: true } }),
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let verified = true;
      try {
        verifyRequest({
          clients: new Map([[clientId, [secret]]]),
          headers: req.headers,
          method: req.method,
          path: req.url,
          body: raw,
          nowMs: Date.now(),
        });
      } catch {
        verified = false;
      }
      const call = { path: req.url, headers: req.headers, body: JSON.parse(raw.toString("utf8")), verified };
      fake.calls.push(call);
      const reply = verified ? fake.respond(call, fake.calls.length) : { status: 401, json: {} };
      res.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.json));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  return fake;
}

module.exports = { startFakeAuthService };
