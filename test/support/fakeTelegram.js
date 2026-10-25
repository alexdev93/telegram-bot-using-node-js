const http = require("http");

// Local stand-in for the Bot API. Each test sets `respond` to script the replies
async function startFakeTelegram() {
  const fake = {
    calls: [],
    respond: () => ({ status: 200, json: { ok: true, result: { message_id: 42 } } }),
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const call = { path: req.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
      fake.calls.push(call);
      const reply = fake.respond(call, fake.calls.length);
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      if (res.destroyed) return;
      res.writeHead(reply.status, { "Content-Type": "application/json" });
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

module.exports = { startFakeTelegram };
