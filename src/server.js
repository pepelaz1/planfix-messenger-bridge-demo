import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Bridge } from './bridge.js';
import { DemoMessenger, PlanfixTransport } from './adapters.js';
import { JsonStore } from './storage.js';

const store = await new JsonStore(resolve('data/demo-state.json')).load();
const messenger = new DemoMessenger();
const planfix = new PlanfixTransport({
  url: process.env.PLANFIX_WEBCHAT_URL,
  token: process.env.PLANFIX_TOKEN,
  providerId: process.env.PLANFIX_PROVIDER_ID,
});
const bridge = new Bridge({ store, messenger, planfix });
const port = Number(process.env.PORT || 4177);
const host = '127.0.0.1'; // Демонстрационные команды не публикуются в сеть.

async function parseBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Слишком большое тело запроса');
  }
  if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  return body ? JSON.parse(body) : {};
}

function respond(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/state') {
      return respond(res, 200, { ...store.state, messengerCalls: messenger.calls,
        planfixCalls: planfix.calls });
    }
    if (req.method !== 'POST') return respond(res, 404, { error: 'Not found' });
    const input = await parseBody(req);
    let result;
    switch (req.url) {
      case '/demo/employees': result = await bridge.addEmployee(input); break;
      case '/demo/contacts': result = await bridge.bindContact(input); break;
      case '/demo/tickets': result = await bridge.openTicket(input); break;
      case '/demo/messenger-events': result = await bridge.onMessengerEvent(input); break;
      case '/webhooks/planfix':
        if (process.env.PLANFIX_INBOUND_TOKEN && input.token !== process.env.PLANFIX_INBOUND_TOKEN) {
          return respond(res, 401, { error: 'Invalid token' });
        }
        result = await bridge.onPlanfixMessage(input); break;
      default: return respond(res, 404, { error: 'Not found' });
    }
    respond(res, 200, result);
  } catch (error) { respond(res, 400, { error: error.message }); }
}).listen(port, host, () => console.log(`Демо-сервис: http://${host}:${port}`));
