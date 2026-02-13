import { state as ModalState } from './store';

export { default as Component } from './Component';
const state = ModalState;

const debug = require('../../preload-safe-debug')(
  'Ferdium:feature:quickSwitch',
);

export default function initialize() {
  debug('Initialize quickSwitch feature');

  const showModal = (): void => {
    state.isModalVisible = true;
  };

  if (!window['ferdium']) {
    return;
  }
  if (!window['ferdium'].features) {
    window['ferdium'].features = {};
  }

  window['ferdium'].features.quickSwitch = {
    state,
    showModal,
  };
}
