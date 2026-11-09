import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge } from '../src/bridge.js';
import { DemoMessenger, PlanfixTransport } from '../src/adapters.js';

function setup() {
  const store = { state: { employees: {}, contacts: {}, tickets: {}, processed: {}, events: [] },
    async save() {} };
  const messenger = new DemoMessenger();
  const planfix = new PlanfixTransport();
  return { bridge: new Bridge({ store, messenger, planfix }), store, messenger, planfix };
}

test('известный контакт попадает в чат ПланФикса, посторонний игнорируется', async () => {
  const { bridge, planfix } = setup();
  await bridge.addEmployee({ crmUserId: '1' });
  await bridge.bindContact({ crmUserId: '1', crmContactId: '2', telegramContactId: '3' });
  const event = { channel: 'telegram', crmUserId: '1', peerId: '3', messageId: '4', message: 'Привет' };
  assert.equal((await bridge.onMessengerEvent(event)).delivered, true);
  assert.equal((await bridge.onMessengerEvent(event)).duplicate, true);
  assert.equal((await bridge.onMessengerEvent({ ...event, peerId: 'outsider' })).ignored, true);
  assert.equal(planfix.calls.length, 1);
  assert.equal(planfix.calls[0].command.chatId, 'telegram:direct:1:3');
});

test('группа привязана к тикету, закрытый тикет не маршрутизируется', async () => {
  const { bridge } = setup();
  await bridge.addEmployee({ crmUserId: '1' });
  await bridge.bindContact({ crmUserId: '1', crmContactId: '2', maxContactId: '3' });
  const ticket = await bridge.openTicket({ channel: 'max', crmUserId: '1',
    crmContactId: '2', crmTicketId: 'T', title: 'Тикет' });
  const event = { channel: 'max', crmUserId: '1', peerId: '3', groupId: ticket.groupId,
    messageId: 'M', message: 'Где заказ?' };
  assert.equal((await bridge.onMessengerEvent(event)).delivered, true);
  await bridge.closeTicket('max', 'T');
  assert.equal((await bridge.onMessengerEvent({ ...event, messageId: 'N' })).ignored, true);
});

test('ответ из ПланФикса доставляется только привязанному адресату и без дубля', async () => {
  const { bridge, messenger } = setup();
  await bridge.addEmployee({ crmUserId: '1' });
  await bridge.bindContact({ crmUserId: '1', crmContactId: '2', telegramContactId: '3' });
  const event = { cmd: 'newMessage', chatId: 'telegram:direct:1:3',
    messageId: 'crm-1', message: 'Ответ' };
  assert.equal((await bridge.onPlanfixMessage(event)).delivered, true);
  assert.equal((await bridge.onPlanfixMessage(event)).duplicate, true);
  assert.equal(messenger.calls.length, 1);
  await assert.rejects(bridge.onPlanfixMessage({ ...event, chatId: 'telegram:direct:1:999' }));
});
