import PropTypes from 'prop-types';
import { createActionsFromDefinitions } from '../../actions/lib/actions';

export interface TranslatorClientMessage {
  action: string;
  data: object;
}

interface TranslatorActionsType {
  updateSettings: (serviceId: string, settings: any) => void;
  translateMessage: (text: string, fromLang: string, toLang: string) => void;
  togglePanel: (serviceId: string) => void;
  setServiceLanguage: (serviceId: string, myLanguage: string, targetLanguage: string) => void;
  handleHostMessage: (action: string, data: object) => void;
  handleClientMessage: (channel: string, message: TranslatorClientMessage) => void;
}

export const translatorActions = createActionsFromDefinitions<TranslatorActionsType>(
  {
    updateSettings: {
      serviceId: PropTypes.string.isRequired,
      settings: PropTypes.object.isRequired,
    },
    translateMessage: {
      text: PropTypes.string.isRequired,
      fromLang: PropTypes.string.isRequired,
      toLang: PropTypes.string.isRequired,
    },
    togglePanel: {
      serviceId: PropTypes.string.isRequired,
    },
    setServiceLanguage: {
      serviceId: PropTypes.string.isRequired,
      myLanguage: PropTypes.string.isRequired,
      targetLanguage: PropTypes.string.isRequired,
    },
    handleHostMessage: {
      action: PropTypes.string.isRequired,
      data: PropTypes.object,
    },
    handleClientMessage: {
      channel: PropTypes.string.isRequired,
      message: PropTypes.shape({
        action: PropTypes.string.isRequired,
        data: PropTypes.object,
      }),
    },
  },
  PropTypes.checkPropTypes,
);
