const listeners = new Map();
export const ipcRenderer = {
  on(channel, handler) {
    listeners.set(channel, [...(listeners.get(channel) || []), handler]);
  },
  removeListener(channel, handler) {
    listeners.set(
      channel,
      (listeners.get(channel) || []).filter(item => item !== handler),
    );
  },
  async invoke(channel) {
    if (channel === 'translator:get-engine-status')
      return [{ engine: 'Google', available: true }];
    if (channel === 'translator:get-cache-settings') return { enabled: true };
    if (
      channel === 'translator:set-cache-enabled' ||
      channel === 'translator:clear-cache'
    )
      return {};
    throw new Error(`Unsupported offline panel request: ${channel}`);
  },
};
