class Router {
  constructor() {
    this.routes = [];
    this.middleware = [];
  }

  use(handler) {
    this.middleware.push(handler);
  }

  get(path, ...handlers) {
    this.register('GET', path, handlers);
  }

  post(path, ...handlers) {
    this.register('POST', path, handlers);
  }

  register(method, path, handlers) {
    const names = [];
    const expression = path.split('/').map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');

    this.routes.push({
      method,
      expression: new RegExp(`^${expression}/?$`),
      names,
      handlers
    });
  }

  async handle(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');

    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Request tidak valid.');
      return;
    }

    const route = this.routes.find((candidate) => candidate.method === request.method
      && candidate.expression.test(pathname));

    if (!route) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Halaman tidak ditemukan.');
      return;
    }

    const match = pathname.match(route.expression);
    request.params = {};
    try {
      route.names.forEach((name, index) => {
        request.params[name] = decodeURIComponent(match[index + 1]);
      });
    } catch {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Parameter URL tidak valid.');
      return;
    }

    await this.run([...this.middleware, ...route.handlers], request, response);
  }

  async run(handlers, request, response, index = 0) {
    if (index >= handlers.length || response.writableEnded) {
      return;
    }

    let nextCalled = false;
    await handlers[index](request, response, async () => {
      if (nextCalled) {
        throw new Error('Middleware memanggil next() lebih dari sekali.');
      }
      nextCalled = true;
      await this.run(handlers, request, response, index + 1);
    });
  }
}

module.exports = Router;
