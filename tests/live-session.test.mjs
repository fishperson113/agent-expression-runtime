import * as panelHost from '../integrations/live-panel.mjs';
import * as terminalHost from '../integrations/live-terminal.mjs';
import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { runLiveSession } from '../scripts/live-session.mjs';
import { closeLiveResources } from '../integrations/live-launch.mjs';
import { existsSync } from 'node:fs';
import { gatewayExecutable } from '../scripts/start-session.mjs';

it('attempts every independent cleanup even when the browser close fails', async () => {
  const calls = [];
  await expect(closeLiveResources([
    async () => { calls.push('browser'); throw Error('browser failed'); },
    async () => { calls.push('gateway'); }, async () => { calls.push('server'); },
  ])).rejects.toThrow('browser failed');
  expect(calls.sort()).toEqual(['browser', 'gateway', 'server']);
});

it.skipIf(!existsSync(gatewayExecutable()))('closes the real gateway/browser when its camera-off page closes without Herdr', async () => {
  let gateway, browser;
  const result = await runLiveSession({ headless: true, runHost: async ({ live, signal }) => {
    gateway = live.gateway; browser = live.browser;
    const cancelled = new Promise(resolve => signal.addEventListener('abort', () => resolve(0), { once: true }));
    await live.page.close(); return cancelled;
  } });
  expect(result).toBe(0); expect(browser.isConnected()).toBe(false);
  expect(gateway.exitCode !== null || gateway.signalCode !== null).toBe(true);
}, 45000);
it('never opens resources or contacts Herdr when already cancelled', async () => {
  const abort = new AbortController(); abort.abort();
  const open = vi.fn();
  expect(await runLiveSession({ signal: abort.signal, open, call: () => { throw Error('Herdr unavailable'); } })).toBe(130);
  expect(open).not.toHaveBeenCalled();
});
it('passes browser closure to the owned host and closes Live after host exit', async () => {
  const page = new EventEmitter(), gateway = new EventEmitter();
  page.exposeFunction = async () => {}; const close = vi.fn(async () => {});
  const result = await runLiveSession({ call: () => { throw Error('Herdr unavailable'); },
    open: async () => ({ page, gateway, close }), runHost: async ({ signal }) => {
      const closed = new Promise(resolve => signal.addEventListener('abort', () => resolve(0), { once: true }));
      page.emit('close'); return closed;
    } });
  expect(result).toBe(0); expect(close).toHaveBeenCalledOnce();
});

it('selects the browser panel by default and terminal only when explicitly requested',async()=>{
 const panel=vi.spyOn(panelHost,'runPanelCodex').mockResolvedValue(0),terminal=vi.spyOn(terminalHost,'runTerminalCodex').mockResolvedValue(0);
 const page=new EventEmitter();page.exposeFunction=async()=>{};const open=async()=>({page,gateway:new EventEmitter(),close:async()=>{}});
 try { await runLiveSession({open});expect(panel).toHaveBeenCalledOnce();expect(terminal).not.toHaveBeenCalled();
   await runLiveSession({open,panel:false});expect(terminal).toHaveBeenCalledOnce();expect(panel).toHaveBeenCalledOnce();
 } finally {panel.mockRestore();terminal.mockRestore();}
});
