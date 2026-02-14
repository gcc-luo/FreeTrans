import PropTypes from 'prop-types';
import { createActionsFromDefinitions } from '../../actions/lib/actions';

export interface TranslatorClientMessage {
  action: string;
  data: object;
}

interface TranslatorActionsType {
  updateSettings: (params: { serviceId: string; settings: any }) => void;
  translateMessage: (params: {
    text: string;
    fromLang: string;
    toLang: string;
  }) => void;
  togglePanel: (params: { serviceId: string }) => void;
  setServiceLanguage: (params: {
    serviceId: string;
    myLanguage: string;
    targetLanguage: string;
  }) => void;
  handleHostMessage: (params: {
    action: string;
    data: Record<string, unknown>;
  }) => void;
  handleClientMessage: (params: {
    channel: string;
    message: TranslatorClientMessage;
  }) => void;
}

export const translatorActions =
  createActionsFromDefinitions<TranslatorActionsType>(
    {
      updateSettings: {
        serviceId: PropTypes.string.isRequired,
        settings: PropTypes.shape({}).isRequired,
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
        data: PropTypes.shape({}),
      },
      handleClientMessage: {
        channel: PropTypes.string.isRequired,
        message: PropTypes.shape({
          action: PropTypes.string.isRequired,
          data: PropTypes.shape({}),
        }),
      },
    },
    PropTypes.checkPropTypes,
  );
