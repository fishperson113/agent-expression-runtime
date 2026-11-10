let buffer = ''; const methods = [];
process.stdin.on('data', chunk => {
  buffer += chunk; let end;
  if (buffer.length > 1048576) { process.exitCode = 1; process.stdin.destroy(); return; }
  while ((end = buffer.indexOf('\n')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    methods.push(message.method); if (methods.length > 32) methods.shift();
    const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
    if (['thread/start', 'thread/resume'].includes(message.method)) emit({ id: message.id, result: { thread: { id: 'selected' } } });
    else if (message.method === 'turn/start') {
      emit({ id: message.id, result: { turn: { id: 'owned-turn', status: 'inProgress' } } });
      emit({ method: 'item/started', params: { threadId: 'selected', turnId: 'owned-turn', item: { id: 'user', type: 'userMessage', content: message.params.input } } });
      emit({ method: 'item/agentMessage/delta', params: { threadId: 'selected', turnId: 'owned-turn', itemId: 'assistant', delta: 'Public synthetic reply' } });
    } else if (message.method === 'turn/interrupt') {
      emit({ id: message.id, result: {} });
      emit({ method: 'turn/completed', params: { threadId: 'selected', turn: { id: 'owned-turn', status: 'interrupted' } } });
    } else if (message.method === 'test/snapshot') emit({ id: message.id, result: { methods: [...methods] } });
    else emit({ id: message.id, result: {} });
  }
});
