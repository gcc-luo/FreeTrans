import MessageTranslatorStore from './store';

export const messageTranslatorStore = new MessageTranslatorStore();
export { default as Component } from './Component';

export default function initMessageTranslator(
  stores: { messageTranslator?: any },
  actions: any,
) {
  // eslint-disable-next-line no-param-reassign
  stores.messageTranslator = messageTranslatorStore;
  messageTranslatorStore.start(stores, actions);
}
