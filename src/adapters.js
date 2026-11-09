export class DemoMessenger {
  constructor() { this.calls = []; }
  async createGroup(input) {
    const groupId = `demo-${input.channel}-${this.calls.length + 1}`;
    this.calls.push({ operation: 'createGroup', ...input, groupId });
    return groupId;
  }
  async closeGroup(input) { this.calls.push({ operation: 'closeGroup', ...input }); }
  async sendMessage(input) { this.calls.push({ operation: 'sendMessage', ...input }); }
}

export class PlanfixTransport {
  constructor({ url, token, providerId = 'demo-messenger-bridge' } = {}) {
    this.url = url;
    this.token = token;
    this.providerId = providerId;
    this.calls = [];
  }

  async send(channel, command) {
    this.calls.push({ channel, command });
    if (!this.url || !this.token) return { simulated: true };
    const form = new URLSearchParams({
      cmd: command.cmd, providerId: this.providerId, channel,
      planfix_token: this.token,
    });
    for (const [key, value] of Object.entries(command)) {
      if (key === 'cmd' || value === undefined || key === 'attachments') continue;
      form.set(key, String(value));
    }
    for (const attachment of command.attachments ?? []) {
      form.append('attachments[name]', String(attachment.name ?? 'файл'));
      form.append('attachments[url]', String(attachment.url ?? ''));
    }
    const response = await fetch(this.url, { method: 'POST', body: form,
      signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Planfix HTTP ${response.status}`);
    return { simulated: false };
  }
}
