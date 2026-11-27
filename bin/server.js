#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createServer, localApp } from '../src/server.js';

const { values } = parseArgs({ options: { http: { type: 'boolean' }, port: { type: 'string' } } });
if (values.http) {
  const port = Number(values.port ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  localApp().listen(port, '127.0.0.1', err => {
    if (err) throw err;
    console.error(`Listening at http://127.0.0.1:${port}/mcp`);
  });
} else {
  if (values.port != null) throw new Error('--port requires --http');
  await createServer().connect(new StdioServerTransport());
}
