import { randomUUID } from 'node:crypto';

const channels = new Set(['telegram', 'max']);
const text = value => String(value ?? '').trim();

export class Bridge {
  constructor({ store, messenger, planfix }) {
    this.store = store;
    this.messenger = messenger;
    this.planfix = planfix;
  }

  async addEmployee(input) {
    const crmUserId = text(input.crmUserId);
    if (!crmUserId) throw new Error('Нужен crmUserId сотрудника');
    const employee = {
      crmUserId,
      email: text(input.email),
      telegramUserId: text(input.telegramUserId),
      maxUserId: text(input.maxUserId),
    };
    this.store.state.employees[crmUserId] = employee;
    await this.store.save();
    return employee;
  }

  async bindContact(input) {
    const crmUserId = text(input.crmUserId);
    const crmContactId = text(input.crmContactId);
    if (!this.store.state.employees[crmUserId]) throw new Error('Сотрудник не найден');
    if (!crmContactId) throw new Error('Нужен crmContactId');
    const key = `${crmUserId}:${crmContactId}`;
    const old = this.store.state.contacts[key] ?? {};
    const contact = {
      ...old,
      crmUserId, crmContactId,
      name: text(input.name ?? old.name),
      telegramContactId: text(input.telegramContactId ?? old.telegramContactId),
      maxContactId: text(input.maxContactId ?? old.maxContactId),
      telegramDirectChatId: text(input.telegramDirectChatId ?? old.telegramDirectChatId),
      maxDirectChatId: text(input.maxDirectChatId ?? old.maxDirectChatId),
    };
    this.store.state.contacts[key] = contact;
    await this.store.save();
    return contact;
  }

  async openTicket(input) {
    const channel = text(input.channel);
    if (!channels.has(channel)) throw new Error('Неизвестный канал');
    const crmUserId = text(input.crmUserId);
    const crmContactId = text(input.crmContactId);
    const crmTicketId = text(input.crmTicketId);
    const contact = this.store.state.contacts[`${crmUserId}:${crmContactId}`];
    if (!contact || !crmTicketId) throw new Error('Нужны привязанный контакт и тикет');
    const contactId = contact[`${channel}ContactId`];
    if (!contactId) throw new Error('У контакта нет ID в выбранном мессенджере');
    const key = `${channel}:${crmTicketId}`;
    if (this.store.state.tickets[key]) return this.store.state.tickets[key];
    const groupId = await this.messenger.createGroup({
      channel, crmUserId, contactId,
      title: text(input.title), description: text(input.description),
      settings: channel === 'telegram'
        ? { reactions: false, changeInfo: false, historyForNewMembers: false, addMembers: false }
        : { reactions: false, editChatInfo: false, calls: false, addMembers: false, inviteLinks: false },
    });
    const ticket = { channel, crmUserId, crmContactId, crmTicketId, groupId, status: 'open' };
    this.store.state.tickets[key] = ticket;
    await this.store.save();
    return ticket;
  }

  async closeTicket(channel, crmTicketId) {
    const key = `${channel}:${crmTicketId}`;
    const ticket = this.store.state.tickets[key];
    if (!ticket) throw new Error('Тикет не найден');
    if (ticket.status === 'closed') return ticket;
    await this.messenger.closeGroup({ channel, groupId: ticket.groupId });
    ticket.status = 'closed';
    await this.store.save();
    return ticket;
  }

  findRoute(event) {
    const channel = text(event.channel);
    if (!channels.has(channel)) return null;
    const peerId = text(event.peerId);
    const employeeId = text(event.crmUserId);
    const contact = Object.values(this.store.state.contacts).find(c =>
      c.crmUserId === employeeId && c[`${channel}ContactId`] === peerId);
    if (!contact) return null;
    if (event.groupId) {
      const ticket = Object.values(this.store.state.tickets).find(t =>
        t.channel === channel && t.crmUserId === employeeId &&
        t.crmContactId === contact.crmContactId && t.groupId === text(event.groupId) &&
        t.status === 'open');
      return ticket ? { contact, chatId: `${channel}:group:${ticket.groupId}`, ticket } : null;
    }
    return { contact, chatId: `${channel}:direct:${employeeId}:${peerId}`, ticket: null };
  }

  async onMessengerEvent(event) {
    const route = this.findRoute(event);
    if (!route) return { ignored: true, reason: 'Контакт или открытая группа не найдены' };
    const channel = text(event.channel);
    const sourceId = text(event.messageId);
    if (!sourceId) throw new Error('Нужен messageId для защиты от дублей');
    const kind = text(event.type || 'message');
    const key = `${channel}:${kind}:${sourceId}`;
    if (this.store.state.processed[key]) return { duplicate: true, chatId: route.chatId };

    let command;
    const stableMessageId = `${channel}:${sourceId}`;
    if (kind === 'edit') {
      command = { cmd: 'editMessage', messageId: stableMessageId, message: text(event.message) };
    } else if (kind === 'reaction') {
      command = {
        cmd: 'newMessage', chatId: route.chatId,
        contactId: route.contact.crmContactId,
        contactName: route.contact.name,
        messageId: `${stableMessageId}:reaction`,
        message: `Реакция ${text(event.emoji || '👍')} на сообщение ${text(event.replyToId || sourceId)}`,
      };
    } else if (kind === 'message') {
      command = {
        cmd: 'newMessage', chatId: route.chatId,
        contactId: route.contact.crmContactId,
        contactName: route.contact.name,
        messageId: stableMessageId,
        message: text(event.replyToId)
          ? `↳ ${text(event.replyToId)}\n${text(event.message)}` : text(event.message),
        isEcho: event.direction === 'employee' ? 'true' : undefined,
        attachments: Array.isArray(event.attachments) ? event.attachments : [],
      };
    } else throw new Error('Неподдерживаемый тип события');

    await this.planfix.send(channel, command);
    this.store.state.processed[key] = new Date().toISOString();
    this.store.state.events.push({ id: randomUUID(), direction: 'to-planfix', channel,
      crmContactId: route.contact.crmContactId, chatId: route.chatId, kind, messageId: sourceId });
    await this.store.save();
    return { delivered: true, chatId: route.chatId, command };
  }

  async onPlanfixMessage(input) {
    if (text(input.cmd) !== 'newMessage') throw new Error('Поддерживается cmd=newMessage');
    const chatId = text(input.chatId);
    const match = /^(telegram|max):(direct|group):(.+)$/.exec(chatId);
    if (!match) throw new Error('Неизвестный chatId');
    const [, channel, type, id] = match;
    let target;
    if (type === 'group') {
      const ticket = Object.values(this.store.state.tickets).find(t =>
        t.channel === channel && t.groupId === id && t.status === 'open');
      if (!ticket) throw new Error('Группа не найдена');
      target = id;
    } else {
      const [employeeId, peerId] = id.split(':');
      const contact = Object.values(this.store.state.contacts).find(c =>
        c.crmUserId === employeeId && c[`${channel}ContactId`] === peerId);
      if (!contact) throw new Error('Контакт не найден');
      target = peerId;
    }
    const sourceId = text(input.messageId);
    if (!sourceId) throw new Error('Нужен messageId');
    const key = `planfix:${channel}:${sourceId}`;
    if (this.store.state.processed[key]) return { duplicate: true, chatId };
    await this.messenger.sendMessage({ channel, target, message: text(input.message),
      attachments: input.attachments ?? [] });
    this.store.state.processed[key] = new Date().toISOString();
    this.store.state.events.push({ id: randomUUID(), direction: 'to-messenger', channel,
      chatId, messageId: sourceId });
    await this.store.save();
    return { delivered: true, chatId, target };
  }
}
