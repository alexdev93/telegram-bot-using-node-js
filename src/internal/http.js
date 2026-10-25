class HttpError extends Error {
  constructor(status, code, message, { headers, details, reason } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.details = details;
    // Logged for operators, never sent to the caller
    this.reason = reason;
  }
}

function readBody(req, limit) {
  const tooLarge = () =>
    new HttpError(413, "payload_too_large", `Body must be at most ${limit} bytes`, {
      headers: { Connection: "close" },
    });

  if (Number(req.headers["content-length"]) > limit) return Promise.reject(tooLarge());

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

module.exports = { HttpError, readBody, sendJson };
