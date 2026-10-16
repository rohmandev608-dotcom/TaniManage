const MAX_BODY_BYTES = 16 * 1024;

function parseFormBody(request, response, next) {
  if (request.method !== 'POST') {
    request.body = {};
    return next();
  }

  const contentType = request.headers['content-type'] || '';
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(contentType)) {
    response.writeHead(415, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Gunakan form dengan content type yang didukung.');
    return;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    request.on('data', (chunk) => {
      if (rejected) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        response.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Ukuran request terlalu besar.');
        request.resume();
        resolve();
        return;
      }
      chunks.push(chunk);
    });

    request.on('error', reject);
    request.on('end', async () => {
      if (rejected) {
        resolve();
        return;
      }

      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      request.body = {};
      for (const [key, value] of params) {
        if (Object.hasOwn(request.body, key)) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Form berisi field duplikat.');
          resolve();
          return;
        }
        request.body[key] = value;
      }

      try {
        await next();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

module.exports = { parseFormBody };
