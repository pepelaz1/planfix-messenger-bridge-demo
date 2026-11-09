import { Bridge } from '../src/bridge.js';
import { DemoMessenger, PlanfixTransport } from '../src/adapters.js';

const store = { state: { employees: {}, contacts: {}, tickets: {}, processed: {}, events: [] },
  async save() {} };
const messenger = new DemoMessenger();
const planfix = new PlanfixTransport();
const bridge = new Bridge({ store, messenger, planfix });

await bridge.addEmployee({ crmUserId: 'employee-1', email: 'employee@example.test',
  telegramUserId: 'tg-worker-1', maxUserId: 'max-worker-1' });
await bridge.bindContact({ crmUserId: 'employee-1', crmContactId: 'contact-17',
  name: 'Анна', telegramContactId: 'tg-anna', maxContactId: 'max-anna' });
const ticket = await bridge.openTicket({ channel: 'telegram', crmUserId: 'employee-1',
  crmContactId: 'contact-17', crmTicketId: 'ticket-42', title: 'Заказ №42',
  description: 'Уточнение доставки' });
const inbound = await bridge.onMessengerEvent({ channel: 'telegram', crmUserId: 'employee-1',
  peerId: 'tg-anna', groupId: ticket.groupId, messageId: 'tg-message-1',
  message: 'Когда привезут заказ?' });
const outbound = await bridge.onPlanfixMessage({ cmd: 'newMessage', chatId: inbound.chatId,
  messageId: 'crm-message-1', message: 'Завтра после 12:00' });
const ignored = await bridge.onMessengerEvent({ channel: 'telegram', crmUserId: 'employee-1',
  peerId: 'unknown', messageId: 'outside-1', message: 'Не из CRM' });

console.log(JSON.stringify({ ticket, inbound, outbound, ignored,
  planfixCalls: planfix.calls, messengerCalls: messenger.calls }, null, 2));
